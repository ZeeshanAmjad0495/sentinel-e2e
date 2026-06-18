// packages/driver-playwright/src/assertion.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type {
  Assertion,
  BranchProgress,
  ElementState,
  Locator,
} from "@sentinele2e/contracts";
import type { LocatorResolver, TelemetrySink } from "@sentinele2e/core";
import { SelectorNotFoundError, TimeoutError } from "@sentinele2e/core";
import type { PlaywrightElementHandle } from "./element";

interface AssertContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

type WaitState = "attached" | "detached" | "visible" | "hidden";

export class PlaywrightAssertion implements Assertion {
  constructor(
    private readonly page: Page,
    private readonly resolver: LocatorResolver,
    private readonly sink: TelemetrySink,
    private readonly ctx: AssertContext,
    private readonly defaultTimeoutMs: number,
  ) {}

  async waitFor(
    target: Locator,
    state: ElementState,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const start = process.hrtime.bigint();
    const progress = await this.runBranch(target, state, timeoutMs);

    this.emitAssertion(
      target,
      state,
      progress.matched,
      progress.resolvedRank ?? 0,
    );

    if (!progress.matched) {
      this.throwTimeout(
        `waitFor("${target.logicalName}", "${state}") timed out after ${timeoutMs}ms`,
        start,
        [
          {
            label: target.logicalName,
            reachedState: progress.reachedState,
            resolvedRank: progress.resolvedRank,
          },
        ],
      );
    }
  }

  async waitForFirstOf<L extends string>(
    conditions: ReadonlyArray<{
      label: L;
      target: Locator;
      state: ElementState;
    }>,
    opts?: { timeoutMs?: number },
  ): Promise<L> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const start = process.hrtime.bigint();

    // Shared winner latch: the first branch to win flips this; losers see it and stop.
    let winningLabel: L | null = null;

    type BranchOutcome = {
      label: L;
      won: boolean;
      reachedState: ElementState | "none";
      resolvedRank: number | null;
    };

    const runOne = async (cond: {
      label: L;
      target: Locator;
      state: ElementState;
    }): Promise<BranchOutcome> => {
      const deadline = Date.now() + timeoutMs;
      let reachedState: ElementState | "none" = "none";
      let resolvedRank: number | null = null;

      // Poll the branch in short slices so a winner elsewhere cancels us promptly.
      while (Date.now() < deadline && winningLabel === null) {
        // Floor the slice at 1ms: Playwright treats `timeout: 0` as "disable
        // timeout" (wait indefinitely), which would let a branch hang past
        // waitForFirstOf's own deadline and escape the winningLabel latch.
        const remaining = Math.max(1, Math.min(100, deadline - Date.now()));
        // Any branch error (e.g. SelectorAmbiguousError) must NOT reject this
        // promise — it would collapse Promise.all and leak sibling branches as
        // unhandled rejections. An erroring branch simply never wins; if no
        // branch wins, the no-winner path below throws TimeoutError. We keep the
        // best state observed so far so branchProgress stays informative.
        let r: {
          matched: boolean;
          reachedState: ElementState | "none";
          resolvedRank: number | null;
        };
        try {
          r = await this.runBranch(cond.target, cond.state, remaining);
        } catch {
          return { label: cond.label, won: false, reachedState, resolvedRank };
        }
        resolvedRank = r.resolvedRank;
        reachedState = closest(reachedState, r.reachedState);
        if (r.matched) {
          // Claim the win atomically (single-threaded JS — first writer wins).
          if (winningLabel === null) winningLabel = cond.label;
          return {
            label: cond.label,
            won: winningLabel === cond.label,
            reachedState: cond.state,
            resolvedRank,
          };
        }
      }
      return { label: cond.label, won: false, reachedState, resolvedRank };
    };

    // Every branch resolves (never rejects) -> Promise.all has no losers to leak.
    const outcomes = await Promise.all(conditions.map(runOne));

    const branchProgress: BranchProgress[] = outcomes.map((o) => ({
      label: o.label,
      reachedState: o.reachedState,
      resolvedRank: o.resolvedRank,
    }));

    const winner = outcomes.find((o) => o.won);
    if (winner) {
      const winningCond = conditions.find((c) => c.label === winner.label)!;
      this.emitAssertion(
        winningCond.target,
        winningCond.state,
        true,
        winner.resolvedRank ?? 0,
        winner.label,
        branchProgress,
      );
      return winner.label;
    }

    // No winner: emit + THROW (never resolve-on-timeout — the §10.5 fix).
    this.emitAssertion(
      conditions[0]!.target,
      conditions[0]!.state,
      false,
      0,
      undefined,
      branchProgress,
    );
    this.throwTimeout(
      `waitForFirstOf timed out after ${timeoutMs}ms; no branch reached its state`,
      start,
      branchProgress,
    );
  }

  /**
   * Drives one branch. Returns whether the state was reached, the closest reached
   * state, and the resolvedRank (or null if the locator never resolved).
   */
  async runBranch(
    target: Locator,
    state: ElementState,
    timeoutMs: number,
  ): Promise<{
    matched: boolean;
    reachedState: ElementState | "none";
    resolvedRank: number | null;
  }> {
    let pw: PwLocator;
    let resolvedRank: number | null;
    try {
      const resolution = await this.resolver.resolve(target);
      resolvedRank = resolution.resolvedRank;
      pw = (resolution.handle as PlaywrightElementHandle).compileWinner();
    } catch (err) {
      // selector-not-found: the element was never attached.
      if (err instanceof SelectorNotFoundError) {
        return { matched: false, reachedState: "none", resolvedRank: null };
      }
      throw err;
    }

    if (state === "enabled") {
      try {
        await pw.waitFor({ state: "visible", timeout: timeoutMs });
        const enabled = await pw.isEnabled();
        return enabled
          ? { matched: true, reachedState: "enabled", resolvedRank }
          : { matched: false, reachedState: "visible", resolvedRank };
      } catch {
        return { matched: false, reachedState: "attached", resolvedRank };
      }
    }

    try {
      await pw.waitFor({ state: state as WaitState, timeout: timeoutMs });
      return { matched: true, reachedState: state, resolvedRank };
    } catch {
      const reached = (await pw.count()) > 0 ? "attached" : "none";
      return { matched: false, reachedState: reached, resolvedRank };
    }
  }

  emitAssertion(
    target: Locator,
    state: ElementState,
    matched: boolean,
    locatorRank: number,
    branch?: string,
    branchProgress?: readonly BranchProgress[],
  ): void {
    this.sink.emit({
      schemaVersion: "1.0.0",
      eventId: globalThis.crypto.randomUUID(),
      type: "assertion",
      traceId: this.ctx.correlationId,
      spanId: globalThis.crypto.randomUUID(),
      sequence: 0,
      name: target.logicalName,
      status: matched ? "ok" : "error",
      timing: {
        startWallClockMs: this.ctx.startedAt,
        startMonotonicNs: process.hrtime.bigint(),
      },
      state,
      matched,
      locatorRank,
      branch,
      branchProgress,
    });
  }

  throwTimeout(
    message: string,
    start: bigint,
    branchProgress: readonly BranchProgress[],
  ): never {
    throw new TimeoutError(message, {
      correlationId: this.ctx.correlationId,
      flowName: this.ctx.flowName,
      startedAt: this.ctx.startedAt,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      branchProgress,
    });
  }
}

const STATE_ORDER: Record<ElementState | "none", number> = {
  none: 0,
  detached: 1,
  attached: 2,
  hidden: 3,
  visible: 4,
  enabled: 5,
};

function closest(
  a: ElementState | "none",
  b: ElementState | "none",
): ElementState | "none" {
  return STATE_ORDER[b] > STATE_ORDER[a] ? b : a;
}

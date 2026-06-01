// packages/driver-playwright/src/assertion.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type {
  Assertion,
  BranchProgress,
  ElementState,
  Locator,
} from "@sentinel/contracts";
import type { LocatorResolver, TelemetrySink } from "@sentinel/core";
import { SelectorNotFoundError, TimeoutError } from "@sentinel/core";
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

  // Stubbed here — fully implemented in Task 6.
  async waitForFirstOf<L extends string>(
    conditions: ReadonlyArray<{
      label: L;
      target: Locator;
      state: ElementState;
    }>,
    opts?: { timeoutMs?: number },
  ): Promise<L> {
    void conditions;
    void opts;
    throw new Error("waitForFirstOf implemented in Task 6");
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

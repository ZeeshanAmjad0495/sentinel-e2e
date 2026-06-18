// packages/driver-selenium/src/assertion.ts
import type { WebDriver } from "selenium-webdriver";
import type {
  Assertion,
  BranchProgress,
  ElementState,
  Locator,
} from "@sentinele2e/contracts";
import type { LocatorResolver, TelemetrySink } from "@sentinele2e/core";
import { SelectorNotFoundError, TimeoutError } from "@sentinele2e/core";
import type { SeleniumElementHandle } from "./element";

interface AssertContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

const SLICE_MS = 50;

type Reached = ElementState | "none";

interface BranchState<L extends string> {
  readonly label: L;
  readonly target: Locator;
  readonly state: ElementState;
  reachedState: Reached;
  resolvedRank: number | null;
}

export class SeleniumAssertion implements Assertion {
  constructor(
    private readonly driver: WebDriver,
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
    // waitFor is the degenerate one-branch interleaved loop.
    await this.waitForFirstOf([{ label: "default", target, state }], opts);
  }

  /**
   * Single interleaved poll loop (D3): round-robins every branch each ~50ms
   * tick within ONE promise chain. A branch's error is swallowed per-branch
   * (never wins, never rejects the loop). First match -> emit + return label.
   * Deadline with no winner -> emit matched:false + throw TimeoutError carrying
   * BranchProgress[] for ALL labels. Zero unhandled rejections BY CONSTRUCTION:
   * there is literally no second promise.
   */
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
    const deadline = Date.now() + timeoutMs;

    const branches: BranchState<L>[] = conditions.map((c) => ({
      label: c.label,
      target: c.target,
      state: c.state,
      reachedState: "none",
      resolvedRank: null,
    }));

    for (;;) {
      // One tick: probe each branch sequentially in the same promise chain.
      for (const b of branches) {
        const matched = await this.probeOnce(b);
        if (matched) {
          this.emitAssertion(
            b.target,
            b.state,
            true,
            b.resolvedRank ?? 0,
            b.label,
            this.branchProgress(branches),
          );
          return b.label;
        }
      }

      if (Date.now() >= deadline) break;
      await sleep(Math.min(SLICE_MS, Math.max(0, deadline - Date.now())));
    }

    // No winner: emit matched:false + THROW with BranchProgress[] for ALL labels.
    const progress = this.branchProgress(branches);
    const first = conditions[0]!;
    this.emitAssertion(
      first.target,
      first.state,
      false,
      0,
      undefined,
      progress,
    );
    throw new TimeoutError(
      `waitForFirstOf timed out after ${timeoutMs}ms; no branch reached its state`,
      {
        correlationId: this.ctx.correlationId,
        flowName: this.ctx.flowName,
        startedAt: this.ctx.startedAt,
        durationMs: Number(process.hrtime.bigint() - start) / 1e6,
        branchProgress: progress,
      },
    );
  }

  /**
   * Probe one branch once. Updates reachedState/resolvedRank in place. Any error
   * (ambiguous, stale, compile) is swallowed so a single branch can never reject
   * the loop. Returns true iff the branch's target state is satisfied right now.
   *
   * Presence is established via the resolver (so a present element emits the
   * SAME locator.resolved envelope Playwright emits on its assert path, and we
   * capture resolvedRank); a never-attached element raises SelectorNotFoundError
   * which we swallow as "not present yet".
   */
  private async probeOnce<L extends string>(
    b: BranchState<L>,
  ): Promise<boolean> {
    let handle: SeleniumElementHandle;
    try {
      const resolution = await this.resolver.resolve(b.target);
      b.resolvedRank = resolution.resolvedRank;
      handle = resolution.handle as SeleniumElementHandle;
    } catch (err) {
      if (err instanceof SelectorNotFoundError) {
        // Never attached this tick (detached/hidden may still be the target).
        return this.satisfies(b, "none", false, false);
      }
      // Ambiguous or any other resolver error: this branch never wins.
      return false;
    }

    const by = handle.winnerBy();
    let displayed = false;
    let enabled = false;
    try {
      const els = await this.driver.findElements(by);
      const el = els[0];
      if (el !== undefined) {
        displayed = await el.isDisplayed();
        enabled = displayed ? await el.isEnabled() : false;
      }
    } catch {
      // Stale/race mid-poll: treat as attached-only this tick.
      displayed = false;
      enabled = false;
    }

    const observed: Reached =
      enabled && displayed ? "enabled" : displayed ? "visible" : "attached";
    b.reachedState = closest(b.reachedState, observed);
    return this.satisfies(b, observed, displayed, enabled);
  }

  /** Map ElementState -> selenium checks (§5.5). */
  private satisfies<L extends string>(
    b: BranchState<L>,
    observed: Reached,
    displayed: boolean,
    enabled: boolean,
  ): boolean {
    const attached = observed !== "none";
    switch (b.state) {
      case "attached":
        return attached;
      case "detached":
        return !attached;
      case "visible":
        return attached && displayed;
      case "hidden":
        return !attached || !displayed;
      case "enabled":
        return attached && displayed && enabled;
      default:
        return false;
    }
  }

  private branchProgress<L extends string>(
    branches: ReadonlyArray<BranchState<L>>,
  ): BranchProgress[] {
    return branches.map((b) => ({
      label: b.label,
      reachedState: b.reachedState,
      resolvedRank: b.resolvedRank,
    }));
  }

  private emitAssertion(
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
}

const STATE_ORDER: Record<Reached, number> = {
  none: 0,
  detached: 1,
  attached: 2,
  hidden: 3,
  visible: 4,
  enabled: 5,
};

function closest(a: Reached, b: Reached): Reached {
  return STATE_ORDER[b] > STATE_ORDER[a] ? b : a;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

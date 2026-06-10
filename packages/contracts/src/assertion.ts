// packages/contracts/src/assertion.ts
import type { Locator } from "./locator";

export type ElementState =
  | "attached"
  | "detached"
  | "visible"
  | "hidden"
  | "enabled";

export interface BranchProgress<L extends string = string> {
  readonly label: L;
  readonly reachedState: ElementState | "none"; // closest state observed before timeout
  readonly resolvedRank: number | null; // locator rank that matched, or null if unresolved
}

export interface Assertion {
  /** Resolves on success; THROWS TimeoutError (with timings + artifacts) on timeout. NEVER returns on timeout. */
  waitFor(
    target: Locator,
    state: ElementState,
    opts?: { timeoutMs?: number },
  ): Promise<void>;

  /** Driver-owned race. Returns the winning label. On no winner, throws TimeoutError whose context
   *  carries per-branch BranchProgress[]. The driver OWNS loser-cancellation (no unhandled rejections). */
  waitForFirstOf<L extends string>(
    conditions: ReadonlyArray<{
      label: L;
      target: Locator;
      state: ElementState;
    }>,
    opts?: { timeoutMs?: number },
  ): Promise<L>;
}

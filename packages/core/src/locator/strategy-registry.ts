// packages/core/src/locator/strategy-registry.ts
import type { StrategyKind } from "@sentinele2e/contracts";

export interface StrategyMeta {
  readonly rank: number;
} // lower = more durable

/** css/xpath are the universally-supported migration bottom rung; unknown open kinds default here. */
const BOTTOM_RUNG_RANK = 6;

const DEFAULT_RANKS: ReadonlyArray<readonly [StrategyKind, number]> = [
  ["role", 0],
  ["label", 1],
  ["text", 2],
  ["placeholder", 3],
  ["altText", 3],
  ["title", 3],
  ["testid", 4],
  ["relative", 5],
  ["css", 6],
  ["xpath", 6],
];

export class StrategyRegistry {
  private readonly ranks = new Map<StrategyKind, number>();

  constructor() {
    for (const [kind, rank] of DEFAULT_RANKS) this.ranks.set(kind, rank);
  }

  register(kind: StrategyKind, meta: StrategyMeta): void {
    this.ranks.set(kind, meta.rank);
  }

  rankOf(kind: StrategyKind): number {
    return this.ranks.get(kind) ?? BOTTOM_RUNG_RANK;
  }
}

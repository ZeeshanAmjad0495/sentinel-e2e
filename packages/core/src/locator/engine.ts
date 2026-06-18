// packages/core/src/locator/engine.ts
import type {
  ElementHandle,
  Locator,
  StrategyKind,
} from "@sentinele2e/contracts";

export interface LocatorResolution {
  handle: ElementHandle;
  resolvedKind: StrategyKind;
  resolvedRank: number;
  degraded: boolean;
  score: number;
}

export interface LocatorResolver {
  resolve(locator: Locator): Promise<LocatorResolution>;
}

// packages/contracts/src/locator.ts
export type StrategyKind = string; // "role" | "label" | "text" | "testid" | "css" | "xpath" | "-ios predicate string" ...

export interface LocatorStrategy {
  readonly kind: StrategyKind;
  readonly value: string; // role name / testid / css / predicate
  readonly options?: Readonly<Record<string, string | number | boolean>>; // strategy-scoped; {name,exact} only meaningful to role/label
}

export interface Locator {
  readonly logicalName: string; // STABLE id, "auth.login.submit" — the drift anchor
  readonly candidates: readonly LocatorStrategy[]; // ordered most-durable -> css/xpath fallback
  readonly minScore?: number; // accept threshold; default 1.0 in Slice A (binary)
  within?(parent: Locator): Locator; // OPTIONAL: scoping/chaining when supported
}

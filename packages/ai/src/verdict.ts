// packages/ai/src/verdict.ts
export type VerdictKind =
  | "real-bug" // app behaved wrong with a stable locator
  | "infra-flake" // transient: retry-then-pass, retryable timeout/session loss
  | "selector-drift" // a locator degraded to a fallback, or selector not-found/ambiguous
  | "healthy" // success, no degradation
  | "business-outcome" // an expected domain result (e.g. INVALID_CREDENTIALS) — NOT a defect
  | "indeterminate"; // no clear rule -> hand to the LLM to adjudicate

export interface Evidence {
  readonly eventId: string; // the telemetry event this draws from
  readonly type: string; // event type (e.g. "locator.resolved")
  readonly detail: string; // human-readable why ("primary 'label' missed; resolved via 'css' rank 6")
  readonly fields?: Readonly<Record<string, string | number | boolean>>; // the decisive fields
}

export interface Verdict {
  readonly kind: VerdictKind;
  readonly confidence: number; // 0..1 — rules emit high; indeterminate ~0
  readonly summary: string; // one-line
  readonly evidence: readonly Evidence[];
  readonly logicalName?: string; // element a drift/bug is tied to
  readonly source: "rule" | "llm"; // who produced this verdict
}

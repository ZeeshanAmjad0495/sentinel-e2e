// packages/core/src/result/result.ts
export interface ResultMeta {
  readonly correlationId: string; // == Session.id == telemetry traceId — THE join key
  readonly flowName: string; // "auth.login" — domain intent
  readonly startedAt: number; // single canonical epoch ms at flow entry
  readonly durationMs: number;
  readonly artifacts?: Readonly<Record<string, string>>; // e.g. {traceRef} — OPTIONAL string refs (NOT finalUrl)
}

export interface Success<T> {
  readonly status: "success";
  readonly data: T;
  readonly meta: ResultMeta;
}
export interface BusinessFailure<R extends string = string, D = unknown> {
  readonly status: "business-failure";
  readonly reason: R; // STABLE enum, "INVALID_CREDENTIALS" — NEVER the localized UI string
  readonly message?: string; // human/UI text (localized; display-only, never keyed on)
  readonly details?: D;
  readonly meta: ResultMeta;
}
export type Result<T, R extends string = string, D = unknown> =
  | Success<T>
  | BusinessFailure<R, D>;

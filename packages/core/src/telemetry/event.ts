// packages/core/src/telemetry/event.ts
export const TELEMETRY_SCHEMA_VERSION = "1.0.0";

export interface Timing {
  startWallClockMs: number; // Date.now() — cross-machine ordering
  startMonotonicNs: bigint; // process.hrtime.bigint() — duration source of truth
  endMonotonicNs?: bigint;
  durationMs?: number;
}
export type SpanStatus = "unset" | "ok" | "error";

export type TelemetryEventType =
  | "run.started"
  | "run.finished"
  | "flow.started"
  | "flow.finished"
  | "component.action"
  | "locator.resolved"
  | "retry"
  | "assertion"
  | "artifact.captured"
  | "business.failure"
  | "system.failure";

export interface TelemetryEnvelope<
  T extends TelemetryEventType = TelemetryEventType,
> {
  schemaVersion: string;
  eventId: string; // uuid
  type: T;
  traceId: string; // == correlationId == Session.id
  spanId: string;
  parentSpanId?: string;
  sequence: number; // monotonic per run — total order without a span tree
  name: string; // "auth.login" / "loginForm.submit"
  status?: SpanStatus;
  timing: Timing;
  attributes?: Readonly<Record<string, string | number | boolean>>;
}

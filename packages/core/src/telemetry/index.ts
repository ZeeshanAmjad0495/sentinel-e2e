// packages/core/src/telemetry/index.ts
export { TELEMETRY_SCHEMA_VERSION } from "./event";
export type {
  Timing,
  SpanStatus,
  TelemetryEventType,
  TelemetryEnvelope,
} from "./event";
export type {
  LocatorResolvedEvent,
  AssertionEvent,
  RetryEvent,
  BusinessFailureEvent,
  SystemFailureEvent,
  ArtifactCapturedEvent,
  FlowFinishedEvent,
  TelemetryEvent,
} from "./signals";
export type { TelemetrySink } from "./sink";
export { SpanContext, StampingSink, InMemorySink, NoopSink } from "./sink";
export { startTimer, durationMsFromNs } from "./timers";
export type { Timer, HrClock } from "./timers";

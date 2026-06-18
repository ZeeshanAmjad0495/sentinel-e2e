// packages/core/tests/telemetry-event.test.ts
import { test, expect } from "@playwright/test";
import {
  TELEMETRY_SCHEMA_VERSION,
  type Timing,
  type SpanStatus,
  type TelemetryEventType,
  type TelemetryEnvelope,
} from "@sentinele2e/core";

test("schema version is 1.0.0", () => {
  expect(TELEMETRY_SCHEMA_VERSION).toBe("1.0.0");
});

test("Timing carries wall-clock ms and monotonic bigint ns", () => {
  const timing: Timing = {
    startWallClockMs: Date.now(),
    startMonotonicNs: 123n,
    endMonotonicNs: 456n,
    durationMs: 0.333,
  };
  expect(typeof timing.startMonotonicNs).toBe("bigint");
  expect(timing.endMonotonicNs! - timing.startMonotonicNs).toBe(333n);
});

test("TelemetryEnvelope is satisfiable and SpanStatus/EventType are usable", () => {
  const status: SpanStatus = "ok";
  const type: TelemetryEventType = "flow.started";
  const env: TelemetryEnvelope<"flow.started"> = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: "evt-1",
    type,
    traceId: "run-1",
    spanId: "span-1",
    sequence: 0,
    name: "auth.login",
    status,
    timing: { startWallClockMs: 1, startMonotonicNs: 1n },
  };
  expect(env.type).toBe("flow.started");
  expect(env.parentSpanId).toBeUndefined();
});

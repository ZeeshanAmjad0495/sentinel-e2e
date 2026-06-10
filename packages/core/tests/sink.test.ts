// packages/core/tests/sink.test.ts
import { test, expect } from "@playwright/test";
import {
  SpanContext,
  StampingSink,
  InMemorySink,
  NoopSink,
  TELEMETRY_SCHEMA_VERSION,
} from "@sentinel/core";
import type { TelemetryEnvelope } from "@sentinel/core";

const evt = (name: string): TelemetryEnvelope => ({
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: "e",
  type: "component.action",
  traceId: "run-1",
  spanId: "PLACEHOLDER",
  sequence: -1,
  name,
  timing: { startWallClockMs: 1, startMonotonicNs: 1n },
});

test("SpanContext mints monotonic sequence and unique span ids", () => {
  const root = new SpanContext("run-1");
  expect(root.traceId).toBe("run-1");
  expect(root.nextSequence()).toBe(0);
  expect(root.nextSequence()).toBe(1);
  const child = root.child();
  expect(child.parentSpanId).toBe(root.spanId);
  expect(child.spanId).not.toBe(root.spanId);
  // child shares the run-level monotonic sequence
  expect(child.nextSequence()).toBe(2);
});

test("StampingSink stamps traceId/spanId/sequence and delegates to its inner sink", () => {
  const inner = new InMemorySink();
  const sink = new StampingSink(new SpanContext("run-1"), inner);
  sink.emit(evt("first"));
  sink.emit(evt("second"));
  expect(inner.events.map((e) => e.name)).toEqual(["first", "second"]);
  expect(inner.events.map((e) => e.sequence)).toEqual([0, 1]);
  expect(inner.events[0]?.traceId).toBe("run-1");
  expect(typeof inner.events[0]?.spanId).toBe("string");
  expect(inner.events[0]?.spanId).not.toBe("PLACEHOLDER");
});

test("StampingSink.child stamps parentSpanId and shares the run-level sequence", () => {
  const inner = new InMemorySink();
  const sink = new StampingSink(new SpanContext("run-1"), inner);
  sink.emit(evt("root"));
  sink.child("flow").emit(evt("child"));
  expect(inner.events).toHaveLength(2);
  expect(inner.events[1]?.name).toBe("child");
  expect(inner.events[1]?.parentSpanId).toBe(inner.events[0]?.spanId);
  expect(inner.events.map((e) => e.sequence)).toEqual([0, 1]);
});

test("InMemorySink is a pure recorder — stores events verbatim, no stamping", () => {
  const sink = new InMemorySink();
  sink.emit(evt("raw"));
  expect(sink.events.map((e) => e.name)).toEqual(["raw"]);
  expect(sink.events[0]?.sequence).toBe(-1); // pure push preserves the caller's value
  expect(sink.child("c")).toBeInstanceOf(InMemorySink);
});

test("NoopSink swallows emit and child returns itself", () => {
  const noop = new NoopSink();
  expect(() => noop.emit(evt("x"))).not.toThrow();
  expect(noop.child("y")).toBe(noop);
});

// packages/core/tests/composite-sink.test.ts
import { test, expect } from "@playwright/test";
import {
  CompositeSink,
  InMemorySink,
  TELEMETRY_SCHEMA_VERSION,
} from "@sentinel/core";
import type { TelemetryEnvelope } from "@sentinel/core";

const evt = (name: string): TelemetryEnvelope => ({
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: "e",
  type: "component.action",
  traceId: "x",
  spanId: "x",
  sequence: -1,
  name,
  timing: { startWallClockMs: 1, startMonotonicNs: 1n },
});

test("CompositeSink fans emit to every member", () => {
  const a = new InMemorySink();
  const b = new InMemorySink();
  const composite = new CompositeSink([a, b]);
  composite.emit(evt("hello"));
  expect(a.events.map((e) => e.name)).toEqual(["hello"]);
  expect(b.events.map((e) => e.name)).toEqual(["hello"]);
});

test("CompositeSink.child returns a composite over each member's child", () => {
  const a = new InMemorySink();
  const b = new InMemorySink();
  const composite = new CompositeSink([a, b]);
  const child = composite.child("flow");
  expect(child).toBeInstanceOf(CompositeSink);
  child.emit(evt("inner"));
  expect(a.events.map((e) => e.name)).toEqual(["inner"]);
  expect(b.events.map((e) => e.name)).toEqual(["inner"]);
  // members are independent backing arrays; child writes propagate to both
  expect(a.events).toHaveLength(1);
  expect(b.events).toHaveLength(1);
});

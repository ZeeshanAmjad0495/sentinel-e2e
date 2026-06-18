// packages/core/tests/jsonl-sink.test.ts
import { test, expect } from "@playwright/test";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { JsonlSink, TELEMETRY_SCHEMA_VERSION } from "@sentinele2e/core";
import type { TelemetryEnvelope } from "@sentinele2e/core";

const evt = (name: string, start: bigint, end: bigint): TelemetryEnvelope => ({
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: randomUUID(),
  type: "component.action",
  traceId: "run-1",
  spanId: "s",
  sequence: 0,
  name,
  timing: {
    startWallClockMs: 1,
    startMonotonicNs: start,
    endMonotonicNs: end,
    durationMs: 1,
  },
});

test("JsonlSink writes one JSON line per event and round-trips bigint timing", () => {
  const filePath = join(tmpdir(), `sentinel-jsonl-${randomUUID()}.jsonl`);
  try {
    const sink = new JsonlSink({ filePath });
    sink.emit(evt("first", 5_000_000n, 6_000_000n));
    sink.emit(evt("second", 7_000_000n, 9_500_000n));

    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]?.name).toBe("first");
    // bigint fields are serialized as decimal strings and survive the round-trip
    const t0 = parsed[0]?.timing as Record<string, unknown>;
    expect(t0.startMonotonicNs).toBe("5000000");
    expect(t0.endMonotonicNs).toBe("6000000");
    expect(
      BigInt(t0.endMonotonicNs as string) -
        BigInt(t0.startMonotonicNs as string),
    ).toBe(1_000_000n);
  } finally {
    if (existsSync(filePath)) rmSync(filePath);
  }
});

test("JsonlSink.child returns a sink writing to the same file", () => {
  const filePath = join(tmpdir(), `sentinel-jsonl-${randomUUID()}.jsonl`);
  try {
    const sink = new JsonlSink({ filePath });
    sink.emit(evt("root", 1n, 2n));
    sink.child("flow").emit(evt("child", 3n, 4n));
    const lines = readFileSync(filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[1]!) as { name: string }).name).toBe("child");
  } finally {
    if (existsSync(filePath)) rmSync(filePath);
  }
});

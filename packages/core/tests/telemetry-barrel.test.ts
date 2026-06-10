// packages/core/tests/telemetry-barrel.test.ts
import os from "node:os";
import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  TELEMETRY_SCHEMA_VERSION,
  SpanContext,
  StampingSink,
  InMemorySink,
  NoopSink,
  CompositeSink,
  JsonlSink,
  startTimer,
  durationMsFromNs,
} from "@sentinel/core";

test("telemetry public surface is re-exported from @sentinel/core", () => {
  expect(TELEMETRY_SCHEMA_VERSION).toBe("1.0.0");
  expect(typeof SpanContext).toBe("function");
  expect(typeof StampingSink).toBe("function");
  expect(typeof InMemorySink).toBe("function");
  expect(typeof NoopSink).toBe("function");
  expect(typeof CompositeSink).toBe("function");
  expect(typeof JsonlSink).toBe("function");
  expect(typeof startTimer).toBe("function");
  expect(typeof durationMsFromNs).toBe("function");
});

test("a CompositeSink([InMemorySink, JsonlSink]) is constructible from the barrel", () => {
  const composite = new CompositeSink([
    new InMemorySink(),
    new JsonlSink({
      filePath: path.join(os.tmpdir(), "sentinel-test-barrel.jsonl"),
    }),
  ]);
  expect(composite).toBeInstanceOf(CompositeSink);
});

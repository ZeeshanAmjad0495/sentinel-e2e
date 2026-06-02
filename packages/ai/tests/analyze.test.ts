// packages/ai/tests/analyze.test.ts
import { test, expect } from "@playwright/test";
import type { TelemetryEvent } from "@sentinel/core";
import { analyzeRun } from "../src/analyze";
import { ANALYSIS_SCHEMA_VERSION } from "../src/analysis";

const TRACE = "trace-b4";

function baseEnvelope(
  type: TelemetryEvent["type"],
  eventId: string,
  sequence: number,
  name: string,
): TelemetryEvent {
  return {
    schemaVersion: "1.0.0",
    eventId,
    type,
    traceId: TRACE,
    spanId: `span-${sequence}`,
    sequence,
    name,
    timing: { startWallClockMs: 1000 + sequence, startMonotonicNs: 0n },
  } as TelemetryEvent;
}

/** A real-bug run: rank-0 assertion mismatch, no preceding retry, system-failure terminal. */
function realBugEvents(): TelemetryEvent[] {
  const assertion = {
    ...baseEnvelope("assertion", "assert-1", 1, "auth.appShell.ready"),
    status: "error",
    state: "visible",
    matched: false,
    locatorRank: 0,
  } as TelemetryEvent;
  const finished = {
    ...baseEnvelope("flow.finished", "finish-1", 2, "auth.login"),
    status: "error",
    outcome: "system-failure",
    didDegrade: false,
  } as TelemetryEvent;
  return [assertion, finished];
}

test("provider:null => rules-only analysis (usedLlm:false, no llmError)", async () => {
  const analysis = await analyzeRun(realBugEvents(), { provider: null });

  expect(analysis.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
  expect(analysis.runId).toBe(TRACE);
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBeUndefined();
  expect(analysis.explanation).toBeUndefined();
  // verdicts come straight from the classifier.
  expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  expect(analysis.verdicts.every((v) => v.source === "rule")).toBe(true);
});

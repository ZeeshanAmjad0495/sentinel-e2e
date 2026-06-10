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

import { FakeLlmProvider } from "../src/llm";
import type { LlmRunResult } from "../src/llm";

/** An indeterminate run: assertion-infrastructure system.failure the rules can't pin. */
function indeterminateEvents(): TelemetryEvent[] {
  const failure = {
    ...baseEnvelope("system.failure", "sys-1", 1, "auth.login.submit"),
    status: "error",
    errorKind: "assertion-infrastructure",
    message: "selector engine crashed",
    retryable: false,
    artifactRefs: [],
  } as TelemetryEvent;
  const finished = {
    ...baseEnvelope("flow.finished", "finish-1", 2, "auth.login"),
    status: "error",
    outcome: "system-failure",
    didDegrade: false,
  } as TelemetryEvent;
  return [failure, finished];
}

const cannedResult: LlmRunResult = {
  explanation: "Claude says the selector engine crashed mid-assertion.",
  adjudications: [
    {
      eventId: "sys-1",
      verdict: {
        kind: "infra-flake",
        confidence: 0.6,
        summary: "transient selector-engine crash",
        evidence: [],
        source: "llm",
      },
    },
  ],
};

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

test("FakeLlmProvider => explanation + adjudicated verdict merged, usedLlm:true", async () => {
  const analysis = await analyzeRun(indeterminateEvents(), {
    provider: new FakeLlmProvider(cannedResult),
  });

  expect(analysis.usedLlm).toBe(true);
  expect(analysis.llmError).toBeUndefined();
  expect(analysis.explanation).toBe(
    "Claude says the selector engine crashed mid-assertion.",
  );
  // the llm-sourced verdict is appended to the merged verdict list.
  const llmVerdict = analysis.verdicts.find((v) => v.source === "llm");
  expect(llmVerdict?.kind).toBe("infra-flake");
  expect(llmVerdict?.summary).toBe("transient selector-engine crash");
});

test("explain defaults to true => LLM invoked even with no indeterminate verdicts", async () => {
  const explainOnly: LlmRunResult = {
    explanation: "All green; one selector drifted silently.",
    adjudications: [],
  };
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new FakeLlmProvider(explainOnly),
  });
  expect(analysis.usedLlm).toBe(true);
  expect(analysis.explanation).toBe(
    "All green; one selector drifted silently.",
  );
});

test("explain:false with no indeterminate verdicts => LLM not invoked", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new FakeLlmProvider(cannedResult),
    explain: false,
  });
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.explanation).toBeUndefined();
});

import type { AnalysisContext, LlmProvider, LlmRunResult } from "../src/llm";

/** A provider whose analyze() always rejects. */
class RejectingProvider implements LlmProvider {
  analyze(_ctx: AnalysisContext): Promise<LlmRunResult> {
    return Promise.reject(new Error("rate limited"));
  }
}

test("provider.analyze rejects => usedLlm:false, llmError set, verdicts intact", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new RejectingProvider(),
  });

  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBe("rate limited");
  expect(analysis.explanation).toBeUndefined();
  // rule verdicts survive the LLM failure.
  expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  expect(analysis.verdicts.every((v) => v.source === "rule")).toBe(true);
});

test("auto-mode (provider undefined) with no ANTHROPIC_API_KEY => rules-only + llmError note", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const analysis = await analyzeRun(realBugEvents()); // no opts => explain default true
    expect(analysis.usedLlm).toBe(false);
    expect(analysis.llmError).toBe("no ANTHROPIC_API_KEY; rules-only");
    expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("explain:false, provider:null => clean rules-only, no llmError", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: null,
    explain: false,
  });
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBeUndefined();
});

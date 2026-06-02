// packages/ai/tests/llm-provider.test.ts
import { test, expect } from "@playwright/test";
import type { AnalysisContext, LlmRunResult } from "../src/llm/provider";
import { FakeLlmProvider } from "../src/llm";
import type { RunClassification } from "../src/analysis";
import type { Verdict } from "../src/verdict";

const classification: RunClassification = {
  runId: "trace-1",
  outcome: "system-failure",
  degraded: false,
  verdicts: [],
  indeterminate: [],
};

const ctx: AnalysisContext = {
  runId: "trace-1",
  outcome: "system-failure",
  classification,
  events: [],
};

const adjudicatedVerdict: Verdict = {
  kind: "real-bug",
  confidence: 0.7,
  summary: "llm decided",
  evidence: [],
  source: "llm",
};

const canned: LlmRunResult = {
  explanation: "the run failed because X",
  adjudications: [{ eventId: "e-1", verdict: adjudicatedVerdict }],
};

test("FakeLlmProvider resolves the canned result verbatim", async () => {
  const provider = new FakeLlmProvider(canned);
  const result = await provider.analyze(ctx);
  expect(result.explanation).toBe("the run failed because X");
  expect(result.adjudications).toHaveLength(1);
  expect(result.adjudications[0]?.eventId).toBe("e-1");
  expect(result.adjudications[0]?.verdict.source).toBe("llm");
});

test("barrel re-exports the interface members and FakeLlmProvider", () => {
  expect(typeof FakeLlmProvider).toBe("function");
});

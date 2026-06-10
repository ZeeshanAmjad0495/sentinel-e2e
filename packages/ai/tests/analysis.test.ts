// packages/ai/tests/analysis.test.ts
import { test, expect } from "@playwright/test";
import { ANALYSIS_SCHEMA_VERSION } from "@sentinel/ai";
import type {
  RunOutcome,
  RunClassification,
  RunAnalysis,
  Verdict,
} from "@sentinel/ai";

test("ANALYSIS_SCHEMA_VERSION is 1.0.0", () => {
  expect(ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
});

test("RunClassification and RunAnalysis compose with the analyzer outcomes", () => {
  const businessVerdict: Verdict = {
    kind: "business-outcome",
    confidence: 1,
    summary: "domain rejected: INVALID_CREDENTIALS",
    evidence: [],
    source: "rule",
  };
  const outcome: RunOutcome = "business-failure";

  const classification: RunClassification = {
    runId: "run-1",
    flowName: "auth.login",
    outcome,
    degraded: true,
    verdicts: [businessVerdict],
    indeterminate: [],
  };

  const analysis: RunAnalysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
    llmError: "no ANTHROPIC_API_KEY; rules-only",
  };

  expect(classification.degraded).toBe(true);
  expect(analysis.outcome).toBe("business-failure");
  expect(analysis.verdicts[0]?.kind).toBe("business-outcome");
  expect(analysis.usedLlm).toBe(false);
});

// packages/ai/tests/render.test.ts
import { test, expect } from "@playwright/test";
import type { RunAnalysis } from "../src/analysis";
import { ANALYSIS_SCHEMA_VERSION } from "../src/analysis";
import { toJson, toText } from "../src/render";

function sample(overrides: Partial<RunAnalysis> = {}): RunAnalysis {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: "trace-1",
    outcome: "business-failure",
    verdicts: [
      {
        kind: "business-outcome",
        confidence: 1,
        summary: "domain returned INVALID_CREDENTIALS",
        evidence: [],
        source: "rule",
      },
      {
        kind: "selector-drift",
        confidence: 0.9,
        summary: "auth.login.username degraded to rank 6",
        evidence: [],
        logicalName: "auth.login.username",
        source: "rule",
      },
    ],
    usedLlm: false,
    ...overrides,
  };
}

test("toJson round-trips a stable, indented RunAnalysis", () => {
  const json = toJson(sample());
  expect(json.endsWith("\n")).toBe(false);
  const parsed = JSON.parse(json) as RunAnalysis;
  expect(parsed.runId).toBe("trace-1");
  expect(parsed.outcome).toBe("business-failure");
  expect(parsed.verdicts).toHaveLength(2);
  expect(json).toContain('  "schemaVersion"'); // 2-space indent
});

test("toText renders outcome, runId and each verdict line", () => {
  const text = toText(sample());
  expect(text).toContain("Run trace-1");
  expect(text).toContain("Outcome: business-failure");
  expect(text).toContain("business-outcome");
  expect(text).toContain("conf 1.00");
  expect(text).toContain("domain returned INVALID_CREDENTIALS");
  expect(text).toContain("selector-drift");
  expect(text).toContain("[auth.login.username]");
});

test("toText includes the explanation when present", () => {
  const text = toText(
    sample({
      usedLlm: true,
      explanation: "The login was rejected by the app.",
    }),
  );
  expect(text).toContain("Explanation:");
  expect(text).toContain("The login was rejected by the app.");
});

test("toText shows an llmError degradation note and omits the explanation block", () => {
  const text = toText(sample({ llmError: "no ANTHROPIC_API_KEY; rules-only" }));
  expect(text).toContain("LLM: skipped (no ANTHROPIC_API_KEY; rules-only)");
  expect(text).not.toContain("Explanation:");
});

// packages/ai/tests/verdict.test.ts
import { test, expect } from "@playwright/test";
import type { VerdictKind, Evidence, Verdict } from "@sentinele2e/ai";

test("Verdict types compose into a well-formed rule verdict", () => {
  const evidence: Evidence = {
    eventId: "e-1",
    type: "locator.resolved",
    detail: "primary 'label' missed; resolved via 'css' rank 6",
    fields: { resolvedRank: 6, degraded: true },
  };
  const kind: VerdictKind = "selector-drift";
  const verdict: Verdict = {
    kind,
    confidence: 0.9,
    summary: "auth.login.username degraded to rank 6",
    evidence: [evidence],
    logicalName: "auth.login.username",
    source: "rule",
  };

  expect(verdict.kind).toBe("selector-drift");
  expect(verdict.evidence[0]?.eventId).toBe("e-1");
  expect(verdict.source).toBe("rule");
  expect(verdict.confidence).toBeGreaterThan(0);
});

test("VerdictKind admits every documented kind", () => {
  const kinds: readonly VerdictKind[] = [
    "real-bug",
    "infra-flake",
    "selector-drift",
    "healthy",
    "business-outcome",
    "indeterminate",
  ];
  expect(new Set(kinds).size).toBe(6);
});

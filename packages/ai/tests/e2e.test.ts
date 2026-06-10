// packages/ai/tests/e2e.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { analyzeRun } from "../src/analyze";
import type { Verdict } from "../src/verdict";

const FIXTURE = path.join(__dirname, "fixtures", "invalid-run.jsonl");

test("analyzeRun classifies the degraded-invalid auth run (rules-only)", async () => {
  const analysis = await analyzeRun(FIXTURE, { provider: null });

  expect(analysis.runId).toBe("trace-invalid-1");
  expect(analysis.outcome).toBe("business-failure");
  expect(analysis.usedLlm).toBe(false);

  const business = analysis.verdicts.filter(
    (v: Verdict) => v.kind === "business-outcome",
  );
  expect(business).toHaveLength(1);
  expect(
    business[0]?.evidence.some(
      (e) => e.fields?.domainReason === "INVALID_CREDENTIALS",
    ),
  ).toBe(true);

  const drift = analysis.verdicts.filter(
    (v: Verdict) => v.kind === "selector-drift",
  );
  expect(drift).toHaveLength(2);
  const driftNames = drift.map((v) => v.logicalName).sort();
  expect(driftNames).toEqual(["auth.login.password", "auth.login.username"]);

  // no real-bug present -> CLI must exit 0 (covered by the CLI task)
  expect(analysis.verdicts.some((v: Verdict) => v.kind === "real-bug")).toBe(
    false,
  );
});

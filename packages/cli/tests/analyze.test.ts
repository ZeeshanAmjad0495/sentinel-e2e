// packages/cli/tests/analyze.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { analyzeCommand } from "../src/commands/analyze";

const FIXTURES = path.join(__dirname, "fixtures");
const BUSINESS = path.join(FIXTURES, "business-outcome-run.jsonl");
const REAL_BUG = path.join(FIXTURES, "real-bug-run.jsonl");

test("analyze: business-outcome + drift run -> text, exit 0", async () => {
  const res = await analyzeCommand([BUSINESS]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("Run trace-invalid-1");
  expect(res.output).toContain("Outcome: business-failure");
  expect(res.output).toContain("business-outcome");
  expect(res.output).toContain("selector-drift");
});

test("analyze: real-bug run -> exit 1", async () => {
  const res = await analyzeCommand([REAL_BUG]);
  expect(res.exitCode).toBe(1);
  expect(res.output).toContain("real-bug");
  expect(res.output).toContain("Run trace-real-bug-1");
});

test("analyze: --json emits parseable JSON", async () => {
  const res = await analyzeCommand([BUSINESS, "--json"]);
  expect(res.exitCode).toBe(0);
  const parsed = JSON.parse(res.output) as { runId: string; outcome: string };
  expect(parsed.runId).toBe("trace-invalid-1");
  expect(parsed.outcome).toBe("business-failure");
});

test("analyze: --json still exits 1 on a real bug", async () => {
  const res = await analyzeCommand([REAL_BUG, "--json"]);
  expect(res.exitCode).toBe(1);
  const parsed = JSON.parse(res.output) as {
    verdicts: { kind: string }[];
  };
  expect(parsed.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
});

test("analyze: no path argument -> usage + exit 2", async () => {
  const res = await analyzeCommand([]);
  expect(res.exitCode).toBe(2);
  expect(res.output.toLowerCase()).toContain("usage");
});

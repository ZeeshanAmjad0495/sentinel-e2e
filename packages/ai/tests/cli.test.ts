// packages/ai/tests/cli.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { runCli } from "../src/cli";

const FIXTURE = path.join(__dirname, "fixtures", "invalid-run.jsonl");

test("runCli prints human text and exits 0 on a business-outcome run", async () => {
  const res = await runCli([FIXTURE]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("Run trace-invalid-1");
  expect(res.output).toContain("Outcome: business-failure");
  expect(res.output).toContain("business-outcome");
  expect(res.output).toContain("selector-drift");
});

test("runCli --json prints parseable JSON and exits 0", async () => {
  const res = await runCli([FIXTURE, "--json"]);
  expect(res.exitCode).toBe(0);
  const parsed = JSON.parse(res.output) as { runId: string; outcome: string };
  expect(parsed.runId).toBe("trace-invalid-1");
  expect(parsed.outcome).toBe("business-failure");
});

test("runCli errors (exit 2) when no path argument is given", async () => {
  const res = await runCli([]);
  expect(res.exitCode).toBe(2);
  expect(res.output.toLowerCase()).toContain("usage");
});

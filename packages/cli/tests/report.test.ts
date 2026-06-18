// packages/cli/tests/report.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reportCommand, buildReport } from "../src/commands/report";
import type { RunReport } from "../src/report-model";

const TELEMETRY = path.join(__dirname, "fixtures", "telemetry");

test("buildReport aggregates totals, drift, and per-run flags", async () => {
  const report = await buildReport(TELEMETRY);

  expect(report.schemaVersion).toBe("1.0.0");
  expect(report.totals.runs).toBe(3);
  expect(report.totals.realBug).toBe(1);
  expect(report.totals.infraFlake).toBe(0);
  expect(report.totals.selectorDrift).toBe(1);
  expect(report.totals.healthy).toBe(1);
  expect(report.totals.businessOutcome).toBe(1);
  expect(report.totals.driftingLocators).toEqual([
    "auth.login.password",
    "auth.login.username",
  ]);

  const realBugRun = report.runs.find((r) => r.runId === "trace-real-bug-1");
  expect(realBugRun?.hasRealBug).toBe(true);
  expect(realBugRun?.verdictCounts["real-bug"]).toBe(1);

  const businessRun = report.runs.find((r) => r.runId === "trace-invalid-1");
  expect(businessRun?.hasRealBug).toBe(false);
  expect(businessRun?.verdictCounts["selector-drift"]).toBe(2);
  expect(businessRun?.driftingLocators).toEqual([
    "auth.login.password",
    "auth.login.username",
  ]);

  const healthyRun = report.runs.find((r) => r.runId === "trace-healthy-1");
  expect(healthyRun?.verdictCounts.healthy).toBe(1);
  expect(healthyRun?.hasRealBug).toBe(false);
});

test("report: text render exits 1 when a real bug is present", async () => {
  const res = await reportCommand([TELEMETRY]);
  expect(res.exitCode).toBe(1);
  expect(res.output).toContain("trace-real-bug-1");
  expect(res.output).toContain("Totals: 3 run(s)");
  expect(res.output).toContain("real-bug 1");
});

test("report: --json emits the RunReport contract", async () => {
  const res = await reportCommand([TELEMETRY, "--json"]);
  expect(res.exitCode).toBe(1);
  const parsed = JSON.parse(res.output) as RunReport;
  expect(parsed.totals.runs).toBe(3);
  expect(parsed.totals.realBug).toBe(1);
  expect(parsed.runs).toHaveLength(3);
});

test("report: missing dir -> message + exit 0", async () => {
  const res = await reportCommand([
    path.join(os.tmpdir(), "nope-does-not-exist"),
  ]);
  expect(res.exitCode).toBe(0);
  expect(res.output.toLowerCase()).toContain("nothing to report");
});

test("report: empty dir -> message + exit 0", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-rpt-"));
  try {
    const res = await reportCommand([dir]);
    expect(res.exitCode).toBe(0);
    expect(res.output.toLowerCase()).toContain("nothing to report");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

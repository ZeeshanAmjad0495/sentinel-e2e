// packages/dashboard/tests/model.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { buildDashboardModel } from "../src/model";

const TELEMETRY = path.join(__dirname, "fixtures", "telemetry");

test("buildDashboardModel mirrors the report fixture totals", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });

  expect(model.report.schemaVersion).toBe("1.0.0");
  expect(model.report.totals.runs).toBe(3);
  expect(model.report.totals.realBug).toBe(1);
  expect(model.report.totals.infraFlake).toBe(0);
  expect(model.report.totals.selectorDrift).toBe(1);
  expect(model.report.totals.healthy).toBe(1);
  expect(model.report.totals.businessOutcome).toBe(1);
  expect(model.report.totals.driftingLocators).toEqual([
    "auth.login.password",
    "auth.login.username",
  ]);
});

test("runs are time-ordered by derived startedAt, not by filename", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });

  // Fixture start times: business=...400000 < realbug=...500000 < healthy=...700000
  // Filename order is [business, healthy, realbug]; time order must differ.
  const order = model.runs.map((r) => r.runId);
  expect(order).toEqual([
    "trace-invalid-1",
    "trace-real-bug-1",
    "trace-healthy-1",
  ]);

  // startedAt strictly ascending and equals min(startWallClockMs).
  expect(model.runs.map((r) => r.startedAt)).toEqual([
    1717322400000, 1717322500000, 1717322700000,
  ]);
  expect(model.runs[0]!.startedAt).toBeLessThan(model.runs[1]!.startedAt);
  expect(model.runs[1]!.startedAt).toBeLessThan(model.runs[2]!.startedAt);
});

test("per-run detail rebuilds verdicts and a sequence-ordered timeline", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });

  const business = model.runs.find((r) => r.runId === "trace-invalid-1")!;
  // sequence-sorted
  expect(business.timeline.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  // verdicts rebuilt from classify(redacted): two selector-drift + one business-outcome
  const kinds = business.verdicts.map((v) => v.kind).sort();
  expect(kinds).toEqual([
    "business-outcome",
    "selector-drift",
    "selector-drift",
  ]);

  const realBug = model.runs.find((r) => r.runId === "trace-real-bug-1")!;
  expect(realBug.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
});

test("timeline caps at maxEvents and raises the truncated flag", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    maxEvents: 2,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });

  for (const run of model.runs) {
    expect(run.timeline.length).toBeLessThanOrEqual(2);
    if (run.totalEvents > 2) {
      expect(run.truncated).toBe(true);
    }
  }
  expect(model.anyTruncated).toBe(true);

  const generous = await buildDashboardModel(TELEMETRY, {
    maxEvents: 500,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(generous.anyTruncated).toBe(false);
});

test("timeline axis uses only numeric wall-clock/duration (no ns arithmetic)", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  const business = model.runs.find((r) => r.runId === "trace-invalid-1")!;
  for (const entry of business.timeline) {
    expect(typeof entry.startWallClockMs).toBe("number");
    expect(Number.isFinite(entry.startWallClockMs)).toBe(true);
    if (entry.durationMs !== undefined) {
      expect(typeof entry.durationMs).toBe("number");
    }
  }
  // the locator.resolved row carries its numeric durationMs from the fixture
  const loc = business.timeline.find((t) => t.type === "locator.resolved")!;
  expect(loc.durationMs).toBe(12);
});

test("detail:false yields a rollup-only model (no per-run timelines)", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    detail: false,
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  expect(model.runs).toHaveLength(0);
  expect(model.report.totals.runs).toBe(3);
});

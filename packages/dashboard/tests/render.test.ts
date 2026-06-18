// packages/dashboard/tests/render.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { buildDashboardModel } from "../src/model";
import { generateDashboard } from "../src/render";

const TELEMETRY = path.join(__dirname, "fixtures", "telemetry");

async function html(): Promise<string> {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  return generateDashboard(model);
}

test("renders a single self-contained document with exactly one data island", async () => {
  const out = await html();
  expect(out.startsWith("<!doctype html>")).toBe(true);
  expect(out).toContain('<html lang="en">');
  // exactly one sentinel-data island
  const islands = out.match(
    /<script id="sentinel-data" type="application\/json">/g,
  );
  expect(islands).toHaveLength(1);
  // no external resources
  expect(out).not.toMatch(/<link[^>]+href=/i);
  expect(out).not.toMatch(/src="https?:/i);
});

test("header carries generatedFrom, run count and schema versions", async () => {
  const out = await html();
  expect(out).toContain("Sentinel report —");
  expect(out).toContain("3 run(s)");
  expect(out).toContain("report schema 1.0.0");
  expect(out).toContain("analysis schema 1.0.0");
});

test("totals strip uses run-level copy and omits indeterminate", async () => {
  const out = await html();
  // run-level tile copy
  expect(out).toContain("runs containing ≥1 real bug");
  expect(out).toContain("runs containing ≥1 selector drift");
  expect(out).toContain("runs containing ≥1 business outcome");
  expect(out).toContain("runs containing ≥1 healthy verdict");
  // no run-level indeterminate tile
  expect(out).not.toContain('data-total="indeterminate"');
});

test("runs table lists each run, ordered by startedAt", async () => {
  const out = await html();
  expect(out).toContain("trace-real-bug-1");
  expect(out).toContain("trace-invalid-1");
  expect(out).toContain("trace-healthy-1");
  // time order: business (earliest) before realbug before healthy (latest)
  const iBusiness = out.indexOf("trace-invalid-1");
  const iRealBug = out.indexOf("trace-real-bug-1");
  const iHealthy = out.indexOf("trace-healthy-1");
  expect(iBusiness).toBeLessThan(iRealBug);
  expect(iRealBug).toBeLessThan(iHealthy);
});

test("verdict chips include indeterminate at the verdict level (per run)", async () => {
  const model = await buildDashboardModel(TELEMETRY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  // make a run that carries an indeterminate verdict to prove the chip path
  const augmented = {
    ...model,
    report: {
      ...model.report,
      runs: model.report.runs.map((r) =>
        r.runId === "trace-real-bug-1"
          ? {
              ...r,
              verdictCounts: { ...r.verdictCounts, indeterminate: 1 },
            }
          : r,
      ),
    },
  };
  const out = generateDashboard(augmented);
  expect(out).toContain('class="chip kind-indeterminate"');
});

test("drift section renders drifting-locator chips with run counts", async () => {
  const out = await html();
  expect(out).toContain("Drifting locators");
  expect(out).toContain("auth.login.username");
  expect(out).toContain("auth.login.password");
});

test("per-run drill-down contains a timeline and verdict evidence", async () => {
  const out = await html();
  // timeline markers and a real-bug verdict block
  expect(out).toContain('class="timeline"');
  expect(out).toContain('class="verdict"');
  expect(out).toContain('class="evidence-link"');
  // a degraded badge from the drifting business run
  expect(out).toContain('class="badge-degraded"');
});

test("STABLE-SUBSET snapshot of structural anchors, headings and counts", async () => {
  const out = await html();
  // Extract only stable structural signals — never the CSS/copy blob.
  const subset = {
    doctype: out.startsWith("<!doctype html>"),
    dataIslands: (
      out.match(/<script id="sentinel-data" type="application\/json">/g) ?? []
    ).length,
    headings: (out.match(/<h[123][^>]*>([^<]*)<\/h[123]>/g) ?? []).map((h) =>
      // Normalize the H1's machine-dependent generatedFrom path away.
      h
        .replace(/<[^>]+>/g, "")
        .trim()
        .replace(/^(Sentinel report —).*/, "$1"),
    ),
    totalTiles: (out.match(/data-total="[^"]+"/g) ?? []).length,
    runRows: (out.match(/<tr class="run-row"/g) ?? []).length,
    detailRows: (out.match(/<tr class="run-detail-row"/g) ?? []).length,
    hasFilter: out.includes('id="filter-kind"'),
  };
  expect(subset).toEqual({
    doctype: true,
    dataIslands: 1,
    headings: [
      "Sentinel report —",
      "Drifting locators",
      "Runs",
      // three per-run drill-downs each contribute Timeline + Verdicts headings
      "Timeline",
      "Verdicts",
      "Timeline",
      "Verdicts",
      "Timeline",
      "Verdicts",
    ],
    totalTiles: 6, // total runs + 5 run-level kinds (indeterminate absent)
    runRows: 3,
    detailRows: 3,
    hasFilter: true,
  });
});

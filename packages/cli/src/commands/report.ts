// packages/cli/src/commands/report.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeRun } from "@sentinele2e/ai";
import type { RunAnalysis, VerdictKind } from "@sentinele2e/ai";
import type { CliResult } from "../dispatch";
import { loadConfig } from "../config";
import {
  REPORT_SCHEMA_VERSION,
  type RunReport,
  type RunSummary,
} from "../report-model";

const VERDICT_KINDS: readonly VerdictKind[] = [
  "real-bug",
  "infra-flake",
  "selector-drift",
  "healthy",
  "business-outcome",
  "indeterminate",
];

function emptyCounts(): Record<VerdictKind, number> {
  return {
    "real-bug": 0,
    "infra-flake": 0,
    "selector-drift": 0,
    healthy: 0,
    "business-outcome": 0,
    indeterminate: 0,
  };
}

/** Roll one run's analysis up into a RunSummary. */
function summarize(file: string, analysis: RunAnalysis): RunSummary {
  const verdictCounts = emptyCounts();
  const drifting = new Set<string>();
  for (const v of analysis.verdicts) {
    verdictCounts[v.kind] += 1;
    if (v.kind === "selector-drift" && v.logicalName) {
      drifting.add(v.logicalName);
    }
  }
  return {
    runId: analysis.runId,
    file: path.basename(file),
    outcome: analysis.outcome,
    verdictCounts,
    driftingLocators: [...drifting].sort(),
    hasRealBug: verdictCounts["real-bug"] > 0,
  };
}

/**
 * Aggregate every `*.jsonl` in `dir` into a RunReport. Each run is classified
 * with the deterministic analyzer ({provider:null}). The totals.<kind> fields
 * count how many RUNS contain at least one verdict of that kind (run-level
 * signal), distinct from per-run `verdictCounts` (verdict-level).
 */
export async function buildReport(dir: string): Promise<RunReport> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .map((f) => path.join(dir, f));

  const runs: RunSummary[] = [];
  for (const file of files) {
    const analysis = await analyzeRun(file, { provider: null });
    runs.push(summarize(file, analysis));
  }

  const drifting = new Set<string>();
  const totals = {
    runs: runs.length,
    realBug: 0,
    infraFlake: 0,
    selectorDrift: 0,
    healthy: 0,
    businessOutcome: 0,
    driftingLocators: [] as string[],
  };
  for (const r of runs) {
    if (r.verdictCounts["real-bug"] > 0) totals.realBug += 1;
    if (r.verdictCounts["infra-flake"] > 0) totals.infraFlake += 1;
    if (r.verdictCounts["selector-drift"] > 0) totals.selectorDrift += 1;
    if (r.verdictCounts.healthy > 0) totals.healthy += 1;
    if (r.verdictCounts["business-outcome"] > 0) totals.businessOutcome += 1;
    for (const loc of r.driftingLocators) drifting.add(loc);
  }
  totals.driftingLocators = [...drifting].sort();

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedFrom: dir,
    runs,
    totals,
  };
}

/** Human-readable run table + totals footer. */
function renderText(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`Sentinel report — ${report.generatedFrom}`);
  lines.push("");
  if (report.runs.length === 0) {
    lines.push("(no runs)");
    return lines.join("\n");
  }
  lines.push("RUN                            OUTCOME            VERDICTS");
  for (const r of report.runs) {
    const verdicts = VERDICT_KINDS.filter((k) => r.verdictCounts[k] > 0)
      .map((k) => `${k}×${r.verdictCounts[k]}`)
      .join(", ");
    lines.push(
      `${r.runId.padEnd(30)} ${r.outcome.padEnd(18)} ${verdicts || "(none)"}`,
    );
  }
  lines.push("");
  lines.push(
    `Totals: ${report.totals.runs} run(s) — ` +
      `real-bug ${report.totals.realBug}, ` +
      `infra-flake ${report.totals.infraFlake}, ` +
      `selector-drift ${report.totals.selectorDrift}, ` +
      `business-outcome ${report.totals.businessOutcome}, ` +
      `healthy ${report.totals.healthy}`,
  );
  if (report.totals.driftingLocators.length > 0) {
    lines.push(
      `Drifting locators: ${report.totals.driftingLocators.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * `sentinel report [dir] [--json]`. `dir` defaults to config.telemetryDir.
 * Exit 1 iff any run contains a real bug; an empty/missing dir is not an error
 * (clear message + exit 0 — there is simply nothing to report).
 */
export async function reportCommand(
  args: readonly string[],
): Promise<CliResult> {
  const asJson = args.includes("--json");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const dir = dirArg ?? loadConfig().telemetryDir;

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      output: `No telemetry directory at '${dir}' — nothing to report.`,
      exitCode: 0,
    };
  }

  const report = await buildReport(dir);
  if (report.runs.length === 0) {
    return {
      output: asJson
        ? JSON.stringify(report, null, 2)
        : `No *.jsonl runs in '${dir}' — nothing to report.`,
      exitCode: 0,
    };
  }

  const output = asJson ? JSON.stringify(report, null, 2) : renderText(report);
  const hasRealBug = report.totals.realBug > 0;
  return { output, exitCode: hasRealBug ? 1 : 0 };
}

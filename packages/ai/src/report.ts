// packages/ai/src/report.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeRun } from "./analyze";
import type { RunAnalysis } from "./analysis";
import type { RunOutcome } from "./analysis";
import type { VerdictKind } from "./verdict";

/** Bumped independently of the analyzer schema; this is the dashboard contract. */
export const REPORT_SCHEMA_VERSION = "1.0.0";

/** Per-run rollup: one telemetry JSONL file -> one summary. */
export interface RunSummary {
  readonly runId: string;
  readonly file: string;
  readonly outcome: RunOutcome;
  readonly verdictCounts: Record<VerdictKind, number>;
  /** logicalNames that drifted to a fallback locator in this run. */
  readonly driftingLocators: string[];
  readonly hasRealBug: boolean;
}

/**
 * The cross-run aggregate produced by `sentinel report`. This JSON shape is the
 * input contract the slice-F dashboard renders — keep it stable.
 */
export interface RunReport {
  readonly schemaVersion: string;
  /** The directory the report was generated from. */
  readonly generatedFrom: string;
  readonly runs: RunSummary[];
  readonly totals: {
    readonly runs: number;
    readonly realBug: number;
    readonly infraFlake: number;
    readonly selectorDrift: number;
    readonly healthy: number;
    readonly businessOutcome: number;
    /** the union of every run's drifting logicalNames (deduped). */
    readonly driftingLocators: string[];
  };
}

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

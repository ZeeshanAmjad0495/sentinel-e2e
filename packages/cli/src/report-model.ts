// packages/cli/src/report-model.ts
import type { RunOutcome, VerdictKind } from "@sentinele2e/ai";

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

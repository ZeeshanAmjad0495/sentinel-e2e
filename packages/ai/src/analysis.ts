import type { TelemetryEvent } from "@sentinel/core";
import type { Verdict } from "./verdict";

export type RunOutcome =
  | "success"
  | "business-failure"
  | "system-failure"
  | "unknown";

export interface RunClassification {
  readonly runId: string; // == traceId
  readonly flowName?: string;
  readonly outcome: RunOutcome;
  readonly degraded: boolean; // any silent selector drift (even on a passing run)
  readonly verdicts: readonly Verdict[]; // rule verdicts (defects, drift, business outcome, healthy)
  readonly indeterminate: readonly Verdict[]; // the subset to send to the LLM for adjudication
}

export const ANALYSIS_SCHEMA_VERSION = "1.0.0";

export interface RunAnalysis {
  readonly schemaVersion: string; // ANALYSIS_SCHEMA_VERSION
  readonly runId: string;
  readonly outcome: RunOutcome;
  readonly verdicts: readonly Verdict[]; // rule verdicts merged with any LLM adjudications
  readonly explanation?: string; // Claude's plain-language run explanation (when LLM used)
  readonly usedLlm: boolean;
  readonly llmError?: string; // set when the LLM was attempted but skipped/failed (graceful)
}

// `TelemetryEvent` is the consumed input type across the @sentinel/ai pipeline;
// re-export it here so downstream modules import it from a single analyzer surface.
export type { TelemetryEvent };

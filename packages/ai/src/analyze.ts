// packages/ai/src/analyze.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { LlmProvider } from "./llm/provider";
import { ANALYSIS_SCHEMA_VERSION, type RunAnalysis } from "./analysis";
import { loadEvents } from "./load";
import { classify } from "./classify";

export interface AnalyzeOptions {
  /** undefined = auto (ClaudeProvider iff ANTHROPIC_API_KEY present); null = force rules-only. */
  readonly provider?: LlmProvider | null;
  readonly explain?: boolean; // default true
}

export async function analyzeRun(
  input: string | readonly TelemetryEvent[], // JSONL path or in-memory events
  opts?: AnalyzeOptions,
): Promise<RunAnalysis> {
  const events = loadEvents(input);
  const classification = classify(events);

  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
  };
}

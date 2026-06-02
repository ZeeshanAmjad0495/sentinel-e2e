// packages/ai/src/llm/provider.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { RunClassification, RunOutcome } from "../analysis";
import type { Verdict } from "../verdict";

export interface AnalysisContext {
  readonly runId: string;
  readonly outcome: RunOutcome;
  readonly classification: RunClassification; // the deterministic verdicts
  readonly events: readonly TelemetryEvent[]; // REDACTED, compacted events
}

export interface LlmAdjudication {
  readonly logicalName?: string;
  readonly eventId?: string;
  readonly verdict: Verdict; // source: "llm"
}

export interface LlmRunResult {
  readonly explanation: string; // plain-language run explanation
  readonly adjudications: readonly LlmAdjudication[]; // verdicts for the indeterminate cases
}

export interface LlmProvider {
  analyze(ctx: AnalysisContext): Promise<LlmRunResult>;
}

/** Deterministic canned provider for tests — zero API calls. */
export class FakeLlmProvider implements LlmProvider {
  constructor(private readonly canned: LlmRunResult) {}
  analyze(): Promise<LlmRunResult> {
    return Promise.resolve(this.canned);
  }
}

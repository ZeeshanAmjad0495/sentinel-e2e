// packages/ai/src/analyze.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { AnalysisContext, LlmProvider } from "./llm/provider";
import {
  ANALYSIS_SCHEMA_VERSION,
  type RunAnalysis,
  type RunClassification,
} from "./analysis";
import type { Verdict } from "./verdict";
import { loadEvents } from "./load";
import { classify } from "./classify";
import { redactEvents } from "./redact";

export interface AnalyzeOptions {
  /** undefined = auto (ClaudeProvider iff ANTHROPIC_API_KEY present); null = force rules-only. */
  readonly provider?: LlmProvider | null;
  readonly explain?: boolean; // default true
}

/**
 * Resolve the provider per spec §6:
 *   - explicit provider (incl. a fake) wins;
 *   - null forces rules-only;
 *   - undefined => auto: a ClaudeProvider IFF ANTHROPIC_API_KEY is set, else none.
 * The claude provider is imported LAZILY so importing @sentinel/ai never pulls
 * @anthropic-ai/sdk into the deterministic path.
 */
async function resolveProvider(
  provider: LlmProvider | null | undefined,
): Promise<LlmProvider | null> {
  if (provider !== undefined) return provider; // explicit provider OR null
  if (!process.env.ANTHROPIC_API_KEY) return null; // auto, no key => none
  const { ClaudeProvider } = await import("./llm/claude-provider");
  return new ClaudeProvider();
}

/** Append llm-sourced adjudications to the rule verdicts (rules are never overridden). */
function mergeVerdicts(
  classification: RunClassification,
  adjudications: readonly { verdict: Verdict }[],
): readonly Verdict[] {
  return [...classification.verdicts, ...adjudications.map((a) => a.verdict)];
}

export async function analyzeRun(
  input: string | readonly TelemetryEvent[], // JSONL path or in-memory events
  opts?: AnalyzeOptions,
): Promise<RunAnalysis> {
  const events = loadEvents(input);
  const classification = classify(events);
  const explain = opts?.explain ?? true;

  const base: RunAnalysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
  };

  let provider: LlmProvider | null;
  try {
    provider = await resolveProvider(opts?.provider);
  } catch (err) {
    // a lazy-import / construction failure must never fail the analysis.
    return { ...base, llmError: errorMessage(err) };
  }

  const shouldUseLlm =
    provider !== null && (classification.indeterminate.length > 0 || explain);

  // auto-mode with explain requested but no key/provider => note it, rules-only.
  if (provider === null) {
    if (opts?.provider === undefined && explain) {
      return { ...base, llmError: "no ANTHROPIC_API_KEY; rules-only" };
    }
    return base;
  }

  if (!shouldUseLlm) return base;

  const ctx: AnalysisContext = {
    runId: classification.runId,
    outcome: classification.outcome,
    classification,
    events: redactEvents(events),
  };

  try {
    const result = await provider.analyze(ctx);
    return {
      ...base,
      usedLlm: true,
      explanation: result.explanation,
      verdicts: mergeVerdicts(classification, result.adjudications),
    };
  } catch (err) {
    // graceful: rules verdicts intact, LLM skipped.
    return { ...base, llmError: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

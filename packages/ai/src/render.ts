// packages/ai/src/render.ts
import type { RunAnalysis } from "./analysis";
import type { Verdict } from "./verdict";

/** The machine artifact: pretty-printed, no trailing newline. */
export function toJson(analysis: RunAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}

function renderVerdict(v: Verdict): string {
  const tag = v.logicalName ? ` [${v.logicalName}]` : "";
  const conf = v.confidence.toFixed(2);
  return `  - ${v.kind} (conf ${conf}, ${v.source})${tag}: ${v.summary}`;
}

/** Human-readable terminal/markdown summary derived from the RunAnalysis. */
export function toText(analysis: RunAnalysis): string {
  const lines: string[] = [];
  lines.push(`Run ${analysis.runId}`);
  lines.push(`Outcome: ${analysis.outcome}`);
  if (analysis.verdicts.length === 0) {
    lines.push("Verdicts: (none)");
  } else {
    lines.push("Verdicts:");
    for (const v of analysis.verdicts) {
      lines.push(renderVerdict(v));
    }
  }
  if (analysis.explanation !== undefined) {
    lines.push("");
    lines.push("Explanation:");
    lines.push(analysis.explanation);
  }
  if (analysis.llmError !== undefined) {
    lines.push("");
    lines.push(`LLM: skipped (${analysis.llmError})`);
  }
  return lines.join("\n");
}

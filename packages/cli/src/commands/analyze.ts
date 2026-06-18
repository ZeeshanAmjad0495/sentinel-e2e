// packages/cli/src/commands/analyze.ts
import { analyzeRun, toJson, toText } from "@sentinel/ai";
import type { Verdict } from "@sentinel/ai";
import type { CliResult } from "../dispatch";

const USAGE = "usage: sentinel analyze <run.jsonl> [--json]";

/**
 * Classify a single telemetry run. Delegates to @sentinel/ai's deterministic
 * (rules-only) analyzer — `provider: null` — so the CLI never needs an API key.
 * Exit 1 iff a `real-bug` verdict is present (so CI can fail on genuine
 * regressions while tolerating drift/business outcomes); else exit 0.
 */
export async function analyzeCommand(
  args: readonly string[],
): Promise<CliResult> {
  const asJson = args.includes("--json");
  const pathArg = args.find((a) => !a.startsWith("--"));
  if (pathArg === undefined) {
    return { output: USAGE, exitCode: 2 };
  }

  const analysis = await analyzeRun(pathArg, { provider: null });
  const output = asJson ? toJson(analysis) : toText(analysis);
  const hasRealBug = analysis.verdicts.some(
    (v: Verdict) => v.kind === "real-bug",
  );
  return { output, exitCode: hasRealBug ? 1 : 0 };
}

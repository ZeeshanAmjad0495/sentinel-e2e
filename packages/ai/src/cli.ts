#!/usr/bin/env node
// packages/ai/src/cli.ts
import { analyzeRun } from "./analyze";
import { toJson, toText } from "./render";
import type { Verdict } from "./verdict";

export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

const USAGE = "usage: sentinel-analyze <path-to-jsonl> [--json]";

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const args = argv.filter((a) => a !== "--json");
  const asJson = argv.includes("--json");
  const pathArg = args[0];
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

/* istanbul ignore next -- thin process shim, exercised via the `analyze` script */
async function main(): Promise<void> {
  const res = await runCli(process.argv.slice(2));
  process.stdout.write(res.output + "\n");
  process.exitCode = res.exitCode;
}

if (require.main === module) {
  void main();
}

// packages/cli/src/commands/analyze.ts
import type { CliResult } from "../dispatch";

// E2 will wire this to @sentinel/ai analyzeRun + toText/toJson.
export function analyzeCommand(_args: readonly string[]): Promise<CliResult> {
  return Promise.resolve({
    output: "analyze: not yet implemented",
    exitCode: 0,
  });
}

// packages/cli/src/commands/run.ts
import type { CliResult } from "../dispatch";

// E5 will resolve config and spawn `npx playwright test`.
export function runCommand(_args: readonly string[]): Promise<CliResult> {
  return Promise.resolve({ output: "run: not yet implemented", exitCode: 0 });
}

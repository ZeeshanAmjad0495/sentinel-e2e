// packages/cli/src/commands/init.ts
import type { CliResult } from "../dispatch";

// E4 will scaffold a starter project.
export function initCommand(_args: readonly string[]): Promise<CliResult> {
  return Promise.resolve({ output: "init: not yet implemented", exitCode: 0 });
}

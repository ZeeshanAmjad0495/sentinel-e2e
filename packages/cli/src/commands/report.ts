// packages/cli/src/commands/report.ts
import type { CliResult } from "../dispatch";

// E3 will aggregate the telemetry dir into a RunReport.
export function reportCommand(_args: readonly string[]): Promise<CliResult> {
  return Promise.resolve({
    output: "report: not yet implemented",
    exitCode: 0,
  });
}

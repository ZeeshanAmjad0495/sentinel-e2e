// packages/cli/src/dispatch.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeCommand } from "./commands/analyze";
import { reportCommand } from "./commands/report";
import { initCommand } from "./commands/init";
import { runCommand } from "./commands/run";

export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

export const USAGE = `usage: sentinel <command> [args] [--flags]

Commands:
  analyze <run.jsonl> [--json]   Classify one telemetry run (exit 1 iff a real bug).
  report [dir] [--json]          Aggregate a telemetry dir into a cross-run RunReport.
  init [dir] [--force]           Scaffold a starter Sentinel project.
  run [pattern] [--config <p>] [--dry-run]
                                 Shell out to the project runner (npx playwright test).

Flags:
  --help                         Print this usage.
  --version                      Print the @sentinel/cli version.`;

/** Resolve the package version from package.json (works from src/ or dist/). */
function packageVersion(): string {
  const candidates = [
    path.join(__dirname, "..", "package.json"), // dist/ -> package.json
    path.join(__dirname, "..", "..", "package.json"), // src/ -> package.json
  ];
  for (const c of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(c, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (typeof pkg.version === "string") return pkg.version;
    } catch {
      // try the next candidate
    }
  }
  return "0.0.0";
}

/**
 * Parse argv and route to a command. Returns a CliResult (output + exitCode);
 * the thin process shim in cli.ts performs the actual I/O and process.exit.
 *
 *   - no command, `--help`            -> usage, exit 0
 *   - `--version`                     -> version, exit 0
 *   - analyze/report/init/run         -> the matching command handler
 *   - unknown command                 -> usage, exit 2
 */
export async function run(argv: readonly string[]): Promise<CliResult> {
  const first = argv[0];

  if (first === undefined || first === "--help" || first === "-h") {
    return { output: USAGE, exitCode: 0 };
  }
  if (first === "--version" || first === "-v") {
    return { output: packageVersion(), exitCode: 0 };
  }

  const rest = argv.slice(1);
  switch (first) {
    case "analyze":
      return analyzeCommand(rest);
    case "report":
      return reportCommand(rest);
    case "init":
      return initCommand(rest);
    case "run":
      return runCommand(rest);
    default:
      return { output: `unknown command: ${first}\n\n${USAGE}`, exitCode: 2 };
  }
}

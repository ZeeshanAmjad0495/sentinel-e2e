// packages/cli/src/commands/run.ts
import { spawn } from "node:child_process";
import { loadConfig } from "../config";
import type { CliResult } from "../dispatch";

interface RunArgs {
  readonly pattern?: string;
  readonly configPath?: string;
  readonly dryRun: boolean;
}

/**
 * Parse `run` argv: a positional test pattern, `--config <path>` (overrides the
 * runner config), and `--dry-run`. `--config` consumes the following token.
 */
function parseRunArgs(args: readonly string[]): RunArgs {
  let pattern: string | undefined;
  let configPath: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--config" || a === "-c") {
      configPath = args[i + 1];
      i++; // skip the consumed value
    } else if (a !== undefined && !a.startsWith("-")) {
      pattern ??= a;
    }
  }
  return { pattern, configPath, dryRun };
}

/** Build the runner argv: `playwright test -c <config> [pattern]`. */
export function buildRunnerArgs(
  configPath: string,
  pattern?: string,
): string[] {
  const argv = ["playwright", "test", "-c", configPath];
  if (pattern) argv.push(pattern);
  return argv;
}

/** The printable command string for `--dry-run` / hints. */
export function runnerCommand(configPath: string, pattern?: string): string {
  return `npx ${buildRunnerArgs(configPath, pattern).join(" ")}`;
}

/**
 * `sentinel run [pattern] [--config <path>] [--dry-run]`. Loads config and
 * SHELLS OUT to the project's runner (`npx playwright test`) — the CLI never
 * imports a driver. `--dry-run` prints the resolved command and exits 0 (the
 * offline-testable path); a real run spawns the runner inheriting stdio. After
 * a real run, a hint to `sentinel report` is printed.
 */
export async function runCommand(args: readonly string[]): Promise<CliResult> {
  const { pattern, configPath, dryRun } = parseRunArgs(args);
  const config = loadConfig();
  const resolvedConfig = configPath ?? config.playwrightConfig;
  const command = runnerCommand(resolvedConfig, pattern);

  if (dryRun) {
    return { output: `[dry-run] ${command}`, exitCode: 0 };
  }

  /* istanbul ignore next -- real spawn needs a project + browser; covered by
     --dry-run + a documented manual check (see README / spec §5). */
  const exitCode = await new Promise<number>((resolve) => {
    const argv = buildRunnerArgs(resolvedConfig, pattern);
    const child = spawn("npx", argv, { stdio: "inherit", shell: false });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 0));
  });

  const hint =
    exitCode === 0
      ? `\nRun complete. Classify the runs with: sentinel report`
      : "";
  return { output: hint.trim(), exitCode };
}

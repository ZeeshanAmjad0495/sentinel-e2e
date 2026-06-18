// packages/cli/src/config.ts
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Sentinel project configuration, loaded from `sentinel.config.json`.
 * JSON (not .ts) so the standalone `node dist/cli.js` bin can load it without a
 * TypeScript loader. All fields are optional in the file; defaults fill the rest.
 */
export interface SentinelConfig {
  /** Directory the flows write JSONL telemetry into; `report` reads it. */
  readonly telemetryDir: string;
  /** The project's test directory. */
  readonly testDir: string;
  /** The test runner the `run` command shells out to. */
  readonly runner: string;
  /** Path to the runner config (e.g. playwright.config.ts) passed via `-c`. */
  readonly playwrightConfig: string;
}

export const CONFIG_FILENAME = "sentinel.config.json";

export const DEFAULT_CONFIG: SentinelConfig = {
  telemetryDir: "test-results/telemetry",
  testDir: "tests",
  runner: "playwright",
  playwrightConfig: "playwright.config.ts",
};

/**
 * Load `sentinel.config.json` from `cwd`, merged over the defaults. A missing
 * file is fine — defaults are returned. Unknown keys are ignored; recognised
 * keys override the matching default only when present and well-typed.
 */
export function loadConfig(cwd: string = process.cwd()): SentinelConfig {
  const file = path.join(cwd, CONFIG_FILENAME);
  if (!fs.existsSync(file)) return DEFAULT_CONFIG;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid ${CONFIG_FILENAME}: ${reason}`);
  }
  if (parsed === null || typeof parsed !== "object") return DEFAULT_CONFIG;

  const raw = parsed as Record<string, unknown>;
  const pick = (key: keyof SentinelConfig): string =>
    typeof raw[key] === "string" ? (raw[key] as string) : DEFAULT_CONFIG[key];

  return {
    telemetryDir: pick("telemetryDir"),
    testDir: pick("testDir"),
    runner: pick("runner"),
    playwrightConfig: pick("playwrightConfig"),
  };
}

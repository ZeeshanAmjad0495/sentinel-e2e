// packages/cli/src/commands/init.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "../config";
import type { CliResult } from "../dispatch";

interface ScaffoldFile {
  readonly relPath: string;
  readonly content: string;
}

const PKG_JSON = JSON.stringify(
  {
    name: "my-sentinel-project",
    version: "0.0.0",
    private: true,
    scripts: {
      test: "sentinel run",
      analyze: "sentinel report",
    },
    dependencies: {
      "@sentinele2e/contracts": "^0.1.0",
      "@sentinele2e/core": "^0.1.0",
      "@sentinele2e/driver-playwright": "^0.1.0",
    },
    devDependencies: {
      "@playwright/test": "^1.58.2",
      "@sentinele2e/cli": "^0.1.0",
    },
  },
  null,
  2,
);

const SENTINEL_CONFIG = JSON.stringify(
  {
    telemetryDir: DEFAULT_CONFIG.telemetryDir,
    testDir: DEFAULT_CONFIG.testDir,
    runner: DEFAULT_CONFIG.runner,
    playwrightConfig: DEFAULT_CONFIG.playwrightConfig,
  },
  null,
  2,
);

const PLAYWRIGHT_CONFIG = `import { defineConfig } from "@playwright/test";

// Sentinel projects own the Playwright runner; \`sentinel run\` shells out to it.
// The flows emit @sentinele2e/core telemetry into \`${DEFAULT_CONFIG.telemetryDir}\`;
// run \`sentinel report\` afterwards to classify the runs.
export default defineConfig({
  testDir: "./${DEFAULT_CONFIG.testDir}",
  timeout: 30_000,
  retries: 0,
  use: {
    headless: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  fullyParallel: true,
});
`;

const SAMPLE_FLOW = `// tests/flows/example.ts
// A Sentinel flow drives the app through the driver and emits telemetry.
// Replace this stub with your own flow built on @sentinele2e/driver-playwright.
export interface ExampleFlowResult {
  readonly ok: boolean;
}

export function describeExampleFlow(): string {
  return "example: navigate, assert a stable locator, finish";
}
`;

const SAMPLE_SPEC = `import { test, expect } from "@playwright/test";
import { describeExampleFlow } from "./flows/example";

// A starter spec. Swap the body for a real flow run that emits telemetry into
// the configured telemetryDir; then \`sentinel report\` classifies the run.
test("example flow is described", () => {
  expect(describeExampleFlow()).toContain("example");
});
`;

const GITIGNORE = `node_modules/
test-results/
playwright-report/
`;

function scaffoldFiles(): readonly ScaffoldFile[] {
  return [
    { relPath: "package.json", content: PKG_JSON + "\n" },
    { relPath: "sentinel.config.json", content: SENTINEL_CONFIG + "\n" },
    { relPath: "playwright.config.ts", content: PLAYWRIGHT_CONFIG },
    {
      relPath: path.join("tests", "flows", "example.ts"),
      content: SAMPLE_FLOW,
    },
    { relPath: path.join("tests", "example.spec.ts"), content: SAMPLE_SPEC },
    { relPath: ".gitignore", content: GITIGNORE },
  ];
}

/** A dir is "non-empty" if it exists and contains any visible entry. */
function isNonEmptyDir(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  if (!fs.statSync(dir).isDirectory()) return true; // a file at that path blocks us
  return fs.readdirSync(dir).length > 0;
}

/**
 * `sentinel init [dir] [--force]`. Scaffolds a runnable starter project into
 * `dir` (default `.`). Refuses to write into a non-empty dir unless `--force`,
 * so an existing project is never clobbered. Offline — writes files only.
 */
export function initCommand(args: readonly string[]): Promise<CliResult> {
  const force = args.includes("--force");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const dir = path.resolve(dirArg ?? ".");

  if (isNonEmptyDir(dir) && !force) {
    return Promise.resolve({
      output:
        `Refusing to scaffold into non-empty directory '${dir}'.\n` +
        `Re-run with --force to write anyway.`,
      exitCode: 1,
    });
  }

  const written: string[] = [];
  for (const f of scaffoldFiles()) {
    const dest = path.join(dir, f.relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    written.push(f.relPath);
  }

  const next = [
    `Scaffolded a Sentinel project into '${dir}':`,
    ...written.map((w) => `  + ${w}`),
    "",
    "Next steps:",
    "  1. npm install",
    "  2. npx playwright install   # browsers for the runner",
    "  3. sentinel run             # run the flows (emits telemetry)",
    "  4. sentinel report          # classify the runs",
  ].join("\n");

  return Promise.resolve({ output: next, exitCode: 0 });
}

# @sentinele2e/cli

The unified `sentinel` command for [Sentinel](https://github.com/ZeeshanAmjad0495/sentinel-e2e) — the operator entry point. It scaffolds a project, runs your flows, and turns the emitted telemetry into a defect classification. The CLI is **driver-agnostic**: it depends only on `@sentinele2e/ai` + `@sentinele2e/core`/`@sentinele2e/contracts` and **shells out** to your project's test runner (`npx playwright test`), so it never imports a browser driver — your project owns that.

## Install

```sh
npm install -D @sentinele2e/cli
```

## Commands

```sh
sentinel init [dir] [--force]            # scaffold a starter project
sentinel run [pattern] [--config <p>] [--dry-run]
                                         # shell out to `npx playwright test`
sentinel analyze <run.jsonl> [--json]    # classify one run (exit 1 iff a real bug)
sentinel report [dir] [--json]           # aggregate a telemetry dir -> RunReport
sentinel --help | --version
```

- **`analyze`** delegates to `@sentinele2e/ai` (rules-only, no API key) and exits `1` iff a `real-bug` verdict is present.
- **`report`** reads every `*.jsonl` in `dir` (default `config.telemetryDir`), classifies each run, and prints a cross-run table (or `--json`). Exits `1` iff any run has a real bug; an empty/missing dir is not an error.
- **`run`** builds `npx playwright test -c <playwrightConfig> [pattern]`. `--dry-run` prints the command and exits 0 without spawning (the offline-testable path). A real run spawns the runner inheriting stdio, then hints at `sentinel report`. A real spawn needs a project + installed browsers, so it is exercised manually, not in offline CI (spec §5).

## Configuration — `sentinel.config.json`

JSON so the standalone `node dist/cli.js` bin can load it without a TypeScript loader. Missing file → defaults; no config is required for `analyze`/`report`.

| Field              | Default                  | Used by         |
| ------------------ | ------------------------ | --------------- |
| `telemetryDir`     | `test-results/telemetry` | `report`        |
| `testDir`          | `tests`                  | scaffold / docs |
| `runner`           | `playwright`             | `run`           |
| `playwrightConfig` | `playwright.config.ts`   | `run`           |

## `RunReport` — the dashboard contract

`sentinel report --json` emits a `RunReport` (`schemaVersion`, `generatedFrom`, `runs[]` of `RunSummary`, and cross-run `totals`). This JSON shape is the input contract the Sentinel dashboard (slice F) renders; both the CLI table and the dashboard read the same structure. The type is exported from the package barrel.

See the [root README](https://github.com/ZeeshanAmjad0495/sentinel-e2e#readme) for the full Sentinel overview.

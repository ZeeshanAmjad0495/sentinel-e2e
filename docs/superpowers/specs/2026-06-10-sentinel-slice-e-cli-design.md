# Sentinel Slice E — Unified `sentinel` CLI: Design Spec

- **Status:** Approved (lean spec — CLI surface; decisions documented inline)
- **Date:** 2026-06-10
- **Branch:** `main` (no PRs; push each green phase)
- **Scope:** A unified `@sentinele2e/cli` package exposing a single `sentinel` binary with `init`, `run`, `analyze`, and `report` — the operator entry point. Driver-agnostic (depends only on `@sentinele2e/ai` + `@sentinele2e/core`/`@sentinele2e/contracts`; it shells out to the project's test runner for `run`). Offline-testable; `npm pack`-ready (slice-D conventions).

---

## 0. Locked decisions

| #   | Decision                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-1 | **New package `@sentinele2e/cli`, bin `sentinel`**              | One operator entry point. `@sentinele2e/ai` keeps its `sentinel-analyze` bin (back-compat); `sentinel analyze` is the unified alias that delegates to the same code.                                                                                                                                                                                                                                             |
| E-2 | **Driver-agnostic CLI**                                         | `@sentinele2e/cli` imports `@sentinele2e/ai` (analyze/report) + core/contracts only — NO driver. `run` shells out to the project's runner (`npx playwright test`), so the CLI never imports a driver; the user's project owns the driver. Lint boundary bans driver imports from `@sentinele2e/cli` (mirrors `@sentinele2e/ai`).                                                                                 |
| E-3 | **Config = `sentinel.config.json`** (not `.ts`)                 | The standalone `node dist/cli.js` bin can't load TS without a loader. JSON is loadable everywhere. Fields: `telemetryDir` (default `test-results/telemetry`), `testDir` (default `tests`), `runner` (default `playwright`), `playwrightConfig` (path). Missing config → sensible defaults; no config file required for `analyze`/`report`.                                                                       |
| E-4 | **Hand-rolled arg parsing (zero deps)**                         | A tiny dispatcher (`sentinel <command> [args] [--flags]`) — no `commander`/`yargs` dependency, keeping the package lean and the install light.                                                                                                                                                                                                                                                                   |
| E-5 | **`report` aggregates the telemetry dir → a cross-run summary** | Reads every `*.jsonl` in `telemetryDir`, classifies each run via `@sentinele2e/ai` `analyzeRun(..., {provider:null})`, and aggregates: per-run outcome + verdict counts (real-bug / infra-flake / selector-drift / business-outcome / healthy), the set of drifting `logicalName`s, and which runs contain real bugs. This is the **data layer the slice-F dashboard will render** — same JSON shape feeds both. |

---

## 1. Package layout & wiring

```
packages/cli/
  package.json   tsconfig.json   README.md
  src/
    index.ts          # barrel (programmatic API: run(argv) -> CliResult)
    cli.ts            # #!/usr/bin/env node shim -> dispatch -> process.exit
    dispatch.ts       # parse argv -> route to a command; --help/--version
    config.ts         # loadConfig(cwd): SentinelConfig (json + defaults)
    commands/
      analyze.ts      # delegates to @sentinele2e/ai analyzeRun + render
      report.ts       # aggregate telemetryDir/*.jsonl -> RunReport (the dashboard feed)
      init.ts         # scaffold a starter project
      run.ts          # resolve config -> spawn the project's runner (playwright test); --dry-run prints the command
    report-model.ts   # RunReport / RunSummary types (shared with the dashboard, slice F)
  tests/              # offline Playwright-unit tests (no browser): dispatch, config, analyze (fixture jsonl), report (fixture dir), init (temp dir), run (--dry-run command-construction)
```

**Wiring:** publishable per slice-D conventions (version `0.1.0`, `main`/`types`/`exports`→`dist`, `files:["dist"]`, `publishConfig public`, `bin:{sentinel:"dist/cli.js"}`, deps `@sentinele2e/ai`/`@sentinele2e/core`/`@sentinele2e/contracts` at `^0.1.0`). Add to root `tsconfig` references + `tsconfig.base.json` paths. ESLint: ban driver/`@playwright/test` imports from `packages/cli/src/**` (it shells out, never imports the runner); tests dir exempt.

## 2. Commands

### `sentinel` / `sentinel --help` / `sentinel --version`

Prints usage (the four commands + flags) / the package version. Exit 0.

### `sentinel analyze <run.jsonl> [--json]`

Delegates to `@sentinele2e/ai`: `analyzeRun(path, { provider: null })` → `toText`/`toJson`. Exit `1` iff a `real-bug` verdict is present, else `0`. (Behaviour-identical to today's `sentinel-analyze`, now under the unified bin.)

### `sentinel report [dir] [--json]`

`dir` defaults to `config.telemetryDir` (`test-results/telemetry`). Reads every `*.jsonl`, runs `analyzeRun(file, {provider:null})` per run, builds a `RunReport`:

```ts
interface RunSummary {
  runId: string;
  file: string;
  outcome: RunOutcome;
  verdictCounts: Record<VerdictKind, number>;
  driftingLocators: string[];
  hasRealBug: boolean;
}
interface RunReport {
  schemaVersion: string;
  generatedFrom: string;
  runs: RunSummary[];
  totals: {
    runs: number;
    realBug: number;
    infraFlake: number;
    selectorDrift: number;
    healthy: number;
    businessOutcome: number;
    driftingLocators: string[];
  };
}
```

Text render: a table of runs + a totals footer; `--json` emits the `RunReport`. Exit `1` iff any run has a real bug. Empty/missing dir → a clear message + exit 0 (nothing to report). This `RunReport` JSON is the slice-F dashboard's input contract.

### `sentinel init [dir]`

Scaffolds a runnable starter project into `dir` (default `.`, refuses to overwrite a non-empty dir without `--force`): `package.json` (deps `@sentinele2e/driver-playwright` + `@sentinele2e/core`/`contracts`, devDep `@playwright/test`, scripts `test`/`analyze`), `sentinel.config.json`, a `playwright.config.ts`, a sample flow + spec under `tests/`, a `.gitignore` (ignoring `test-results/`). Prints next steps. Offline (writes files only).

### `sentinel run [pattern] [--config <path>] [--dry-run]`

Loads config, constructs the runner command (`npx playwright test -c <playwrightConfig> [pattern]`), and spawns it (inheriting stdio); the spawned flows emit JSONL telemetry as usual. `--dry-run` prints the resolved command and exits 0 (the offline-testable path). After a real run, prints a hint to `sentinel report`. (Wrapping the test runner — not reimplementing it — keeps the CLI thin and honest: the runner orchestrates, the driver automates, the flows emit telemetry.)

## 3. Testing (offline)

Playwright-unit tests under `packages/cli/tests/`, no browser:

- **dispatch:** unknown command → usage + exit 2; `--help`/`--version`; routing.
- **config:** defaults when no file; overrides from a fixture `sentinel.config.json`.
- **analyze:** against a committed fixture JSONL (reuse `@sentinele2e/ai`'s `invalid-run.jsonl` shape) → business-outcome + drift, exit 0; a real-bug fixture → exit 1.
- **report:** a fixture telemetry dir with 2–3 JSONL files → assert `RunReport` totals + drifting locators + `hasRealBug`; empty dir → exit 0 + message.
- **init:** into a temp dir → assert the scaffold files exist + are valid (package.json parses, config parses); refuses non-empty without `--force`.
- **run:** `--dry-run` → asserts the constructed `npx playwright test -c … <pattern>` command string (no spawn). (A real spawn needs a project + browser; covered by the dry-run + a documented manual check.)

## 4. Acceptance

1. `npm run typecheck` 0; `npm run lint` 0 (no driver import in `packages/cli/src`); `npm run test:unit` green incl. the new CLI tests (report counts).
2. `npm run build` emits `packages/cli/dist/cli.js` with the shebang; `sentinel` bin resolves.
3. `npm pack -w @sentinele2e/cli --dry-run` ships only `dist` + `package.json` + `README.md`.
4. Install-verify (best-effort, slice-D style): the packed `@sentinele2e/cli` tarball installs and `npx sentinel --version` / `sentinel analyze <fixture>` / `sentinel report <fixture-dir>` run from `dist`.
5. `sentinel init` into a temp dir produces a project whose `package.json`/config parse; `sentinel report` over a fixture dir yields the documented `RunReport`; `sentinel run --dry-run` prints the runner command.
6. The `RunReport` JSON shape is documented as the slice-F dashboard input contract.

## 5. Residual / deferred

- `sentinel run` real-spawn is exercised manually / in the example, not in offline CI (needs a project + browser).
- Watch mode, parallel sharding, JUnit/Allure export — deferred (reporting-sinks slice).
- The dashboard (slice F) consumes `RunReport`.

## 6. Ordered sub-steps

1. **E1 — package skeleton + wiring + dispatch/config/`--help`/`--version`** (offline tests). Gate: typecheck/lint/test:unit green; bin builds.
2. **E2 — `analyze` command** (delegate to `@sentinele2e/ai`) + tests (fixture jsonl, exit codes).
3. **E3 — `report` command + `report-model.ts`** (aggregate fixture telemetry dir → `RunReport`) + tests. Gate: totals/drift/real-bug assertions.
4. **E4 — `init` command** (scaffold) + tests (temp dir; refuses non-empty without `--force`).
5. **E5 — `run` command** (spawn wrapper + `--dry-run`) + packaging (manifest per slice D, README, pack-verify) + final acceptance (§4).

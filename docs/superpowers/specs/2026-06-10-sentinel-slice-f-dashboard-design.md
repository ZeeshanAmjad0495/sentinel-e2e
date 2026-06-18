# Sentinel Slice F — Operator Dashboard (`@sentinele2e/dashboard`): Design Spec

- **Status:** Approved (synthesis of a 10-agent design workflow: research -> 3 competing designs adversarially validated -> synthesis; static-html scored 9/10)
- **Date:** 2026-06-10
- **Branch:** `main` (no PRs; push each green phase)

> Implementation-ready; sub-steps F1-F8 (§11) are executed directly with reviews. Validation scores: static-html 9, served-app 7, hybrid 7.

---

# SLICE F — FINAL DESIGN

## 0. Decision and one-paragraph rationale

Ship a **static, self-contained HTML generator** as a new published package **`@sentinele2e/dashboard`** (the `static-html` angle, validator 9/10). It is the only option that satisfies all four hard constraints simultaneously — shippable now, offline-testable with no browser, zero new runtime dependencies, faithful to the JSON/telemetry-first ethos — and it is exactly the design the repo pre-committed to in `report-model.ts` ("the input contract the slice-F dashboard renders"). We **graft one idea** from the hybrid angle: an **optional `--serve` flag** built on Node built-ins only (`node:http` + `fs`), with **zero browser tests** (it is exercised via `http.get` on a loopback port). We **reject** the served SPA / Vite / lit half of the served-app angle entirely (it pulls a dev toolchain into the root install graph, collides with the `examples/**/tests/**` testMatch, and is two slices of work). Every validator blocker is resolved in §6 and §11.

---

## 1. Locked decisions

| Decision                                                    | Choice                                                                                                                                                                                                                                                                                                                                                                                   | Repo-grounded justification                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Package name / scope**                                    | New package `@sentinele2e/dashboard`, v0.1.0, cloned from the `ai`/`cli` template                                                                                                                                                                                                                                                                                                        | `package.json` shapes are identical across packages (scope `@sentinele2e`, `type: commonjs`, `main dist/index.js`, `files:["dist"]`, `engines.node>=20`, `publishConfig.access public`). report-model.ts literally pre-names this "slice-F". A peer concern to ai/cli, not a CLI sub-feature.                                                                                                                                          |
| **Where `RunReport`/`buildReport` live (sharing decision)** | **Move** `RunReport`/`RunSummary`/`REPORT_SCHEMA_VERSION` and `buildReport`/`summarize` into `@sentinele2e/ai` (`packages/ai/src/report.ts`), re-export from the ai barrel. Keep **thin re-exports** in `packages/cli/src/report-model.ts` and `packages/cli/src/commands/report.ts` so existing CLI imports/tests are byte-unchanged.                                                   | `buildReport` (report.ts:60) imports only `analyzeRun` + `RunAnalysis`/`VerdictKind`/`RunOutcome` from ai plus `node:fs/path` — **zero CLI coupling** (`CliResult`/`loadConfig` are used only by `reportCommand`). Single source of truth consumed by both `reportCommand` and the dashboard; avoids a `dashboard → cli` back-edge (cli is a bin, not a library) and avoids re-implementing a contract documented as "keep it stable". |
| **CLI command**                                             | `sentinel report --html <out>` (default) and `sentinel report --html <out> --serve [--port N]`. One new branch in `reportCommand`; **no** new dispatch case.                                                                                                                                                                                                                             | dispatch.ts routes `report → reportCommand`; adding `--html`/`--serve` parsing inside `reportCommand` (which already parses `--json`) is the smallest change. CLI gains a `@sentinele2e/dashboard` dependency.                                                                                                                                                                                                                         |
| **Rendered views**                                          | (1) Totals strip (run-level), (2) runs table (verdict-level chips, time-ordered), (3) drifting-locators section, (4) per-run drill-down: sequence-ordered timeline + verdicts/evidence + optional explanation.                                                                                                                                                                           | Maps cleanly onto existing data: totals from `RunReport.totals`, rows from `RunReport.runs`, timeline from `loadEvents(file)` sorted by `sequence`, verdicts/evidence joined by `Evidence.eventId`.                                                                                                                                                                                                                                    |
| **Redaction before embedding**                              | Embed `RunReport` rollup as-is (no raw strings). For per-run detail (timeline events, evidence detail, explanation) build the embedded model **from `redactEvents(events)` re-classified via `classify(redacted)`**, and additionally pass every free-text string through a **newly exported `redactText`** from ai. Then **HTML-escape on output** + **JSON-island `</script>` guard**. | analyze.ts:86–92 already does `redactEvents(events)` then `classify(redacted)`; we mirror it for the embedded run. `redactSecretShapes` is **private** today (verified) — exporting `redactText` (its public wrapper) is the minimal fix so evidence/explanation strings are scrubbable. Escaping is a **separate, equally mandatory** control (telemetry → stored XSS).                                                               |
| **Offline testing strategy**                                | Pure `generateDashboard(report, runDetails, opts): string` + temp-dir write test + security regression test + an optional lenient `--serve` loopback test, all under `playwright.unit.config.ts` with no browser.                                                                                                                                                                        | `playwright.unit.config.ts` testMatch `packages/**/tests/**`, `@playwright/test` used as a pure assertion runner (report.test.ts pattern). `packages/dashboard/tests/**` is auto-exempt from the eslint import boundary (last-match-wins `packages/**/tests/**` block).                                                                                                                                                                |
| **Packaging**                                               | Mirror ai/cli `package.json`; add the two `tsconfig.base.json` path-alias pairs, the root `tsconfig.json` reference, `packages/dashboard/tsconfig.json` (composite, references `../ai` + `../core`), append `dashboard` to the `pack:check` loop, add a `packages/dashboard/src/**/*.ts` eslint boundary block.                                                                          | Four wiring seams confirmed; npm workspaces auto-include `packages/*`.                                                                                                                                                                                                                                                                                                                                                                 |

---

## 2. Package layout

```
packages/dashboard/
  package.json                # clone of ai/cli template; deps: @sentinele2e/ai, @sentinele2e/core
  tsconfig.json               # extends ../../tsconfig.base.json; composite; refs ../ai, ../core
  src/
    index.ts                  # barrel: generateDashboard, buildDashboardModel, DashboardModel types, serveDashboard
    model.ts                  # DashboardModel + RunDetail types; buildDashboardModel(dir, opts)
    render.ts                 # generateDashboard(model, opts): string  (PURE — no fs, no net)
    html.ts                   # escapeHtml(), jsonIsland(), inline CSS string, inline client JS string
    serve.ts                  # serveDashboard(model, opts): node:http server (optional --serve)
  tests/
    render.test.ts            # content assertions on generateDashboard output
    redact.test.ts            # SECURITY regression: planted secrets scrubbed + XSS escaped
    model.test.ts            # buildDashboardModel over fixture telemetry dir
    write.test.ts             # temp-dir fs.writeFileSync round-trip (mirrors init.test.ts)
    serve.test.ts             # OPTIONAL: loopback http.get smoke (lenient)
    fixtures/telemetry/*.jsonl
```

`@sentinele2e/ai` after the move:

```
packages/ai/src/report.ts     # NEW home of RunReport/RunSummary/REPORT_SCHEMA_VERSION + buildReport + summarize
packages/ai/src/index.ts      # + export buildReport, RunReport, RunSummary, REPORT_SCHEMA_VERSION, redactText
packages/ai/src/redact.ts     # + export function redactText(value: string): string  (wraps private redactSecretShapes)
```

`@sentinele2e/cli` after the move (thin re-exports, behaviour-preserving):

```
packages/cli/src/report-model.ts          # re-export RunReport, RunSummary, REPORT_SCHEMA_VERSION from "@sentinele2e/ai"
packages/cli/src/commands/report.ts        # import buildReport + types from ai; keep renderText/reportCommand; re-export buildReport
```

---

## 3. Exact data flow

```
                 ┌──────────────────────────── @sentinele2e/ai ─────────────────────────────┐
  *.jsonl dir ──▶│ buildReport(dir)  ── analyzeRun(file,{provider:null}) ──▶ RunReport (rollup)│  (cross-run, no raw events, rules-only, no network)
                 └───────────────────────────────────────────────────────────────────────────┘
                                                   │
                                                   ▼
@sentinele2e/dashboard  buildDashboardModel(dir, opts):
  1. report     = buildReport(dir)                                  // totals + per-run summaries
  2. for each run file (only when embedding detail):
       events       = loadEvents(file)                              // raw, UNREDACTED, on-disk ns are STRINGS
       redacted     = redactEvents(events)                          // scrub by key + value-shape
       reClass      = classify(redacted)                            // verdicts/evidence rebuilt from SCRUBBED strings
       timeline     = redacted sorted by `sequence`                 // axis = startWallClockMs + durationMs ONLY
       verdicts     = reClass.verdicts (each evidence.detail also passed through redactText, belt+suspenders)
       explanation  = opts.explain ? analyzeRun(file).explanation (redactText'd) : undefined  // opt-in, may hit network
       startedAt    = min(events[].timing.startWallClockMs)         // DERIVED — not in the contract
       capped       = timeline.slice(0, opts.maxEvents) + truncated flag
  3. DashboardModel = { report, runs: RunDetail[] (time-ordered by startedAt), generatedAt, truncations }
                                                   │
                                                   ▼
  generateDashboard(model, opts): string   // PURE: data island (JSON.stringify, </script>-guarded) + inline CSS + inline JS, all interpolated values escapeHtml()'d
                                                   │
            ┌──────────────────────────────────────┴───────────────────────────────────┐
            ▼ default                                                                     ▼ --serve
  fs.writeFileSync(<out>, html)                                            serveDashboard: node:http serves the same string at "/" on 127.0.0.1:<port>
```

**Critical data rules (from verified research):**

- **Two layers never mixed in one chart.** `totals.<kind>` = run-level (runs with ≥1 verdict). `RunSummary.verdictCounts` = verdict-level and **includes `indeterminate`** (which `totals` omits). Totals strip uses `totals.*`; per-run chips use `verdictCounts`. Never a single kind-by-kind bar across both.
- **ns fields are strings on disk** (`load.ts` boundary cast keeps `startMonotonicNs`/`endMonotonicNs` as decimal strings despite the `bigint` type). Timeline axis uses **only** `startWallClockMs` (number) and `durationMs` (number). Never arithmetic on ns fields.
- **`startedAt` derived, contract unchanged.** `RunSummary` has no timestamp; we derive it in the model from `timing.startWallClockMs` rather than bumping `REPORT_SCHEMA_VERSION` (filename sort would mislead the trend).
- **`StrategyKind` is a bare `string`** (`contracts/locator.ts`). The legend renders unknown kinds gracefully (no fixed enum assumption).
- **rules-only is network-free.** `buildReport` and `buildDashboardModel` (without `--explain`) use `provider:null` / no provider. `--explain` is opt-in and documented to potentially hit the network/cost when `ANTHROPIC_API_KEY` is set.

---

## 4. Dashboard content / sections

1. **Header** — `generatedFrom`, `generatedAt`, run count, schema versions (`REPORT_SCHEMA_VERSION`, `ANALYSIS_SCHEMA_VERSION`), and a redaction/truncation banner when any run was capped or scrubbed.
2. **Totals strip (run-level tiles)** — real-bug / infra-flake / selector-drift / business-outcome / healthy from `totals.*`. Tile copy states "runs containing ≥1 …" to make the run-level semantic explicit. `indeterminate` intentionally absent here.
3. **Drifting-locators section** — deduped `totals.driftingLocators` as chips; per locator, count of runs it drifted in (derived from `RunSummary.driftingLocators`). Backed by `LocatorResolvedEvent.degraded`/`candidates` in the drill-down.
4. **Runs table** — one row per `RunSummary`, **ordered by derived `startedAt`** (true time order, not filename). Columns: runId, file, outcome, `hasRealBug` flag, verdict chips from `verdictCounts` (incl. `indeterminate`). Client-side filter by outcome/kind, expand to drill-down. No framework — vanilla JS toggling `hidden`.
5. **Per-run drill-down** (embedded under each row when `opts.detail`):
   - **Timeline** — `sequence`-ordered events on the `startWallClockMs`/`durationMs` axis. Per type: `locator.resolved` (logicalName, resolvedKind, resolvedRank, **degraded badge**, candidate trail with kind/outcome/rank, score, resolveDurationMs); `assertion` (state, matched, locatorRank, branchProgress); `retry` (attempt/maxAttempts/reason/previousOutcome); `system.failure` (errorKind, retryable, message); `business.failure` (domainReason); `artifact.captured` (artifactKind, ref, capturedOn); `flow.finished` (outcome, didDegrade, terminalReason). Unknown event types render generically. A "truncated — showing first N of M events" note when capped.
   - **Verdicts** — kind, confidence, source(rule/llm), one-line summary; evidence list (`detail` + decisive `fields`). Each verdict links to its timeline rows via `Evidence.eventId` (anchor highlight).
   - **Explanation** — rendered only when `--explain` and `usedLlm`.

---

## 5. Generated-HTML structure (data island + inline assets)

Single self-contained `dashboard.html`, openable by `file://` double-click, no server, no external requests:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sentinel report — {escapeHtml(generatedFrom)}</title>
    <style>
      /* inline CSS string from html.ts — system font stack, no CDN */
    </style>
  </head>
  <body>
    <main id="app">
      <!-- server-rendered totals strip + table + drill-downs, every value escapeHtml()'d -->
    </main>
    <script id="sentinel-data" type="application/json">
      {jsonIsland(model)}
    </script>
    <script>
      /* inline vanilla JS: filter/sort/expand/anchor-highlight only; reads #sentinel-data */
    </script>
  </body>
</html>
```

- **`jsonIsland(model)`** = `JSON.stringify(model)` with mandatory escaping of `<`, `>`, `&`, line/paragraph separators, and explicitly `</script` → `<\/script` (and `<!--`). This is the data-island XSS guard.
- **`escapeHtml(s)`** escapes `& < > " '` on **every** interpolated telemetry string in the server-rendered DOM (logicalName, domainReason, message, evidence detail, explanation, file, runId).
- The client JS performs **only** filter/sort/expand/anchor-highlight; no `innerHTML` from data, no network, no `eval`.
- **Size cap:** `RunReport` always inlined; per-run timelines capped at `opts.maxEvents` (default 500) with a visible truncation note. Pagination/virtualization explicitly deferred.

---

## 6. Security (mandatory controls + blocker resolution)

Two independent, both-required controls, mirroring analyze.ts but extended to the embed path:

1. **Redact before embed.**
   - The aggregate `RunReport` carries no raw event strings → embedding it is low-risk.
   - Per-run detail is built from **`redactEvents(events)`** and verdicts/evidence from **`classify(redacted)`** (not from `analyzeRun`'s raw-fidelity result). This resolves the hybrid/served **verdict-evidence leak blocker**: evidence detail (e.g. `rules.ts:61` interpolating raw `system.failure.message`) is rebuilt from scrubbed messages, so a planted secret in `message` is scrubbed in **both** the timeline row and the joined evidence.
   - **Blocker resolution (private `redactSecretShapes`):** add and export **`redactText(value: string): string`** from `@sentinele2e/ai` (a thin public wrapper over the existing private `redactSecretShapes`). Pass `explanation` and any verdict free-text through `redactText` as belt-and-suspenders. Listed explicitly in the F1 export set.
   - **Honest limitation (documented, not hidden):** `redactEvents` is value-shape-narrow by design (JWT/Bearer/`sk-`/`ghp_`/`xox*-`/AKIA + secret-named keys) to preserve UUIDs/selectors. A plaintext secret in `message` that matches **no** known shape and sits under a non-secret key **survives**. The security test plants both a shape-matching secret (asserted scrubbed) **and** a documented non-shaped value (asserted as a known limitation, not silently passing). README notes this.
2. **Escape on output.** All interpolated strings through `escapeHtml`; data island through the `</script>`-guarded `jsonIsland`. This is a distinct control: redaction is necessary-but-not-sufficient against stored XSS.

The dashboard depends on the **ai barrel only** → `ClaudeProvider`/`@anthropic-ai/sdk` stay lazy at runtime on the default rules-only path. **Honest footprint note (served-app blocker resolution):** `@anthropic-ai/sdk` is a _hard_ dep of `@sentinele2e/ai`, so it **is** in the dashboard's transitive **install** tree; it is simply never _imported_ on the static/rules-only path. We state this accurately and never claim the install is SDK-free.

---

## 7. CLI surface

`sentinel report [dir] [--json | --html <out>] [--serve] [--port <n>] [--explain] [--max-events <n>] [--no-detail]`

- `--json` unchanged (existing behaviour, byte-identical).
- `--html <out>` → `buildDashboardModel(dir, opts)` then `fs.writeFileSync(out, generateDashboard(model, opts))`; output message = absolute path; **exit 1 iff `totals.realBug > 0`** (same gate as text/json).
- `--serve` (requires/implies `--html` model build) → `serveDashboard(model, {port})` on `127.0.0.1`, prints the URL; long-running (does not exit; Ctrl-C to stop).
- `--explain` → opt-in LLM prose (may hit network/cost); off by default.
- `--max-events <n>` (default 500), `--no-detail` (rollup-only, smallest file).
- `--json` and `--html` are mutually exclusive (error + exit 2 if both).

`--html`/`--serve`/`--explain`/`--max-events` parsing lives inside `reportCommand`; **no new dispatch case**, no `USAGE` command added (USAGE flag list updated for the new `report` flags).

---

## 8. Offline tests

All under `packages/dashboard/tests/**`, run by `npm run test:unit` (`playwright.unit.config.ts`), `import { test, expect } from "@playwright/test"` as a pure assertion runner — no browser.

- **render.test.ts** — `generateDashboard(model)` contains: header/`generatedFrom`, totals tiles (run-level copy), each runId/outcome, verdict chips, drifting-locator chips, timeline event markers, the `<script id="sentinel-data" type="application/json">` island. Snapshot **a stable subset** (structural anchors/headings/counts), **not** the full CSS/copy blob, to avoid churn.
- **model.test.ts** — `buildDashboardModel(fixtureDir)` produces correct `totals` (mirrors `report.test.ts` expectations: 3 runs, 1 real-bug, 1 selector-drift, etc.), correct `startedAt` ordering, and a `truncated` flag when `maxEvents` is small.
- **redact.test.ts (SECURITY, blocking gate)** — fixture JSONL with a planted **JWT/Bearer/`sk-`** in `system.failure.message`: assert `html`.**not**.`toContain(plantedShapedSecret)` and `toContain('[redacted]')` in **both** the timeline and the joined evidence detail; assert a planted `<script>alert(1)</script>` in `logicalName` is **escaped** (`&lt;script&gt;`), not live; assert `</script>` in any string does not break the data island. Document the non-shaped-secret limitation with an explicit asserting test (it appears scrubbed only if shape-matched — known limitation).
- **write.test.ts** — temp-dir round-trip (mirrors `init.test.ts`): `reportCommand(["--html", tmpfile])` writes a file whose contents `.toContain('sentinel-data')`; exit code reflects real-bug gate.
- **serve.test.ts (OPTIONAL, lenient)** — `serveDashboard(model,{port:0})`, `http.get` the ephemeral loopback URL, assert 200 + body contains the data island; **no fs.watch/SSE timing assertion** (avoids CI flake); close the server in `finally`.
- **CLI regression** — existing `packages/cli/tests/report.test.ts` runs **unmodified** (thin re-exports keep `{ reportCommand, buildReport }` from `../src/commands/report` and `type RunReport` from `../src/report-model` resolvable).

---

## 9. Packaging / pack-verify (four seams + scripts)

1. `tsconfig.base.json` → add `"@sentinele2e/dashboard": ["packages/dashboard/src/index.ts"]` and `"@sentinele2e/dashboard/*": ["packages/dashboard/src/*"]`.
2. Root `tsconfig.json` → add `{ "path": "packages/dashboard" }` to `references`.
3. `packages/dashboard/tsconfig.json` → extends `../../tsconfig.base.json`, `composite:true`, `rootDir:src`, `outDir:dist`, `references: [{path:"../ai"},{path:"../core"}]`, `include:["src/**/*.ts"]`.
4. Root `package.json` `pack:check` loop → append `dashboard`: `for p in contracts core driver-playwright driver-selenium ai cli dashboard`.
5. `eslint.config.cjs` → add a `files:['packages/dashboard/src/**/*.ts']` block **identical** to the ai block (forbid `@playwright/test`, `playwright`, `selenium-webdriver`; pattern `['@sentinele2e/driver-*']` with message "dashboard is driver-agnostic; it renders telemetry, it never drives a browser"). Place it among the other src blocks, **before** the last-match-wins `packages/**/tests/**` exemption (which already covers `packages/dashboard/tests/**` — no test eslint change needed).
6. `packages/dashboard/package.json` clones the ai/cli template: scope/version 0.1.0, `type:commonjs`, `main dist/index.js`, `types dist/index.d.ts`, `exports['.']`, `files:["dist"]`, `engines.node>=20`, `repository.directory:"packages/dashboard"`, `publishConfig.access:"public"`, dependencies `{"@sentinele2e/ai":"^0.1.0","@sentinele2e/core":"^0.1.0"}`.
7. `packages/cli/package.json` → add `"@sentinele2e/dashboard":"^0.1.0"` dependency (cli now consumes the renderer for `--html`). Accepted coupling: a dashboard schema/template bug can break cli typecheck — noted.
8. **Event-type import path (served-app blocker resolution):** dashboard src obtains `TelemetryEvent`/`StrategyKind`/event types via the **declared dependencies only** — the `@sentinele2e/ai` barrel (re-exports) or `@sentinele2e/core` (declared). No `import from @sentinele2e/core` unless `core` is in `package.json` deps (it is). Never an undeclared dependency.
9. `scripts/verify-pack-install.sh` → add `dashboard` to its `PKGS` and, reusing its existing `sample-run.jsonl` writer, add a smoke step that `require()`s `dist` and calls `generateDashboard` on a hand-built minimal model (no shipped fixtures), asserting the output string contains `sentinel-data`.

---

## 10. Residual / deferred

- **Served SPA (React/Vite/lit), live tail/SSE, cross-run flake heatmaps, auth, multi-project history, hosted URLs, pagination/virtualization** — all deferred. Revisit only when a concrete interactivity need exceeds a static file; keep the static generator the default and `RunReport` the shared contract so any future served app is purely additive.
- **Non-shape-matching secrets in free-text `message`** — known, documented limitation of `redactEvents` (narrow by design to preserve UUIDs/selectors). Not fixed in F (would require generic high-entropy scrubbing that nukes UUIDs).
- **`startedAt` in the contract** — derived in the model now; promoting it to `RunSummary` (backward-compatible, bump `REPORT_SCHEMA_VERSION`) is deferred until a consumer needs it server-side.
- **`loadEvents` silently dropping malformed JSONL lines** — surfaced only as the existing `console.warn`; a structured "data loss" banner in the dashboard is deferred.

---

## 11. Ordered sub-steps F1..F8 (each with an acceptance gate)

**F1 — Relocate the contract + add `redactText`, thin re-exports in cli.**
Move `RunReport`/`RunSummary`/`REPORT_SCHEMA_VERSION` + `buildReport`/`summarize` into `packages/ai/src/report.ts`; export them and `redactText` from the ai barrel; add `export function redactText(value: string): string` to `redact.ts` wrapping the private `redactSecretShapes`. In cli: `report-model.ts` becomes `export type { RunReport, RunSummary } from "@sentinele2e/ai"; export { REPORT_SCHEMA_VERSION } from "@sentinele2e/ai";` and `commands/report.ts` imports `buildReport`+types from ai, **re-exports** `buildReport`, keeps `renderText`/`reportCommand`. **Commit to the re-export variant — do NOT delete-and-repoint.**
**Gate:** `tsc -b` clean; `npm run test:unit` green with `packages/cli/tests/report.test.ts` **unmodified**; `REPORT_SCHEMA_VERSION === "1.0.0"` unchanged; `sentinel report --json` output byte-identical to pre-F1.

**F2 — Scaffold `@sentinele2e/dashboard` + all four wiring seams + eslint block.**
Create package dir, `package.json`, `tsconfig.json`; add tsconfig.base paths pair, root tsconfig reference, pack:check entry, eslint src boundary block; empty barrel.
**Gate:** `tsc -b` builds the new package; `npm run lint --max-warnings=0` passes (boundary block active); `npm run pack:check` lists `@sentinele2e/dashboard`.

**F3 — `model.ts`: pure `DashboardModel` types + `buildDashboardModel(dir, opts)`.**
Build `report = buildReport(dir)`; for each run (when detail enabled) `redactEvents`→`classify(redacted)`→sequence-sorted timeline (axis = wallclock/duration only) + derived `startedAt`; cap at `maxEvents`; time-order runs. No fs in render path; no ns math.
**Gate:** `model.test.ts` asserts totals match the report fixture, time-ordering, and truncation flag; no `bigint`/ns arithmetic anywhere (grep check).

**F4 — `html.ts`: `escapeHtml`, `jsonIsland` (`</script>`-guarded), inline CSS/JS strings.**
**Gate:** unit test: `escapeHtml('<script>')` → `&lt;script&gt;`; `jsonIsland({s:"</script>"})` contains `<\/script` and round-trips via `JSON.parse` after un-escaping.

**F5 — `render.ts`: pure `generateDashboard(model, opts): string`.**
Server-render totals strip (run-level copy) + runs table (verdict-level chips incl. indeterminate) + drift section + drill-down timeline/verdicts/explanation; every value `escapeHtml`'d; data island via `jsonIsland`; client JS = filter/sort/expand/anchor only.
**Gate:** `render.test.ts` content assertions + stable-subset snapshot; output is valid single-file HTML containing exactly one `sentinel-data` island.

**F6 — Security regression test (blocking).**
Plant shape-matching secret in `system.failure.message` and an XSS payload in `logicalName`; assert scrubbed in timeline **and** joined evidence, payload escaped, island intact; assert the documented non-shaped-secret limitation explicitly.
**Gate:** `redact.test.ts` green; `expect(html).not.toContain(plantedShapedSecret)`, `toContain('[redacted]')`, payload appears only as `&lt;script&gt;`.

**F7 — CLI `--html`/`--explain`/`--max-events`/`--no-detail` + write test.**
Wire flags inside `reportCommand`; mutually-exclusive `--json`/`--html`; real-bug exit gate; update `USAGE` flag list; add cli dependency on `@sentinele2e/dashboard`.
**Gate:** `write.test.ts` temp-dir round-trip green; `sentinel report --html out.html` writes openable HTML; exit code = real-bug gate; `--json`/`--html` together → exit 2.

**F8 — Optional `--serve` (Node built-ins only) + lenient loopback test + docs.**
`serve.ts` `serveDashboard(model,{port})` on `127.0.0.1` serving the generated string at `/`; `--serve`/`--port` parsing; update README roadmap (mark slice F shipped, document redaction limitation + truncation). **F8 is droppable without touching F1–F7.**
**Gate:** `serve.test.ts` (lenient, no SSE/timing assertion) gets 200 + island over loopback and closes cleanly; `npm run test:all` and `scripts/verify-pack-install.sh` green; README updated.

---

**Files touched (absolute):** `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/report.ts` (new), `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/redact.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/index.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/cli/src/report-model.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/cli/src/commands/report.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/cli/package.json`, new `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/dashboard/**`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.base.json`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.json`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/package.json`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/eslint.config.cjs`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/scripts/verify-pack-install.sh`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/README.md`.

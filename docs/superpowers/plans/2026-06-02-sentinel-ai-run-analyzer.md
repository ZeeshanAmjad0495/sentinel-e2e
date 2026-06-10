# Sentinel Slice B — `@sentinel/ai` Run-Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@sentinel/ai` — a single-run analyzer that deterministically classifies failures (real-bug / infra-flake / selector-drift) from slice-A telemetry, and uses Claude (`claude-opus-4-8`) to explain runs and adjudicate ambiguous cases, optionally and gracefully.

**Architecture:** A new driver-agnostic workspace package. A pure deterministic rule classifier (offline, free, fully unit-tested) produces the verdicts; an `LlmProvider` abstraction (a `FakeLlmProvider` for tests; a real `ClaudeProvider` behind a lazy import, prompt-cached, tool-use) adds explanation + adjudication. `analyzeRun()` orchestrates load → classify → (optional) LLM → merge; a thin CLI renders. No `ANTHROPIC_API_KEY` → complete rules-only analysis.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, CommonJS, ES2022); Playwright Test as the offline unit runner; `@anthropic-ai/sdk@^0.100.1` (`claude-opus-4-8`, prompt caching, tool-use — used only in `llm/claude-provider.ts`); ESLint `no-restricted-imports` bans drivers + Playwright from `@sentinel/ai`.

**Source spec:** `docs/superpowers/specs/2026-06-02-sentinel-ai-run-analyzer-design.md` (single source of truth).

---

## Global conventions (apply to every task)

- **Unit-test runner:** Playwright Test, offline. `@sentinel/ai` tests live at `packages/ai/tests/**/*.test.ts`, import `{ test, expect } from "@playwright/test"`, never request the `page` fixture (no browser), and make zero API calls. Run via `npm run test:unit`.
- **Driver-agnostic boundary:** `packages/ai/src/**` must not import `@playwright/test`, `playwright`, or any `@sentinel/driver-*`. The `@anthropic-ai/sdk` is imported in exactly one file, `src/llm/claude-provider.ts`, reached only via a lazy `import()` so the SDK never loads on the default path.
- **LLM is optional/graceful:** rules work with no key; the real Claude provider runs only when `ANTHROPIC_API_KEY` is set, and its integration test is key-gated (`process.env.ANTHROPIC_API_KEY ? test : test.skip`).
- **TDD loop per task:** failing test → confirm the specific failure → minimal implementation → confirm pass → commit. Conventional Commits (scope `ai`, or `repo` for root tooling).
- **Sub-step order:** B1 → B2 → B3 → B4 → B5 → B6, each verifiable against its acceptance gate before the next.

---

> Sub-step B1 — package skeleton + wiring

Create the `@sentinel/ai` workspace and wire it into the build/lint graph with an `export {}` seed, so `tsc -b` and `lint` are green before any real analyzer code lands. This sub-step adds the package manifest + composite tsconfig, registers it in the root references / base paths, extends the ESLint driver-import boundary to cover `packages/ai/**`, and proves the Playwright unit runner still discovers the package via a trivial offline test.

---

### B1 — Task 1: Scaffold the `@sentinel/ai` package manifest + composite tsconfig + seed

**Files:**

- Create: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/package.json`
- Create: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/tsconfig.json`
- Create: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/index.ts`

- [ ] **Step 1: Create the package manifest.** Mirror the other packages exactly (`version 0.0.0`, `private`, `main`/`types` → `src/index.ts`, cross-package deps pinned at `"*"`). Add `@anthropic-ai/sdk` at the spec-locked `^0.100.1`.

```jsonc
// packages/ai/package.json
{
  "name": "@sentinel/ai",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@sentinel/contracts": "*",
    "@sentinel/core": "*",
    "@anthropic-ai/sdk": "^0.100.1",
  },
}
```

- [ ] **Step 2: Create the composite tsconfig.** Identical compilerOptions to `packages/core/tsconfig.json`; reference both dependency projects (contracts + core) so `tsc -b` orders the build correctly.

```jsonc
// packages/ai/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
  },
  "references": [{ "path": "../contracts" }, { "path": "../core" }],
  "include": ["src/**/*.ts"],
}
```

- [ ] **Step 3: Seed the barrel.** A standalone `export {}` keeps the file a module under `isolatedModules`/strict and lets `tsc` emit a valid (empty) declaration before real exports exist.

```ts
// packages/ai/src/index.ts
export {};
```

- [ ] **Step 4: Verify the package compiles in isolation** (root graph not yet wired — direct project build).

```
Run: npx tsc -b packages/ai/tsconfig.json
Expected: (no output; exit code 0 — emits packages/ai/dist/index.{js,d.ts})
```

- [ ] **Step 5: Commit.**

```
Run: git add packages/ai/package.json packages/ai/tsconfig.json packages/ai/src/index.ts && git commit -m "feat(ai): scaffold @sentinel/ai package skeleton"
Expected: commit created (commitlint passes; lint-staged formats the new files)
```

---

### B1 — Task 2: Wire `@sentinel/ai` into the workspace + root build graph

**Files:**

- Modify: `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.base.json`
- Modify: `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.json`
- Modify: `/Users/zeeshan.amjad/Documents/sentinel-e2e/package-lock.json` (regenerated by `npm install`)

- [ ] **Step 1: Add `@sentinel/ai` path aliases to `tsconfig.base.json`.** Insert the two mappings (bare + subpath) immediately after the `@sentinel/contracts/*` entry so the alphabetical grouping is preserved and the analyzer can `import type { TelemetryEvent } from "@sentinel/core"` while being importable as `@sentinel/ai`.

Replace:

```jsonc
      "@sentinel/contracts/*": ["packages/contracts/src/*"],
      "@sentinel/core": ["packages/core/src/index.ts"],
```

with:

```jsonc
      "@sentinel/contracts/*": ["packages/contracts/src/*"],
      "@sentinel/ai": ["packages/ai/src/index.ts"],
      "@sentinel/ai/*": ["packages/ai/src/*"],
      "@sentinel/core": ["packages/core/src/index.ts"],
```

- [ ] **Step 2: Register the project in the root `tsconfig.json` references.** Insert after the `core` reference (before `driver-playwright`) so `tsc -b` builds contracts → core → ai.

Replace:

```jsonc
    { "path": "packages/core" },
    { "path": "packages/driver-playwright" },
```

with:

```jsonc
    { "path": "packages/core" },
    { "path": "packages/ai" },
    { "path": "packages/driver-playwright" },
```

- [ ] **Step 3: Link the workspace** (`packages/*` is already a workspace glob, so this only needs an install to create the symlink and fetch `@anthropic-ai/sdk`).

```
Run: npm install
Expected: "added N packages" (includes @anthropic-ai/sdk@0.100.x); node_modules/@sentinel/ai symlinked to packages/ai; package-lock.json updated; exit 0
```

- [ ] **Step 4: Confirm the SDK resolved to the pinned major/minor.**

```
Run: node -e "console.log(require('@anthropic-ai/sdk/package.json').version)"
Expected: 0.100.1 (or a 0.100.x satisfying ^0.100.1)
```

- [ ] **Step 5: Confirm the full build graph is green.**

```
Run: npm run typecheck
Expected: > tsc -b   (no errors; exit code 0)
```

- [ ] **Step 6: Commit.**

```
Run: git add tsconfig.base.json tsconfig.json package.json package-lock.json && git commit -m "feat(ai): wire @sentinel/ai into workspace + tsconfig graph"
Expected: commit created; typecheck via pre-commit passes
```

---

### B1 — Task 3: Extend the ESLint driver-import boundary to `packages/ai/**`

**Files:**

- Modify: `/Users/zeeshan.amjad/Documents/sentinel-e2e/eslint.config.cjs`
- Test: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/__lint_probe__.ts` (temporary; deleted in Step 6)

- [ ] **Step 1: Write the failing lint probe FIRST.** Create a throwaway source file that imports a banned driver. Because no AI-specific ban exists yet, lint currently PASSES on it — that is the red state we must fix.

```ts
// packages/ai/src/__lint_probe__.ts
import "@sentinel/driver-playwright";
import "@playwright/test";
export {};
```

```
Run: npx eslint packages/ai/src/__lint_probe__.ts
Expected (RED — bug we are fixing):
  packages/ai/src/__lint_probe__.ts
    2:8  error  '@playwright/test' import is restricted ...
  (only @playwright/test flagged by the generic block; @sentinel/driver-playwright is NOT yet banned for @sentinel/ai)
```

Note: the generic `**/*.ts` block already bans `@playwright/test`/`playwright` everywhere, so line 2 errors today; the gap this task closes is the **`@sentinel/driver-*` ban for `packages/ai/src/**`\*\* (line 1 must also error).

- [ ] **Step 2: Add the AI-source driver-ban block.** Insert it AFTER the generic ban block (the one whose `files: ['**/*.ts']` bans `@playwright/test`/`playwright`) and BEFORE the test-runner exemption block, so the exemption's `packages/**/tests/**` still wins last for AI tests. This block re-states the Playwright bans (a later matching block fully overrides `no-restricted-imports`, so we must repeat them) and adds the `@sentinel/driver-*` pattern.

Insert immediately before the comment line `// Exemption (last match wins): the driver adapter + all test-runner dirs`:

```js
  {
    // DRIVER-AGNOSTIC boundary (slice B): @sentinel/ai analyzer source must
    // import NO driver — neither Playwright nor any @sentinel/driver-* package.
    // Tests under packages/ai/tests/** keep the test-runner exemption below.
    files: ['packages/ai/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
          ],
          patterns: [
            {
              group: ['@sentinel/driver-*'],
              message:
                '@sentinel/ai is driver-agnostic: it must import only the telemetry contract (@sentinel/core), never a driver.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 3: Confirm the probe now fails on BOTH imports (GREEN for the boundary).**

```
Run: npx eslint packages/ai/src/__lint_probe__.ts
Expected (both lines now error):
  1:8  error  '@sentinel/driver-playwright' import is restricted from being used by a pattern. @sentinel/ai is driver-agnostic ...
  2:8  error  '@playwright/test' import is restricted ...  Playwright is confined ...
  ✖ 2 problems (2 errors, 0 warnings)
```

- [ ] **Step 4: Confirm the test-runner exemption still wins for AI tests.** Create a temporary probe under `tests/` importing the runner; it must NOT error (last-match-wins exemption covers `packages/**/tests/**`).

```
Run: printf 'import { test } from "@playwright/test";\ntest("probe", () => {});\n' > packages/ai/tests/__lint_probe__.test.ts && npx eslint packages/ai/tests/__lint_probe__.test.ts ; echo "EXIT:$?"
Expected: EXIT:0 (no errors — tests keep the @playwright/test exemption)
```

- [ ] **Step 5: Confirm a driver import is also allowed to be banned but tests stay exempt — remove both probes.**

```
Run: rm packages/ai/src/__lint_probe__.ts packages/ai/tests/__lint_probe__.test.ts
Expected: (no output; both temporary probes removed)
```

- [ ] **Step 6: Confirm whole-repo lint is green** (the seed `export {}` has no banned imports; baseline preserved).

```
Run: npm run lint
Expected: > eslint . --max-warnings=0   (no errors; exit code 0)
```

- [ ] **Step 7: Commit** (only the config change; probes are already deleted).

```
Run: git add eslint.config.cjs && git commit -m "feat(ai): ban driver imports from @sentinel/ai source (driver-agnostic boundary)"
Expected: commit created; lint via pre-commit passes
```

---

### B1 — Task 4: Confirm lint-include coverage + add the offline skeleton unit test

**Files:**

- Modify: `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.eslint.json` (only if the confirm step shows `packages/ai/**` is NOT covered — expected NO edit)
- Test: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/tests/skeleton.test.ts`

- [ ] **Step 1: Confirm `tsconfig.eslint.json` already covers `packages/ai/**`.** Its `include`globs`packages/_/src/\*\*/_.ts`+`packages/_/tests/\*\*/_.ts`, which match `packages/ai`. Verify ESLint type-aware parsing sees an AI source file (no "file not included in any project" error).

```
Run: npx eslint packages/ai/src/index.ts ; echo "EXIT:$?"
Expected: EXIT:0 (no "parserOptions.project" / "not found in project" error → packages/ai is already in the lint project; NO edit to tsconfig.eslint.json needed)
```

Only if the above prints a `Parsing error: ... was not found by the project service` style error, add `"packages/ai/src/**/*.ts"` and `"packages/ai/tests/**/*.ts"` to `tsconfig.eslint.json` `include` and re-run until EXIT:0.

- [ ] **Step 2: Write the offline skeleton unit test.** Mirror `packages/core/tests/skeleton.test.ts` exactly. It uses the Playwright runner ONLY as the test harness, requests NO `page` fixture (no browser), and makes zero network/API calls — it asserts a pure value so `npm run test:unit` discovers and runs the package.

```ts
// packages/ai/tests/skeleton.test.ts
import { test, expect } from "@playwright/test";

test("@sentinel/ai skeleton package is wired", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 3: Confirm the unit runner discovers and passes the new test** (offline; no browser launch).

```
Run: npm run test:unit -- packages/ai/tests/skeleton.test.ts
Expected: Running 1 test using 1 worker
  ✓  1 [chromium] › packages/ai/tests/skeleton.test.ts:3:1 › @sentinel/ai skeleton package is wired
  1 passed
```

- [ ] **Step 4: Confirm the full unit suite is still green** (no regressions across the monorepo).

```
Run: npm run test:unit
Expected: ... N passed (0 failed) — includes the @sentinel/ai skeleton test; exit code 0
```

- [ ] **Step 5: Commit.**

```
Run: git add packages/ai/tests/skeleton.test.ts && git commit -m "test(ai): add offline skeleton unit test for @sentinel/ai"
Expected: commit created; pre-commit hooks pass
```

---

### B1 — Task 5: Whole-graph acceptance gate for B1

**Files:** none (verification + a single squash-free confirmation; no source changes).

- [ ] **Step 1: Clean rebuild of the project graph from scratch** (proves the references graph is self-consistent, no stale `tsbuildinfo`).

```
Run: npm run typecheck -- --force
Expected: > tsc -b --force   (rebuilds contracts, core, ai, driver-playwright, example; no errors; exit 0)
```

- [ ] **Step 2: Lint the whole repo** (B1 acceptance: lint 0).

```
Run: npm run lint
Expected: > eslint . --max-warnings=0   (no errors; exit 0)
```

- [ ] **Step 3: Run the full offline unit suite** (B1 acceptance: runner still discovers `@sentinel/ai`).

```
Run: npm run test:unit
Expected: all tests passed (0 failed), including packages/ai/tests/skeleton.test.ts; exit 0
```

- [ ] **Step 4: Prove the SDK is present but unused so far** (no `claude-provider.ts` yet — the B6 import-audit will assert it lands in exactly one file later; here we just confirm no AI source imports it yet).

```
Run: grep -rn "@anthropic-ai/sdk" packages/ai/src ; echo "EXIT:$?"
Expected: EXIT:1 (no matches — the SDK is a declared dependency but not yet imported anywhere; introduced only in B5's claude-provider.ts)
```

- [ ] **Step 5: Confirm a clean working tree** (all B1 changes already committed across Tasks 1–4; nothing left dangling).

```
Run: git status --porcelain
Expected: (empty output — clean tree)
```

B1 is complete: `@sentinel/ai` exists as a composite workspace package in the root build + lint graph, the driver-agnostic ESLint boundary is enforced for its source (tests exempt), and the offline Playwright unit runner discovers it — all on an `export {}` seed with `typecheck`/`lint`/`test:unit` green.

---

Notes for the assembler / downstream sub-steps, grounded against the repo:

- `tsconfig.eslint.json` `include` already globs `packages/*/src/**/*.ts` + `packages/*/tests/**/*.ts`, which match `packages/ai/**` — so spec §2's "add to tsconfig.eslint.json include" is a **confirm-only** step (B1 Task 4 Step 1), not an edit, unless ESLint reports the file as outside the project.
- `@anthropic-ai/sdk` is **not yet installed** in `node_modules`; the `npm install` in B1 Task 2 fetches it (declared at `^0.100.1`).
- The repo's ESLint exemption block uses last-match-wins over `packages/**/tests/**`, so the new AI-source ban block must be placed **before** that exemption (B1 Task 3 Step 2) to keep `packages/ai/tests/**` able to import `@playwright/test`.
- On success, both `tsc -b` and `eslint . --max-warnings=0` emit only the npm banner (no diagnostics, exit 0) — reflected in the `Expected:` lines.
- The core barrel (`packages/core/src/index.ts` → `./telemetry`) already exports `TelemetryEvent`, which B2+ will consume via the new `@sentinel/ai` path alias.

---

> Sub-step B2 — types + load + redact

This fragment lands the `@sentinel/ai` type modules (`verdict.ts`, `analysis.ts`) and the offline input utilities (`load.ts`, `redact.ts`) with TDD unit tests under the Playwright unit runner. Every step is copy-pasteable, offline (no browser, no network/API), and ends in a conventional commit scoped `ai`.

---

### B2 — Task 1: `verdict.ts` — Verdict / VerdictKind / Evidence types

**Files:**

- Create: `packages/ai/src/verdict.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/tests/verdict.test.ts`

- [ ] **Step 1: Write the failing type-level test.** This compiles the exact shapes from spec §3.1 and asserts the literal-union membership at runtime so the test also executes.

```ts
// packages/ai/tests/verdict.test.ts
import { test, expect } from "@playwright/test";
import type { VerdictKind, Evidence, Verdict } from "@sentinel/ai";

test("Verdict types compose into a well-formed rule verdict", () => {
  const evidence: Evidence = {
    eventId: "e-1",
    type: "locator.resolved",
    detail: "primary 'label' missed; resolved via 'css' rank 6",
    fields: { resolvedRank: 6, degraded: true },
  };
  const kind: VerdictKind = "selector-drift";
  const verdict: Verdict = {
    kind,
    confidence: 0.9,
    summary: "auth.login.username degraded to rank 6",
    evidence: [evidence],
    logicalName: "auth.login.username",
    source: "rule",
  };

  expect(verdict.kind).toBe("selector-drift");
  expect(verdict.evidence[0]?.eventId).toBe("e-1");
  expect(verdict.source).toBe("rule");
  expect(verdict.confidence).toBeGreaterThan(0);
});

test("VerdictKind admits every documented kind", () => {
  const kinds: readonly VerdictKind[] = [
    "real-bug",
    "infra-flake",
    "selector-drift",
    "healthy",
    "business-outcome",
    "indeterminate",
  ];
  expect(new Set(kinds).size).toBe(6);
});
```

Run:

```
npm run test:unit -- packages/ai/tests/verdict.test.ts
```

Expected: FAIL — `error TS2307: Cannot find module '@sentinel/ai' or its corresponding type declarations.` (the `verdict.ts` source and barrel re-export do not exist yet).

- [ ] **Step 2: Create `verdict.ts` with the exact spec §3.1 types.**

```ts
// packages/ai/src/verdict.ts
export type VerdictKind =
  | "real-bug" // app behaved wrong with a stable locator
  | "infra-flake" // transient: retry-then-pass, retryable timeout/session loss
  | "selector-drift" // a locator degraded to a fallback, or selector not-found/ambiguous
  | "healthy" // success, no degradation
  | "business-outcome" // an expected domain result (e.g. INVALID_CREDENTIALS) — NOT a defect
  | "indeterminate"; // no clear rule -> hand to the LLM to adjudicate

export interface Evidence {
  readonly eventId: string; // the telemetry event this draws from
  readonly type: string; // event type (e.g. "locator.resolved")
  readonly detail: string; // human-readable why ("primary 'label' missed; resolved via 'css' rank 6")
  readonly fields?: Readonly<Record<string, string | number | boolean>>; // the decisive fields
}

export interface Verdict {
  readonly kind: VerdictKind;
  readonly confidence: number; // 0..1 — rules emit high; indeterminate ~0
  readonly summary: string; // one-line
  readonly evidence: readonly Evidence[];
  readonly logicalName?: string; // element a drift/bug is tied to
  readonly source: "rule" | "llm"; // who produced this verdict
}
```

- [ ] **Step 3: Re-export from the barrel.** B1 created `src/index.ts` as an `export {}` skeleton; replace that line with the verdict re-export.

```ts
// packages/ai/src/index.ts
export type { VerdictKind, Evidence, Verdict } from "./verdict";
```

Run:

```
npm run typecheck && npm run test:unit -- packages/ai/tests/verdict.test.ts
```

Expected: `tsc -b` exits 0; Playwright prints `2 passed`. No browser launches (no `page` fixture requested).

- [ ] **Step 4: Lint then commit.**

```
npm run lint
git add packages/ai/src/verdict.ts packages/ai/src/index.ts packages/ai/tests/verdict.test.ts
git commit -m "feat(ai): add verdict types (VerdictKind, Evidence, Verdict)"
```

Expected: `eslint . --max-warnings=0` exits 0; commit succeeds (Husky pre-commit lint-staged + commit-msg commitlint pass; lowercase conventional subject).

---

### B2 — Task 2: `analysis.ts` — RunOutcome / RunClassification / RunAnalysis + ANALYSIS_SCHEMA_VERSION

**Files:**

- Create: `packages/ai/src/analysis.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/tests/analysis.test.ts`

- [ ] **Step 1: Write the failing test.** Asserts the schema-version constant value and exercises the `RunClassification`/`RunAnalysis` shapes (spec §3.2), importing `Verdict` from the same package.

```ts
// packages/ai/tests/analysis.test.ts
import { test, expect } from "@playwright/test";
import { ANALYSIS_SCHEMA_VERSION } from "@sentinel/ai";
import type {
  RunOutcome,
  RunClassification,
  RunAnalysis,
  Verdict,
} from "@sentinel/ai";

test("ANALYSIS_SCHEMA_VERSION is 1.0.0", () => {
  expect(ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
});

test("RunClassification and RunAnalysis compose with the analyzer outcomes", () => {
  const businessVerdict: Verdict = {
    kind: "business-outcome",
    confidence: 1,
    summary: "domain rejected: INVALID_CREDENTIALS",
    evidence: [],
    source: "rule",
  };
  const outcome: RunOutcome = "business-failure";

  const classification: RunClassification = {
    runId: "run-1",
    flowName: "auth.login",
    outcome,
    degraded: true,
    verdicts: [businessVerdict],
    indeterminate: [],
  };

  const analysis: RunAnalysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
    llmError: "no ANTHROPIC_API_KEY; rules-only",
  };

  expect(classification.degraded).toBe(true);
  expect(analysis.outcome).toBe("business-failure");
  expect(analysis.verdicts[0]?.kind).toBe("business-outcome");
  expect(analysis.usedLlm).toBe(false);
});
```

Run:

```
npm run test:unit -- packages/ai/tests/analysis.test.ts
```

Expected: FAIL — `error TS2305: Module '"@sentinel/ai"' has no exported member 'ANALYSIS_SCHEMA_VERSION'.` (and the `RunOutcome`/`RunClassification`/`RunAnalysis` types are missing).

- [ ] **Step 2: Create `analysis.ts` with the exact spec §3.2 contents.** Imports `TelemetryEvent` from `@sentinel/core` (referenced by `RunClassification` consumers downstream) and `Verdict` from `./verdict`.

```ts
// packages/ai/src/analysis.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { Verdict } from "./verdict";

export type RunOutcome =
  | "success"
  | "business-failure"
  | "system-failure"
  | "unknown";

export interface RunClassification {
  readonly runId: string; // == traceId
  readonly flowName?: string;
  readonly outcome: RunOutcome;
  readonly degraded: boolean; // any silent selector drift (even on a passing run)
  readonly verdicts: readonly Verdict[]; // rule verdicts (defects, drift, business outcome, healthy)
  readonly indeterminate: readonly Verdict[]; // the subset to send to the LLM for adjudication
}

export const ANALYSIS_SCHEMA_VERSION = "1.0.0";

export interface RunAnalysis {
  readonly schemaVersion: string; // ANALYSIS_SCHEMA_VERSION
  readonly runId: string;
  readonly outcome: RunOutcome;
  readonly verdicts: readonly Verdict[]; // rule verdicts merged with any LLM adjudications
  readonly explanation?: string; // Claude's plain-language run explanation (when LLM used)
  readonly usedLlm: boolean;
  readonly llmError?: string; // set when the LLM was attempted but skipped/failed (graceful)
}

// `TelemetryEvent` is the consumed input type across the @sentinel/ai pipeline;
// re-export it here so downstream modules import it from a single analyzer surface.
export type { TelemetryEvent };
```

- [ ] **Step 3: Extend the barrel.**

```ts
// packages/ai/src/index.ts
export type { VerdictKind, Evidence, Verdict } from "./verdict";
export { ANALYSIS_SCHEMA_VERSION } from "./analysis";
export type {
  RunOutcome,
  RunClassification,
  RunAnalysis,
  TelemetryEvent,
} from "./analysis";
```

Run:

```
npm run typecheck && npm run test:unit -- packages/ai/tests/analysis.test.ts
```

Expected: `tsc -b` exits 0; Playwright prints `2 passed`.

- [ ] **Step 4: Lint then commit.**

```
npm run lint
git add packages/ai/src/analysis.ts packages/ai/src/index.ts packages/ai/tests/analysis.test.ts
git commit -m "feat(ai): add analysis types and ANALYSIS_SCHEMA_VERSION"
```

Expected: lint exits 0; commit succeeds.

---

### B2 — Task 3: `load.ts` — JSONL/in-memory → ordered `TelemetryEvent[]`

**Files:**

- Create: `packages/ai/src/load.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/tests/load.test.ts`

Loader contract (spec §6 load, §9, §13 Q3): accept `string | readonly TelemetryEvent[]`; if a string, read the file and parse each non-empty line as JSON; skip malformed lines with `console.warn`; throw if zero valid events; keep `timing.startMonotonicNs`/`endMonotonicNs` in their JSONL **string** form (no bigint revive — the analyzer needs no ns math); warn once on an unknown `schemaVersion` major.

- [ ] **Step 1: Write the failing test.** Writes a valid 2-line JSONL to an `os.tmpdir()` file (with `startMonotonicNs` as the JSONL string form), proves the malformed line is skipped, and proves the empty/all-malformed case throws. `console.warn` is stubbed so the skip path is asserted without polluting output.

```ts
// packages/ai/tests/load.test.ts
import { test, expect } from "@playwright/test";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadEvents } from "@sentinel/ai";

const line = (name: string, seq: number): string =>
  JSON.stringify({
    schemaVersion: "1.0.0",
    eventId: randomUUID(),
    type: "component.action",
    traceId: "run-1",
    spanId: "s",
    sequence: seq,
    name,
    // bigint timing arrives as JSONL decimal strings; loadEvents keeps them as strings.
    timing: {
      startWallClockMs: 1,
      startMonotonicNs: "5000000",
      endMonotonicNs: "6000000",
      durationMs: 1,
    },
  });

const withTmpFile = (contents: string, fn: (path: string) => void): void => {
  const filePath = join(tmpdir(), `sentinel-ai-load-${randomUUID()}.jsonl`);
  try {
    writeFileSync(filePath, contents, "utf8");
    fn(filePath);
  } finally {
    if (existsSync(filePath)) rmSync(filePath);
  }
};

test("loadEvents parses a valid 2-line JSONL string into ordered events", () => {
  withTmpFile(`${line("first", 0)}\n${line("second", 1)}\n`, (path) => {
    const events = loadEvents(path);
    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe("first");
    expect(events[1]?.name).toBe("second");
    // timing ns fields are KEPT as their JSONL string form (no bigint revive).
    expect(events[0]?.timing.startMonotonicNs).toBe("5000000");
    expect(typeof events[0]?.timing.startMonotonicNs).toBe("string");
  });
});

test("loadEvents skips a malformed line with a console.warn", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    withTmpFile(
      `${line("first", 0)}\nthis-is-not-json\n${line("third", 2)}\n`,
      (path) => {
        const events = loadEvents(path);
        expect(events).toHaveLength(2);
        expect(events.map((e) => e.name)).toEqual(["first", "third"]);
      },
    );
    expect(warnings.some((w) => /malformed|skip/i.test(w))).toBe(true);
  } finally {
    console.warn = original;
  }
});

test("loadEvents throws when no valid events are present", () => {
  withTmpFile("\n   \nnot-json\n", (path) => {
    expect(() => loadEvents(path)).toThrow(/no valid telemetry events/i);
  });
});

test("loadEvents accepts an in-memory event array unchanged", () => {
  withTmpFile(`${line("first", 0)}\n`, (path) => {
    const [evt] = loadEvents(path);
    const events = loadEvents([evt!]);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("first");
  });
});
```

Run:

```
npm run test:unit -- packages/ai/tests/load.test.ts
```

Expected: FAIL — `error TS2305: Module '"@sentinel/ai"' has no exported member 'loadEvents'.`

- [ ] **Step 2: Create `load.ts`.** Note: JSONL revives `startMonotonicNs`/`endMonotonicNs` as strings (not `bigint`), so the parsed records are not structurally assignable to `TelemetryEvent` whose `timing` is `bigint`. We parse into a loose shape and return `TelemetryEvent[]` via a single, documented cast at the boundary — the analyzer performs no ns math (spec §13 Q3).

```ts
// packages/ai/src/load.ts
import { readFileSync } from "node:fs";
import type { TelemetryEvent } from "@sentinel/core";

/** Loosely-typed parse of a JSONL line: timing ns fields stay as strings. */
interface RawEvent {
  readonly schemaVersion?: unknown;
  readonly name?: unknown;
  readonly timing?: unknown;
}

const SCHEMA_MAJOR = "1";

const majorOf = (version: string): string => version.split(".")[0] ?? "";

/**
 * Load an ordered run as `TelemetryEvent[]`.
 *
 * - `string` input is treated as a JSONL file path: each non-empty line is parsed
 *   as JSON; malformed lines are skipped with a `console.warn`; zero valid events throws.
 * - An in-memory `TelemetryEvent[]` is returned as a defensive shallow copy.
 *
 * Per spec §13 Q3 the `timing.startMonotonicNs`/`endMonotonicNs` fields are KEPT in
 * their JSONL decimal-string form (no bigint revive) — the analyzer needs no ns math.
 * The parsed records are returned as `TelemetryEvent[]` via a single boundary cast.
 */
export function loadEvents(
  input: string | readonly TelemetryEvent[],
): TelemetryEvent[] {
  if (typeof input !== "string") {
    return [...input];
  }

  const raw = readFileSync(input, "utf8");
  const events: RawEvent[] = [];
  let warnedUnknownMajor = false;

  for (const rawLine of raw.split("\n")) {
    const lineText = rawLine.trim();
    if (lineText === "") continue;

    let parsed: RawEvent;
    try {
      parsed = JSON.parse(lineText) as RawEvent;
    } catch {
      console.warn(`loadEvents: skipping malformed JSONL line: ${lineText}`);
      continue;
    }

    if (
      !warnedUnknownMajor &&
      typeof parsed.schemaVersion === "string" &&
      majorOf(parsed.schemaVersion) !== SCHEMA_MAJOR
    ) {
      warnedUnknownMajor = true;
      console.warn(
        `loadEvents: unknown telemetry schemaVersion major "${parsed.schemaVersion}"; continuing best-effort`,
      );
    }

    events.push(parsed);
  }

  if (events.length === 0) {
    throw new Error(
      `loadEvents: no valid telemetry events found in "${input}"`,
    );
  }

  // Boundary cast: ns timing fields remain strings; the analyzer performs no ns math.
  return events as unknown as TelemetryEvent[];
}
```

- [ ] **Step 3: Extend the barrel.**

```ts
// packages/ai/src/index.ts
export type { VerdictKind, Evidence, Verdict } from "./verdict";
export { ANALYSIS_SCHEMA_VERSION } from "./analysis";
export type {
  RunOutcome,
  RunClassification,
  RunAnalysis,
  TelemetryEvent,
} from "./analysis";
export { loadEvents } from "./load";
```

Run:

```
npm run typecheck && npm run test:unit -- packages/ai/tests/load.test.ts
```

Expected: `tsc -b` exits 0; Playwright prints `4 passed`.

- [ ] **Step 4: Lint then commit.**

```
npm run lint
git add packages/ai/src/load.ts packages/ai/src/index.ts packages/ai/tests/load.test.ts
git commit -m "feat(ai): add loadEvents jsonl/in-memory loader"
```

Expected: lint exits 0; commit succeeds.

---

### B2 — Task 4: `redact.ts` — defense-in-depth secret stripping

**Files:**

- Create: `packages/ai/src/redact.ts`
- Modify: `packages/ai/src/index.ts`
- Test: `packages/ai/tests/redact.test.ts`

Redaction contract (spec §7): `redactEvents(events): TelemetryEvent[]` — deep-clone, then replace any value whose KEY matches `/pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i` with `"[redacted]"`. Non-secret fields untouched; input is not mutated.

- [ ] **Step 1: Write the failing test.** Plants `attributes: { password: "hunter2" }` on a synthetic event, asserts it becomes `"[redacted]"`, asserts a sibling non-secret field is untouched, and asserts the original input object is not mutated (deep clone).

```ts
// packages/ai/tests/redact.test.ts
import { test, expect } from "@playwright/test";
import { redactEvents } from "@sentinel/ai";
import type { TelemetryEvent } from "@sentinel/ai";

const baseEvent = (
  attributes: Readonly<Record<string, string | number | boolean>>,
): TelemetryEvent =>
  ({
    schemaVersion: "1.0.0",
    eventId: "e-1",
    type: "component.action",
    traceId: "run-1",
    spanId: "s",
    sequence: 0,
    name: "loginForm.submit",
    timing: { startWallClockMs: 1, startMonotonicNs: "1" },
    attributes,
  }) as unknown as TelemetryEvent;

test("redactEvents replaces a secret-keyed value with [redacted]", () => {
  const events = [baseEvent({ password: "hunter2", username: "alice" })];
  const redacted = redactEvents(events);

  const attrs = redacted[0]?.attributes as Record<string, unknown>;
  expect(attrs.password).toBe("[redacted]");
  // non-secret field untouched
  expect(attrs.username).toBe("alice");
});

test("redactEvents matches the full secret key set, case-insensitively", () => {
  const events = [
    baseEvent({
      Authorization: "Bearer abc",
      apiKey: "k",
      "api-key": "k2",
      sessionToken: "t",
      Cookie: "c",
      credential: "x",
      secretValue: "s",
      okField: 42,
    }),
  ];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;

  expect(attrs.Authorization).toBe("[redacted]");
  expect(attrs.apiKey).toBe("[redacted]");
  expect(attrs["api-key"]).toBe("[redacted]");
  expect(attrs.sessionToken).toBe("[redacted]");
  expect(attrs.Cookie).toBe("[redacted]");
  expect(attrs.credential).toBe("[redacted]");
  expect(attrs.secretValue).toBe("[redacted]");
  // ordinary field preserved with its original type
  expect(attrs.okField).toBe(42);
});

test("redactEvents deep-clones — the input is not mutated", () => {
  const events = [baseEvent({ password: "hunter2" })];
  const redacted = redactEvents(events);

  const originalAttrs = events[0]?.attributes as Record<string, unknown>;
  const redactedAttrs = redacted[0]?.attributes as Record<string, unknown>;
  expect(originalAttrs.password).toBe("hunter2"); // source untouched
  expect(redactedAttrs.password).toBe("[redacted]");
  expect(redacted[0]).not.toBe(events[0]); // new object
});
```

Run:

```
npm run test:unit -- packages/ai/tests/redact.test.ts
```

Expected: FAIL — `error TS2305: Module '"@sentinel/ai"' has no exported member 'redactEvents'.`

- [ ] **Step 2: Create `redact.ts`.** Recursively deep-clones and rewrites any key matching the secret pattern; preserves arrays and nested objects.

```ts
// packages/ai/src/redact.ts
import type { TelemetryEvent } from "@sentinel/core";

const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
const REDACTED = "[redacted]";

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Defense-in-depth secret stripping before any event is sent to the LLM (spec §7).
 *
 * Deep-clones each event and replaces any value whose KEY matches the secret
 * pattern with `"[redacted]"`. The telemetry is already credential-free (verified
 * in slice A); this is belt-and-suspenders. The input array is never mutated.
 */
export function redactEvents(
  events: readonly TelemetryEvent[],
): TelemetryEvent[] {
  return events.map((event) => redactValue(event) as TelemetryEvent);
}
```

- [ ] **Step 3: Extend the barrel.**

```ts
// packages/ai/src/index.ts
export type { VerdictKind, Evidence, Verdict } from "./verdict";
export { ANALYSIS_SCHEMA_VERSION } from "./analysis";
export type {
  RunOutcome,
  RunClassification,
  RunAnalysis,
  TelemetryEvent,
} from "./analysis";
export { loadEvents } from "./load";
export { redactEvents } from "./redact";
```

Run:

```
npm run typecheck && npm run test:unit -- packages/ai/tests/redact.test.ts
```

Expected: `tsc -b` exits 0; Playwright prints `3 passed`.

- [ ] **Step 4: Full sub-step gate, then commit.** Run the whole unit suite and lint to confirm B2 leaves the graph green and the driver/SDK boundary intact (no `@playwright/test` import outside `tests/`, no driver imports anywhere in `packages/ai/src/**`).

```
npm run typecheck && npm run lint && npm run test:unit
```

Expected: `tsc -b` exits 0; `eslint . --max-warnings=0` exits 0; Playwright reports all `@sentinel/ai` tests passing (`verdict` 2, `analysis` 2, `load` 4, `redact` 3) alongside the existing suites — all offline, zero API.

```
git add packages/ai/src/redact.ts packages/ai/src/index.ts packages/ai/tests/redact.test.ts
git commit -m "feat(ai): add redactEvents defense-in-depth secret stripping"
```

Expected: lint exits 0; commit succeeds.

---

Grounding notes that shaped the tasks (verified against the repo, not just the spec):

- `TelemetryEvent` is exported (type-only) from `@sentinel/core` via `packages/core/src/telemetry/index.ts` → spec §3.2 import `import type { TelemetryEvent } from "@sentinel/core"` resolves. `analysis.ts` re-exports it so `redact.test.ts`/downstream import from `@sentinel/ai`.
- `noUncheckedIndexedAccess` is on, so all test index access uses `?.` / non-null `!` exactly as existing core tests do (`packages/core/tests/jsonl-sink.test.ts`).
- `JsonlSink` serializes `timing.startMonotonicNs`/`endMonotonicNs` as decimal **strings** (`packages/core/tests/jsonl-sink.test.ts` asserts `"5000000"`). Since the `Timing` type declares those `bigint`, the parsed JSONL is not structurally a `TelemetryEvent`; `load.ts` returns via one documented boundary cast (`as unknown as TelemetryEvent[]`) and keeps them as strings per spec §13 Q3 (no bigint revive). The load test asserts `typeof === "string"`.
- Tests import `{ test, expect } from "@playwright/test"`, never request the `page` fixture (pure/offline), and use `tmpdir()` + `randomUUID()` per the existing `jsonl-sink.test.ts` pattern; `playwright.unit.config.ts` `testMatch` already includes `packages/**/tests/**/*.test.ts`.
- This fragment assumes B1 created `packages/ai/{package.json,tsconfig.json}`, the barrel `src/index.ts` (as `export {}`), wired `tsconfig.base.json` paths (`@sentinel/ai` + `@sentinel/ai/*`), root tsconfig references, `tsconfig.eslint.json` include, and the workspace; and extended the eslint `no-restricted-imports` ban to forbid `@sentinel/driver-*` from `packages/ai/**` while keeping the `packages/**/tests/**` exemption. B2 only adds `src/{verdict,analysis,load,redact}.ts`, their tests, and barrel re-export lines — it does not modify `package.json` or `eslint.config.cjs`.

---

> Sub-step B3 — deterministic classifier. Implements the pure `classify(events): RunClassification` from spec §4 (outcome+degradation, selector-drift, real-bug, infra-flake, business-outcome, healthy, indeterminate) plus its barrel, driven test-first with exhaustive per-verdict synthetic-event unit tests. Fully offline: tests import `{ test, expect }` from `@playwright/test` and request no `page` fixture, so no browser launches and zero API calls occur.

This sub-step assumes B2 has already landed `packages/ai/src/verdict.ts` (`Verdict`/`VerdictKind`/`Evidence`) and `packages/ai/src/analysis.ts` (`RunClassification`/`RunOutcome`/`RunAnalysis`/`ANALYSIS_SCHEMA_VERSION`), and that B1 wired the package into the tsconfig/eslint graph. All paths are absolute-from-repo-root under `/Users/zeeshan.amjad/Documents/sentinel-e2e`.

---

### B3 — Task 1: Test factories + failing drift-on-passing-run test

**Files:**

- Test (create): `packages/ai/tests/rules.test.ts`

This task creates the synthetic-`TelemetryEvent` factory helpers used by every later test, plus the first failing assertion (a silent-drift verdict on an otherwise-passing run). It must fail because `classify` does not exist yet.

- [ ] **Step 1: Create the test file with factories + the first (failing) test.**

```ts
// packages/ai/tests/rules.test.ts
import { test, expect } from "@playwright/test";
import { classify } from "@sentinel/ai";
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  AssertionEvent,
  RetryEvent,
  BusinessFailureEvent,
  SystemFailureEvent,
  FlowFinishedEvent,
} from "@sentinel/core";
import { TELEMETRY_SCHEMA_VERSION } from "@sentinel/core";

let seq = 0;
const base = <T extends TelemetryEvent["type"]>(type: T, name: string) => ({
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: `evt-${type}-${++seq}`,
  type,
  traceId: "run-1",
  spanId: `span-${seq}`,
  sequence: seq,
  name,
  timing: { startWallClockMs: seq, startMonotonicNs: BigInt(seq) },
});

const locatorResolved = (
  o: Partial<LocatorResolvedEvent> & { logicalName: string },
): LocatorResolvedEvent => ({
  ...base("locator.resolved", o.logicalName),
  logicalName: o.logicalName,
  resolvedKind: o.resolvedKind ?? "css",
  resolvedRank: o.resolvedRank ?? 0,
  degraded: o.degraded ?? false,
  candidates: o.candidates ?? [],
  score: o.score ?? 1,
  resolveDurationMs: o.resolveDurationMs ?? 1,
  ...o,
});

const assertion = (o: Partial<AssertionEvent>): AssertionEvent => ({
  ...base("assertion", o.name ?? "assert"),
  state: o.state ?? "visible",
  matched: o.matched ?? true,
  locatorRank: o.locatorRank ?? 0,
  ...o,
});

const retry = (o: Partial<RetryEvent>): RetryEvent => ({
  ...base("retry", o.name ?? "retry"),
  attempt: o.attempt ?? 1,
  maxAttempts: o.maxAttempts ?? 3,
  reason: o.reason ?? "transient",
  previousOutcome: o.previousOutcome ?? "timeout",
  ...o,
});

const businessFailure = (
  o: Partial<BusinessFailureEvent> & { domainReason: string },
): BusinessFailureEvent => ({
  ...base("business.failure", o.name ?? "business"),
  status: "ok",
  domainReason: o.domainReason,
  ...o,
});

const systemFailure = (
  o: Partial<SystemFailureEvent> & {
    errorKind: SystemFailureEvent["errorKind"];
  },
): SystemFailureEvent => ({
  ...base("system.failure", o.name ?? "system"),
  status: "error",
  errorKind: o.errorKind,
  message: o.message ?? "boom",
  retryable: o.retryable ?? false,
  artifactRefs: o.artifactRefs ?? [],
  ...o,
});

const flowFinished = (
  o: Partial<FlowFinishedEvent> & { outcome: FlowFinishedEvent["outcome"] },
): FlowFinishedEvent => ({
  ...base("flow.finished", o.name ?? "flow"),
  outcome: o.outcome,
  didDegrade: o.didDegrade ?? false,
  ...o,
});

test("classify: silent selector-drift on a passing run is surfaced (healthy + drift)", () => {
  const drifted = locatorResolved({
    logicalName: "auth.login.username",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const events: TelemetryEvent[] = [
    drifted,
    flowFinished({ outcome: "success", didDegrade: true }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("success");
  expect(c.degraded).toBe(true);
  const drift = c.verdicts.find((v) => v.kind === "selector-drift");
  expect(drift).toBeDefined();
  expect(drift?.confidence).toBe(0.9);
  expect(drift?.source).toBe("rule");
  expect(drift?.logicalName).toBe("auth.login.username");
  expect(drift?.evidence[0]?.eventId).toBe(drifted.eventId);
  // healthy coexists with the drift warning on a passing degraded run
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm the specific failure (no `classify` export yet).**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the run fails at module load with a missing-export/transpile error referencing `classify` not being exported from `@sentinel/ai`, e.g. a line containing:

```
The requested module '@sentinel/ai' does not provide an export named 'classify'
```

(0 tests passed.)

- [ ] **Step 3: Commit the failing test.**

Run:

```
git add packages/ai/tests/rules.test.ts && git commit -m "test(ai): add classifier factories + drift-on-passing-run case (red)"
```

Expected: a commit is created (commitlint passes; lint-staged runs clean on the staged test file).

---

### B3 — Task 2: Minimal `classify` — outcome, degradation, drift, healthy

**Files:**

- Create: `packages/ai/src/classify/rules.ts`
- Create: `packages/ai/src/classify/index.ts`
- Modify: `packages/ai/src/index.ts`

Implements §4 steps 1, 2 (locator.resolved drift only), and 6 (healthy) — the minimum to pass Task 1's test. Later tasks extend the same file for the remaining verdict kinds.

- [ ] **Step 1: Create `classify/rules.ts` with the outcome/degradation/drift/healthy core.**

```ts
// packages/ai/src/classify/rules.ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
} from "@sentinel/core";
import type { RunClassification, RunOutcome } from "../analysis";
import type { Verdict, Evidence } from "../verdict";

const OUTCOME_MAP: Record<FlowFinishedEvent["outcome"], RunOutcome> = {
  success: "success",
  "business-failure": "business-failure",
  "system-failure": "system-failure",
};

function isType<T extends TelemetryEvent["type"]>(
  e: TelemetryEvent,
  type: T,
): e is Extract<TelemetryEvent, { type: T }> {
  return e.type === type;
}

function driftEvidence(e: LocatorResolvedEvent): Evidence {
  const trail = e.candidates
    .map((c) => `${c.kind}:${c.outcome}@${c.rank}`)
    .join(" -> ");
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.logicalName}' degraded to '${e.resolvedKind}' rank ${e.resolvedRank} (${trail})`,
    fields: {
      logicalName: e.logicalName,
      resolvedKind: e.resolvedKind,
      resolvedRank: e.resolvedRank,
    },
  };
}

/** Pure deterministic classifier. No I/O, no API. Implements spec §4. */
export function classify(events: readonly TelemetryEvent[]): RunClassification {
  const runId = events[0]?.traceId ?? "";
  const flow = [...events]
    .reverse()
    .find((e): e is FlowFinishedEvent => isType(e, "flow.finished"));
  const flowName = flow?.name;
  const outcome: RunOutcome = flow ? OUTCOME_MAP[flow.outcome] : "unknown";

  const degradedResolutions = events.filter(
    (e): e is LocatorResolvedEvent =>
      isType(e, "locator.resolved") && (e.degraded || e.resolvedRank > 0),
  );
  const degraded =
    (flow?.didDegrade ?? false) || degradedResolutions.length > 0;

  const verdicts: Verdict[] = [];
  const indeterminate: Verdict[] = [];

  // §4.2 — selector-drift for each degraded locator.resolved
  for (const r of degradedResolutions) {
    verdicts.push({
      kind: "selector-drift",
      confidence: 0.9,
      summary: `Locator '${r.logicalName}' drifted to a rank-${r.resolvedRank} fallback`,
      evidence: [driftEvidence(r)],
      logicalName: r.logicalName,
      source: "rule",
    });
  }

  // §4.6 — healthy: success with no defects (coexists with drift warnings)
  const hasDefect = verdicts.some(
    (v) => v.kind === "real-bug" || v.kind === "business-outcome",
  );
  if (outcome === "success" && !hasDefect) {
    verdicts.push({
      kind: "healthy",
      confidence: 1.0,
      summary: degraded
        ? "Run succeeded but a locator silently drifted"
        : "Run succeeded with no degradation",
      evidence: [],
      source: "rule",
    });
  }

  return { runId, flowName, outcome, degraded, verdicts, indeterminate };
}
```

- [ ] **Step 2: Create the `classify` barrel.**

```ts
// packages/ai/src/classify/index.ts
export { classify } from "./rules";
```

- [ ] **Step 3: Re-export `classify` from the package barrel.**

Add the line below to `packages/ai/src/index.ts` (the B1 skeleton; keep any existing exports). If the file is the bare `export {};` skeleton, replace its contents with:

```ts
// packages/ai/src/index.ts
export * from "./verdict";
export * from "./analysis";
export * from "./classify";
```

(If B2 already added `verdict`/`analysis` re-exports, only add `export * from "./classify";` and leave the rest untouched.)

- [ ] **Step 4: Run the Task 1 test and confirm it passes.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
1 passed
```

- [ ] **Step 5: Typecheck the new code.**

Run:

```
npm run typecheck
```

Expected: exits 0 (no TypeScript errors).

- [ ] **Step 6: Commit the minimal classifier.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/src/classify/index.ts packages/ai/src/index.ts && git commit -m "feat(ai): classify outcome, degradation, selector-drift, healthy"
```

Expected: a commit is created (lint-staged + commitlint pass).

---

### B3 — Task 3: selector-not-found / selector-ambiguous drift

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Extends §4.2: a `system.failure` whose `errorKind` is `selector-not-found` or `selector-ambiguous` is also `selector-drift` (confidence 0.9), with evidence built from the failure's `name`/`message`.

- [ ] **Step 1: Add the failing test.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: selector-not-found system failure is selector-drift", () => {
  const fail = systemFailure({
    name: "auth.login.username",
    errorKind: "selector-not-found",
    message: "no element matched durable locator",
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const drift = c.verdicts.find((v) => v.kind === "selector-drift");
  expect(drift).toBeDefined();
  expect(drift?.confidence).toBe(0.9);
  expect(drift?.source).toBe("rule");
  expect(drift?.logicalName).toBe("auth.login.username");
  expect(drift?.evidence[0]?.eventId).toBe(fail.eventId);
  // a not-found drift must NOT be double-classified as infra-flake/real-bug
  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
  expect(c.verdicts.some((v) => v.kind === "infra-flake")).toBe(false);
});
```

- [ ] **Step 2: Run it and confirm the specific failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the new test fails with `Received: undefined` on `expect(drift).toBeDefined()` (the previous tests still pass).

- [ ] **Step 3: Implement the system-failure drift branch.**

In `packages/ai/src/classify/rules.ts`, add the type import and a helper, then the loop. First extend the import:

```ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
  SystemFailureEvent,
} from "@sentinel/core";
```

Add this helper just below `driftEvidence`:

```ts
const SELECTOR_DRIFT_KINDS: ReadonlySet<SystemFailureEvent["errorKind"]> =
  new Set(["selector-not-found", "selector-ambiguous"]);

function failureEvidence(e: SystemFailureEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}': ${e.errorKind} — ${e.message}`,
    fields: {
      logicalName: e.name,
      errorKind: e.errorKind,
      retryable: e.retryable,
    },
  };
}
```

Then, immediately after the `for (const r of degradedResolutions)` loop, add:

```ts
// §4.2 — selector-not-found / selector-ambiguous system failures are drift
for (const e of events) {
  if (!isType(e, "system.failure")) continue;
  if (!SELECTOR_DRIFT_KINDS.has(e.errorKind)) continue;
  verdicts.push({
    kind: "selector-drift",
    confidence: 0.9,
    summary: `Locator '${e.name}' could not be resolved (${e.errorKind})`,
    evidence: [failureEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
}
```

- [ ] **Step 4: Run the test and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
3 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): classify selector-not-found/ambiguous failures as drift"
```

Expected: a commit is created.

---

### B3 — Task 4: real-bug (rank-0 assertion mismatch, no preceding retry)

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Implements the first half of §4.3: an `assertion` with `matched:false && locatorRank===0` and **no preceding `retry`** in the same span → `real-bug` (0.85). A guard test proves a preceding `retry` on the same `spanId` suppresses it (so it can later be an infra-flake instead).

- [ ] **Step 1: Add the failing tests.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: rank-0 assertion mismatch with no prior retry is real-bug", () => {
  const a = assertion({
    name: "dashboard.greeting",
    spanId: "span-assert",
    matched: false,
    locatorRank: 0,
    state: "visible",
  });
  const events: TelemetryEvent[] = [
    a,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const bug = c.verdicts.find((v) => v.kind === "real-bug");
  expect(bug).toBeDefined();
  expect(bug?.confidence).toBe(0.85);
  expect(bug?.source).toBe("rule");
  expect(bug?.evidence[0]?.eventId).toBe(a.eventId);
});

test("classify: a preceding retry on the same span suppresses real-bug", () => {
  const r = retry({ spanId: "span-X", previousOutcome: "assertionFailed" });
  const a = assertion({
    name: "dashboard.greeting",
    spanId: "span-X",
    matched: false,
    locatorRank: 0,
  });
  const events: TelemetryEvent[] = [
    r,
    a,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the `real-bug` test fails on `expect(bug).toBeDefined()` (`Received: undefined`); the suppression test passes vacuously; earlier tests still pass.

- [ ] **Step 3: Implement the rank-0 assertion-mismatch branch.**

Extend the import in `packages/ai/src/classify/rules.ts`:

```ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
  SystemFailureEvent,
  AssertionEvent,
  RetryEvent,
} from "@sentinel/core";
```

Add this helper below `failureEvidence`:

```ts
function hasPrecedingRetry(
  events: readonly TelemetryEvent[],
  index: number,
  spanId: string,
): boolean {
  for (let i = 0; i < index; i++) {
    const e = events[i];
    if (e && isType(e, "retry") && e.spanId === spanId) return true;
  }
  return false;
}

function assertionEvidence(e: AssertionEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}' never reached state '${e.state}' (most-durable locator rank 0)`,
    fields: { state: e.state, matched: e.matched, locatorRank: e.locatorRank },
  };
}
```

Then, immediately after the system-failure drift loop, add:

```ts
// §4.3 — rank-0 assertion mismatch with no preceding retry → real-bug
events.forEach((e, i) => {
  if (!isType(e, "assertion")) return;
  if (e.matched || e.locatorRank !== 0) return;
  if (hasPrecedingRetry(events, i, e.spanId)) return;
  verdicts.push({
    kind: "real-bug",
    confidence: 0.85,
    summary: `Assertion '${e.name}' failed with a stable rank-0 locator`,
    evidence: [assertionEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
});
```

- [ ] **Step 4: Run and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
5 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): classify rank-0 assertion mismatch as real-bug"
```

Expected: a commit is created.

---

### B3 — Task 5: real-bug (timeout with branchProgress attached-not-visible)

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Implements the second half of §4.3: a `system.failure` of kind `timeout` whose `branchProgress` shows a success-signal branch that reached `attached` but not `visible` → `real-bug` candidate. The success signal lives on an `assertion`'s `branchProgress` (per `AssertionEvent`); the timeout failure references it. Per §4 this is a `real-bug`, so a matching timeout must NOT also be counted as infra-flake (enforced by Task 6's exclusion).

- [ ] **Step 1: Add the failing test.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: timeout whose branchProgress is attached-not-visible is real-bug", () => {
  const a = assertion({
    name: "dashboard.firstOf",
    spanId: "span-firstOf",
    matched: false,
    locatorRank: 1, // not a rank-0 mismatch; the signal is branchProgress
    state: "visible",
    branchProgress: [
      { label: "success", reachedState: "attached", resolvedRank: 0 },
      { label: "error", reachedState: "none", resolvedRank: null },
    ],
  });
  const fail = systemFailure({
    name: "dashboard.firstOf",
    spanId: "span-firstOf",
    errorKind: "timeout",
    retryable: true,
    message: "race timed out",
  });
  const events: TelemetryEvent[] = [
    a,
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const bug = c.verdicts.find((v) => v.kind === "real-bug");
  expect(bug).toBeDefined();
  expect(bug?.confidence).toBe(0.85);
  expect(bug?.evidence[0]?.eventId).toBe(fail.eventId);
  // the attached-not-visible timeout is a real-bug, never an infra-flake
  expect(c.verdicts.some((v) => v.kind === "infra-flake")).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the new test fails on `expect(bug).toBeDefined()` (`Received: undefined`); other tests still pass.

- [ ] **Step 3: Implement the attached-not-visible timeout branch.**

Add this helper to `packages/ai/src/classify/rules.ts` (below `assertionEvidence`):

```ts
/** True when any assertion in the same span shows a success-signal branch
 *  that reached "attached" but never "visible" (the app rendered the node
 *  but never made it visible — an app defect, not a flake). */
function isAttachedNotVisible(
  events: readonly TelemetryEvent[],
  spanId: string,
): boolean {
  return events.some(
    (e) =>
      isType(e, "assertion") &&
      e.spanId === spanId &&
      (e.branchProgress ?? []).some((b) => b.reachedState === "attached"),
  );
}
```

Then add, immediately after the rank-0 assertion loop (`events.forEach(...)`):

```ts
// §4.3 — timeout whose branchProgress is attached-not-visible → real-bug
const attachedNotVisibleTimeouts = new Set<string>();
for (const e of events) {
  if (!isType(e, "system.failure")) continue;
  if (e.errorKind !== "timeout") continue;
  if (!isAttachedNotVisible(events, e.spanId)) continue;
  attachedNotVisibleTimeouts.add(e.eventId);
  verdicts.push({
    kind: "real-bug",
    confidence: 0.85,
    summary: `Timeout on '${e.name}': success signal attached but never became visible`,
    evidence: [failureEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
}
```

> Note: `attachedNotVisibleTimeouts` is referenced by Task 6's infra-flake exclusion. Declare it here so the set is in scope for the next branch.

- [ ] **Step 4: Run and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
6 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): classify attached-not-visible timeout as real-bug"
```

Expected: a commit is created.

---

### B3 — Task 6: infra-flake (retry-then-pass + retryable timeout/driver-session)

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Implements §4.4: a `retry` followed by an eventual passing terminal (retry-then-pass), and a `retryable:true` `timeout`/`driver-session` failure that is NOT already a rank-0 assertion mismatch nor an attached-not-visible timeout → `infra-flake` (0.8).

- [ ] **Step 1: Add the failing tests.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: retry-then-pass is infra-flake", () => {
  const r = retry({
    name: "loginForm.submit",
    spanId: "span-submit",
    previousOutcome: "timeout",
  });
  const events: TelemetryEvent[] = [r, flowFinished({ outcome: "success" })];

  const c = classify(events);

  const flake = c.verdicts.find((v) => v.kind === "infra-flake");
  expect(flake).toBeDefined();
  expect(flake?.confidence).toBe(0.8);
  expect(flake?.source).toBe("rule");
  expect(flake?.evidence[0]?.eventId).toBe(r.eventId);
});

test("classify: retryable timeout (not a rank-0 mismatch) is infra-flake", () => {
  const fail = systemFailure({
    name: "loginForm.submit",
    spanId: "span-submit",
    errorKind: "timeout",
    retryable: true,
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const flake = c.verdicts.find((v) => v.kind === "infra-flake");
  expect(flake).toBeDefined();
  expect(flake?.confidence).toBe(0.8);
  expect(flake?.evidence[0]?.eventId).toBe(fail.eventId);
  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: both new tests fail on `expect(flake).toBeDefined()` (`Received: undefined`); earlier tests still pass.

- [ ] **Step 3: Implement the infra-flake branches.**

Add a `retry` evidence helper to `packages/ai/src/classify/rules.ts` (below `failureEvidence`):

```ts
function retryEvidence(e: RetryEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}' retried (attempt ${e.attempt}/${e.maxAttempts}; previous: ${e.previousOutcome})`,
    fields: {
      attempt: e.attempt,
      maxAttempts: e.maxAttempts,
      previousOutcome: e.previousOutcome,
    },
  };
}
```

Then add, immediately after the attached-not-visible timeout loop, a `RETRYABLE_FLAKE_KINDS` set plus the two branches. Define the set at module scope (next to `SELECTOR_DRIFT_KINDS`):

```ts
const RETRYABLE_FLAKE_KINDS: ReadonlySet<SystemFailureEvent["errorKind"]> =
  new Set(["timeout", "driver-session"]);
```

And inside `classify`, after the attached-not-visible loop:

```ts
// §4.4 — retry-then-pass → infra-flake
if (outcome === "success") {
  for (const e of events) {
    if (!isType(e, "retry")) continue;
    verdicts.push({
      kind: "infra-flake",
      confidence: 0.8,
      summary: `Transient failure on '${e.name}' recovered after retry`,
      evidence: [retryEvidence(e)],
      logicalName: e.name,
      source: "rule",
    });
  }
}

// §4.4 — retryable timeout/driver-session that is NOT already a rank-0
// assertion mismatch nor an attached-not-visible timeout → infra-flake
const rankZeroMismatchSpans = new Set(
  events
    .filter(
      (e): e is AssertionEvent =>
        isType(e, "assertion") && !e.matched && e.locatorRank === 0,
    )
    .map((e) => e.spanId),
);
for (const e of events) {
  if (!isType(e, "system.failure")) continue;
  if (!e.retryable || !RETRYABLE_FLAKE_KINDS.has(e.errorKind)) continue;
  if (attachedNotVisibleTimeouts.has(e.eventId)) continue;
  if (rankZeroMismatchSpans.has(e.spanId)) continue;
  verdicts.push({
    kind: "infra-flake",
    confidence: 0.8,
    summary: `Retryable ${e.errorKind} on '${e.name}'`,
    evidence: [failureEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
}
```

- [ ] **Step 4: Run and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
8 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): classify retry-then-pass and retryable timeouts as infra-flake"
```

Expected: a commit is created.

---

### B3 — Task 7: business-outcome (carry domainReason)

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Implements §4.5: each `business.failure` → a `business-outcome` verdict (confidence 1.0) carrying `domainReason`. This is the system working correctly — not a defect — so it must suppress the otherwise-`healthy` verdict.

- [ ] **Step 1: Add the failing test.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: business.failure is business-outcome carrying domainReason", () => {
  const bf = businessFailure({
    name: "auth.login",
    domainReason: "INVALID_CREDENTIALS",
  });
  const events: TelemetryEvent[] = [
    bf,
    flowFinished({
      outcome: "business-failure",
      terminalReason: "INVALID_CREDENTIALS",
    }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("business-failure");
  const bo = c.verdicts.find((v) => v.kind === "business-outcome");
  expect(bo).toBeDefined();
  expect(bo?.confidence).toBe(1.0);
  expect(bo?.source).toBe("rule");
  expect(bo?.evidence[0]?.eventId).toBe(bf.eventId);
  expect(bo?.evidence[0]?.fields?.domainReason).toBe("INVALID_CREDENTIALS");
  // a business outcome is not a defect, but it is also not "healthy"
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the new test fails on `expect(bo).toBeDefined()` (`Received: undefined`); other tests still pass.

- [ ] **Step 3: Implement the business-outcome branch.**

Extend the import in `packages/ai/src/classify/rules.ts`:

```ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
  SystemFailureEvent,
  AssertionEvent,
  RetryEvent,
  BusinessFailureEvent,
} from "@sentinel/core";
```

Add an evidence helper (below `retryEvidence`):

```ts
function businessEvidence(e: BusinessFailureEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `Domain outcome '${e.domainReason}' on '${e.name}' (system behaved correctly)`,
    fields: { domainReason: e.domainReason },
  };
}
```

Add this branch in `classify`, before the §4.6 healthy block (so `hasDefect` sees it):

```ts
// §4.5 — each business.failure → business-outcome (NOT a defect)
for (const e of events) {
  if (!isType(e, "business.failure")) continue;
  verdicts.push({
    kind: "business-outcome",
    confidence: 1.0,
    summary: `Business outcome: ${e.domainReason}`,
    evidence: [businessEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
}
```

`business-outcome` is already in the `hasDefect` predicate from Task 2 (`v.kind === "business-outcome"`), so the `healthy` block is correctly suppressed.

- [ ] **Step 4: Run and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
9 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): classify business.failure as business-outcome"
```

Expected: a commit is created.

---

### B3 — Task 8: indeterminate (unmatched failure) + healthy purity

**Files:**

- Modify: `packages/ai/src/classify/rules.ts`
- Test (modify): `packages/ai/tests/rules.test.ts`

Implements §4.7: a failure/anomaly matching no rule (e.g. `system.failure` of kind `assertion-infrastructure`, or a `system-failure` terminal whose cause the rules cannot pin) → an `indeterminate` verdict (confidence ~0) pushed into `RunClassification.indeterminate` (not `verdicts`). Adds an explicit `healthy` (no-degradation) assertion to lock §4.6.

- [ ] **Step 1: Add the failing tests.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: assertion-infrastructure failure is indeterminate (for the LLM)", () => {
  const fail = systemFailure({
    name: "loginForm.submit",
    errorKind: "assertion-infrastructure",
    retryable: false,
    message: "driver returned an unexpected null handle",
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  expect(c.verdicts.length).toBe(0);
  expect(c.indeterminate.length).toBe(1);
  const ind = c.indeterminate[0];
  expect(ind?.kind).toBe("indeterminate");
  expect(ind?.confidence).toBe(0);
  expect(ind?.source).toBe("rule");
  expect(ind?.evidence[0]?.eventId).toBe(fail.eventId);
});

test("classify: clean success with no degradation is purely healthy", () => {
  const events: TelemetryEvent[] = [
    locatorResolved({ logicalName: "auth.login.username", resolvedRank: 0 }),
    assertion({ name: "dashboard.greeting", matched: true, locatorRank: 0 }),
    flowFinished({ outcome: "success", didDegrade: false }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("success");
  expect(c.degraded).toBe(false);
  expect(c.verdicts.map((v) => v.kind)).toEqual(["healthy"]);
  expect(c.verdicts[0]?.confidence).toBe(1.0);
  expect(c.indeterminate.length).toBe(0);
});
```

- [ ] **Step 2: Run and confirm failure.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected: the indeterminate test fails on `expect(c.indeterminate.length).toBe(1)` (`Received: 0`); the purely-healthy test passes; earlier tests still pass.

- [ ] **Step 3: Implement the indeterminate catch-all.**

Add this block in `classify`, AFTER the §4.6 healthy block and BEFORE the `return`. It flags any `system.failure` not already explained by a verdict (drift/real-bug/infra-flake) on the same event, and any unexplained `system-failure` terminal:

```ts
// §4.7 — anything unmatched → indeterminate (for the LLM to adjudicate)
const explainedFailureEventIds = new Set(
  verdicts
    .flatMap((v) => v.evidence)
    .filter((ev) => ev.type === "system.failure")
    .map((ev) => ev.eventId),
);
for (const e of events) {
  if (!isType(e, "system.failure")) continue;
  if (explainedFailureEventIds.has(e.eventId)) continue;
  indeterminate.push({
    kind: "indeterminate",
    confidence: 0,
    summary: `Unclassified ${e.errorKind} on '${e.name}' — needs adjudication`,
    evidence: [failureEvidence(e)],
    logicalName: e.name,
    source: "rule",
  });
}
// a system-failure terminal explained by no verdict at all → indeterminate
if (
  outcome === "system-failure" &&
  verdicts.length === 0 &&
  indeterminate.length === 0 &&
  flow
) {
  indeterminate.push({
    kind: "indeterminate",
    confidence: 0,
    summary: `Run ended in system-failure with no pinnable cause${flow.terminalReason ? ` (${flow.terminalReason})` : ""}`,
    evidence: [
      {
        eventId: flow.eventId,
        type: flow.type,
        detail: `flow.finished outcome=system-failure${flow.terminalReason ? ` reason=${flow.terminalReason}` : ""}`,
        fields: { outcome: flow.outcome },
      },
    ],
    source: "rule",
  });
}
```

> The healthy block already requires `outcome === "success"`, so a `system-failure` run produces no `healthy` verdict; with no other verdict it now yields exactly one `indeterminate`. `assertion-infrastructure` is neither a drift kind, a rank-0 mismatch, nor retryable-flake, so it is unexplained and becomes `indeterminate`.

- [ ] **Step 4: Run and confirm pass.**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
11 passed
```

- [ ] **Step 5: Commit.**

Run:

```
git add packages/ai/src/classify/rules.ts packages/ai/tests/rules.test.ts && git commit -m "feat(ai): route unmatched failures to indeterminate verdicts"
```

Expected: a commit is created.

---

### B3 — Task 9: combined multi-verdict run + full gate

**Files:**

- Test (modify): `packages/ai/tests/rules.test.ts`

Locks the §4 worked example (auth-invalid run → `business-outcome(INVALID_CREDENTIALS)` + two `selector-drift` verdicts, outcome `business-failure`, `degraded:true`) and runs the full typecheck + lint + unit gate so B3 lands green.

- [ ] **Step 1: Add the combined-run test.**

Append to `packages/ai/tests/rules.test.ts`:

```ts
test("classify: auth-invalid run yields business-outcome + two drift verdicts", () => {
  const u = locatorResolved({
    logicalName: "auth.login.username",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const p = locatorResolved({
    logicalName: "auth.login.password",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const bf = businessFailure({
    name: "auth.login",
    domainReason: "INVALID_CREDENTIALS",
  });
  const events: TelemetryEvent[] = [
    u,
    p,
    bf,
    flowFinished({
      outcome: "business-failure",
      terminalReason: "INVALID_CREDENTIALS",
      didDegrade: true,
    }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("business-failure");
  expect(c.degraded).toBe(true);
  const kinds = c.verdicts.map((v) => v.kind).sort();
  expect(kinds).toEqual([
    "business-outcome",
    "selector-drift",
    "selector-drift",
  ]);
  const driftNames = c.verdicts
    .filter((v) => v.kind === "selector-drift")
    .map((v) => v.logicalName)
    .sort();
  expect(driftNames).toEqual(["auth.login.password", "auth.login.username"]);
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(false);
  expect(c.indeterminate.length).toBe(0);
});
```

- [ ] **Step 2: Run and confirm pass (no implementation change needed).**

Run:

```
npm run test:unit -- packages/ai/tests/rules.test.ts
```

Expected:

```
12 passed
```

- [ ] **Step 3: Run the full B3 gate (typecheck + lint + whole unit suite).**

Run:

```
npm run typecheck && npm run lint && npm run test:unit
```

Expected: `typecheck` exits 0; `lint` exits 0 (the `@sentinel/ai` boundary holds — `rules.ts` imports only `@sentinel/core` + local types, no driver, no SDK); the full unit suite reports `passed` with no failures, including the 12 `rules.test.ts` cases.

- [ ] **Step 4: Commit.**

Run:

```
git add packages/ai/tests/rules.test.ts && git commit -m "test(ai): lock auth-invalid multi-verdict classification"
```

Expected: a commit is created.

---

Findings relevant to the assembler / later sub-steps:

- Grounded the classifier against the real telemetry types in `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/core/src/telemetry/signals.ts` and `.../telemetry/event.ts`: the `TelemetryEvent` union members (`LocatorResolvedEvent`, `AssertionEvent`, `RetryEvent`, `BusinessFailureEvent`, `SystemFailureEvent`, `FlowFinishedEvent`) are exported from `@sentinel/core` (barrel re-exports `./telemetry`), so the test factories and `rules.ts` import all event types and `TELEMETRY_SCHEMA_VERSION` directly from `@sentinel/core`.
- `SystemFailureKind` (`/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/core/src/errors/system-failure-error.ts`) values used in tasks: `timeout | selector-not-found | selector-ambiguous | driver-session | assertion-infrastructure | capability-unsupported` — matching the §4 rules exactly.
- `BranchProgress` (`/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/contracts/src/assertion.ts`) is `{ label; reachedState: ElementState | "none"; resolvedRank: number | null }`. `AssertionEvent.branchProgress` carries it, so the §4.3 attached-not-visible signal is read from the assertion's `branchProgress` and tied to the timeout `system.failure` by shared `spanId`.
- Test convention confirmed from `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/core/tests/composite-sink.test.ts` and `playwright.unit.config.ts` (testMatch `packages/**/tests/**/*.test.ts`): `import { test, expect } from "@playwright/test"`, no `page` fixture used — tasks comply (pure/offline).
- `timing.startMonotonicNs` is `bigint`; factories use `BigInt(seq)` to satisfy strict typing. The classifier performs no bigint math (consistent with spec §13 Q3).
- Two cross-task dependencies are made explicit in-line: the `attachedNotVisibleTimeouts` set (declared in Task 5) is consumed by Task 6's infra-flake exclusion, and `business-outcome` is added to the `hasDefect` predicate in Task 2 so Task 7's healthy-suppression works without re-editing.

---

> Sub-step B4 — provider interface + orchestrator. This sub-step adds the driver-agnostic LLM `provider.ts` (the `LlmProvider` interface, `AnalysisContext`/`LlmAdjudication`/`LlmRunResult` types, and the canned `FakeLlmProvider`), its SDK-free barrel `llm/index.ts`, and the `analyze.ts` orchestrator that wires load → classify → optional-LLM-merge into a `RunAnalysis` while degrading gracefully when the LLM is absent or throws. All tests are pure/offline Playwright unit tests driven by in-memory `TelemetryEvent[]` with a `FakeLlmProvider` — zero browser, zero API.

---

### B4 — Task 1: Provider abstraction (`llm/provider.ts`) + SDK-free barrel

**Files:**

- Create: `packages/ai/src/llm/provider.ts`
- Create: `packages/ai/src/llm/index.ts`
- Test: `packages/ai/tests/llm-provider.test.ts`

- [ ] **Step 1: Write the failing test for the provider contract + `FakeLlmProvider`.**

```ts
// packages/ai/tests/llm-provider.test.ts
import { test, expect } from "@playwright/test";
import type { AnalysisContext, LlmRunResult } from "../src/llm/provider";
import { FakeLlmProvider } from "../src/llm";
import type { RunClassification } from "../src/analysis";
import type { Verdict } from "../src/verdict";

const classification: RunClassification = {
  runId: "trace-1",
  outcome: "system-failure",
  degraded: false,
  verdicts: [],
  indeterminate: [],
};

const ctx: AnalysisContext = {
  runId: "trace-1",
  outcome: "system-failure",
  classification,
  events: [],
};

const adjudicatedVerdict: Verdict = {
  kind: "real-bug",
  confidence: 0.7,
  summary: "llm decided",
  evidence: [],
  source: "llm",
};

const canned: LlmRunResult = {
  explanation: "the run failed because X",
  adjudications: [{ eventId: "e-1", verdict: adjudicatedVerdict }],
};

test("FakeLlmProvider resolves the canned result verbatim", async () => {
  const provider = new FakeLlmProvider(canned);
  const result = await provider.analyze(ctx);
  expect(result.explanation).toBe("the run failed because X");
  expect(result.adjudications).toHaveLength(1);
  expect(result.adjudications[0]?.eventId).toBe("e-1");
  expect(result.adjudications[0]?.verdict.source).toBe("llm");
});

test("barrel re-exports the interface members and FakeLlmProvider", () => {
  expect(typeof FakeLlmProvider).toBe("function");
});
```

Run:

```
npm run test:unit -- packages/ai/tests/llm-provider.test.ts
```

Expected: fails to compile / run — `Cannot find module '../src/llm/provider'` (and `../src/llm`), because the files do not exist yet.

- [ ] **Step 2: Create `llm/provider.ts` copying spec §5.1 exactly.**

```ts
// packages/ai/src/llm/provider.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { RunClassification, RunOutcome } from "../analysis";
import type { Verdict } from "../verdict";

export interface AnalysisContext {
  readonly runId: string;
  readonly outcome: RunOutcome;
  readonly classification: RunClassification; // the deterministic verdicts
  readonly events: readonly TelemetryEvent[]; // REDACTED, compacted events
}

export interface LlmAdjudication {
  readonly logicalName?: string;
  readonly eventId?: string;
  readonly verdict: Verdict; // source: "llm"
}

export interface LlmRunResult {
  readonly explanation: string; // plain-language run explanation
  readonly adjudications: readonly LlmAdjudication[]; // verdicts for the indeterminate cases
}

export interface LlmProvider {
  analyze(ctx: AnalysisContext): Promise<LlmRunResult>;
}

/** Deterministic canned provider for tests — zero API calls. */
export class FakeLlmProvider implements LlmProvider {
  constructor(private readonly canned: LlmRunResult) {}
  analyze(): Promise<LlmRunResult> {
    return Promise.resolve(this.canned);
  }
}
```

Run:

```
npm run typecheck
```

Expected: exits `0` (the new file type-checks against `@sentinel/core`, `../analysis`, `../verdict` from B2).

- [ ] **Step 3: Create the SDK-free barrel `llm/index.ts` (re-export interface + Fake; NOT the claude provider).**

```ts
// packages/ai/src/llm/index.ts
// SDK-free barrel: re-exports ONLY the provider interface + the test fake.
// claude-provider.ts is deliberately NOT re-exported so importing @sentinel/ai
// never pulls @anthropic-ai/sdk into the deterministic import path.
export type {
  AnalysisContext,
  LlmAdjudication,
  LlmRunResult,
  LlmProvider,
} from "./provider";
export { FakeLlmProvider } from "./provider";
```

Run:

```
npm run test:unit -- packages/ai/tests/llm-provider.test.ts
```

Expected: `2 passed`.

- [ ] **Step 4: Commit.**

```
git add packages/ai/src/llm/provider.ts packages/ai/src/llm/index.ts packages/ai/tests/llm-provider.test.ts
git commit -m "feat(ai): llm provider interface + FakeLlmProvider"
```

Expected: commit created; pre-commit lint-staged + commit-msg commitlint pass (lowercase conventional subject, scope `ai`).

---

### B4 — Task 2: Orchestrator skeleton — `analyzeRun` with `provider: null` (rules-only)

**Files:**

- Create: `packages/ai/src/analyze.ts`
- Test: `packages/ai/tests/analyze.test.ts`

- [ ] **Step 1: Write the failing rules-only test (in-memory events, `provider: null`).**

```ts
// packages/ai/tests/analyze.test.ts
import { test, expect } from "@playwright/test";
import type { TelemetryEvent } from "@sentinel/core";
import { analyzeRun } from "../src/analyze";
import { ANALYSIS_SCHEMA_VERSION } from "../src/analysis";

const TRACE = "trace-b4";

function baseEnvelope(
  type: TelemetryEvent["type"],
  eventId: string,
  sequence: number,
  name: string,
): TelemetryEvent {
  return {
    schemaVersion: "1.0.0",
    eventId,
    type,
    traceId: TRACE,
    spanId: `span-${sequence}`,
    sequence,
    name,
    timing: { startWallClockMs: 1000 + sequence, startMonotonicNs: 0n },
  } as TelemetryEvent;
}

/** A real-bug run: rank-0 assertion mismatch, no preceding retry, system-failure terminal. */
function realBugEvents(): TelemetryEvent[] {
  const assertion = {
    ...baseEnvelope("assertion", "assert-1", 1, "auth.appShell.ready"),
    status: "error",
    state: "visible",
    matched: false,
    locatorRank: 0,
  } as TelemetryEvent;
  const finished = {
    ...baseEnvelope("flow.finished", "finish-1", 2, "auth.login"),
    status: "error",
    outcome: "system-failure",
    didDegrade: false,
  } as TelemetryEvent;
  return [assertion, finished];
}

test("provider:null => rules-only analysis (usedLlm:false, no llmError)", async () => {
  const analysis = await analyzeRun(realBugEvents(), { provider: null });

  expect(analysis.schemaVersion).toBe(ANALYSIS_SCHEMA_VERSION);
  expect(analysis.runId).toBe(TRACE);
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBeUndefined();
  expect(analysis.explanation).toBeUndefined();
  // verdicts come straight from the classifier.
  expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  expect(analysis.verdicts.every((v) => v.source === "rule")).toBe(true);
});
```

Run:

```
npm run test:unit -- packages/ai/tests/analyze.test.ts
```

Expected: fails — `Cannot find module '../src/analyze'`.

- [ ] **Step 2: Create `analyze.ts` with load → classify → rules-only `RunAnalysis` (no LLM branch yet).**

```ts
// packages/ai/src/analyze.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { LlmProvider } from "./llm/provider";
import { ANALYSIS_SCHEMA_VERSION, type RunAnalysis } from "./analysis";
import { loadEvents } from "./load";
import { classify } from "./classify";

export interface AnalyzeOptions {
  /** undefined = auto (ClaudeProvider iff ANTHROPIC_API_KEY present); null = force rules-only. */
  readonly provider?: LlmProvider | null;
  readonly explain?: boolean; // default true
}

export async function analyzeRun(
  input: string | readonly TelemetryEvent[], // JSONL path or in-memory events
  opts?: AnalyzeOptions,
): Promise<RunAnalysis> {
  const events = loadEvents(input);
  const classification = classify(events);

  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
  };
}
```

Run:

```
npm run typecheck
```

Expected: exits `0`. (`loadEvents` from B2 `load.ts`, `classify` from B3 `classify/index.ts` are already present on this branch; `opts` is intentionally unused until Task 3 — `noUnusedParameters` is not enabled, leading-underscore not required.)

> Note: if `npm run typecheck` reports `'opts' is declared but its value is never read`, prefix the param `_opts` here and rename it back to `opts` in Task 3. The repo tsconfig does not set `noUnusedParameters`, so this is not expected.

Run:

```
npm run test:unit -- packages/ai/tests/analyze.test.ts
```

Expected: `1 passed`.

- [ ] **Step 3: Commit.**

```
git add packages/ai/src/analyze.ts packages/ai/tests/analyze.test.ts
git commit -m "feat(ai): analyzeRun orchestrator skeleton (rules-only)"
```

Expected: commit created; hooks pass.

---

### B4 — Task 3: Resolve provider + merge explanation/adjudications (`FakeLlmProvider` path)

**Files:**

- Modify: `packages/ai/src/analyze.ts`
- Modify: `packages/ai/tests/analyze.test.ts`

- [ ] **Step 1: Add the failing merge test (FakeLlmProvider with canned explanation + one adjudication merged into verdicts).**

Append to `packages/ai/tests/analyze.test.ts`:

```ts
import { FakeLlmProvider } from "../src/llm";
import type { LlmRunResult } from "../src/llm";

/** An indeterminate run: assertion-infrastructure system.failure the rules can't pin. */
function indeterminateEvents(): TelemetryEvent[] {
  const failure = {
    ...baseEnvelope("system.failure", "sys-1", 1, "auth.login.submit"),
    status: "error",
    errorKind: "assertion-infrastructure",
    message: "selector engine crashed",
    retryable: false,
    artifactRefs: [],
  } as TelemetryEvent;
  const finished = {
    ...baseEnvelope("flow.finished", "finish-1", 2, "auth.login"),
    status: "error",
    outcome: "system-failure",
    didDegrade: false,
  } as TelemetryEvent;
  return [failure, finished];
}

const cannedResult: LlmRunResult = {
  explanation: "Claude says the selector engine crashed mid-assertion.",
  adjudications: [
    {
      eventId: "sys-1",
      verdict: {
        kind: "infra-flake",
        confidence: 0.6,
        summary: "transient selector-engine crash",
        evidence: [],
        source: "llm",
      },
    },
  ],
};

test("FakeLlmProvider => explanation + adjudicated verdict merged, usedLlm:true", async () => {
  const analysis = await analyzeRun(indeterminateEvents(), {
    provider: new FakeLlmProvider(cannedResult),
  });

  expect(analysis.usedLlm).toBe(true);
  expect(analysis.llmError).toBeUndefined();
  expect(analysis.explanation).toBe(
    "Claude says the selector engine crashed mid-assertion.",
  );
  // the llm-sourced verdict is appended to the merged verdict list.
  const llmVerdict = analysis.verdicts.find((v) => v.source === "llm");
  expect(llmVerdict?.kind).toBe("infra-flake");
  expect(llmVerdict?.summary).toBe("transient selector-engine crash");
});

test("explain defaults to true => LLM invoked even with no indeterminate verdicts", async () => {
  const explainOnly: LlmRunResult = {
    explanation: "All green; one selector drifted silently.",
    adjudications: [],
  };
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new FakeLlmProvider(explainOnly),
  });
  expect(analysis.usedLlm).toBe(true);
  expect(analysis.explanation).toBe(
    "All green; one selector drifted silently.",
  );
});

test("explain:false with no indeterminate verdicts => LLM not invoked", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new FakeLlmProvider(cannedResult),
    explain: false,
  });
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.explanation).toBeUndefined();
});
```

Run:

```
npm run test:unit -- packages/ai/tests/analyze.test.ts
```

Expected: the three new tests fail (`usedLlm` is `false`; `explanation` undefined; no `source:"llm"` verdict) because the orchestrator does not yet call the provider.

- [ ] **Step 2: Implement provider resolution + redact + merge in `analyze.ts`.**

Replace the entire body of `packages/ai/src/analyze.ts` with:

```ts
// packages/ai/src/analyze.ts
import type { TelemetryEvent } from "@sentinel/core";
import type { AnalysisContext, LlmProvider } from "./llm/provider";
import {
  ANALYSIS_SCHEMA_VERSION,
  type RunAnalysis,
  type RunClassification,
} from "./analysis";
import type { Verdict } from "./verdict";
import { loadEvents } from "./load";
import { classify } from "./classify";
import { redactEvents } from "./redact";

export interface AnalyzeOptions {
  /** undefined = auto (ClaudeProvider iff ANTHROPIC_API_KEY present); null = force rules-only. */
  readonly provider?: LlmProvider | null;
  readonly explain?: boolean; // default true
}

/**
 * Resolve the provider per spec §6:
 *   - explicit provider (incl. a fake) wins;
 *   - null forces rules-only;
 *   - undefined => auto: a ClaudeProvider IFF ANTHROPIC_API_KEY is set, else none.
 * The claude provider is imported LAZILY so importing @sentinel/ai never pulls
 * @anthropic-ai/sdk into the deterministic path.
 */
async function resolveProvider(
  provider: LlmProvider | null | undefined,
): Promise<LlmProvider | null> {
  if (provider !== undefined) return provider; // explicit provider OR null
  if (!process.env.ANTHROPIC_API_KEY) return null; // auto, no key => none
  const { ClaudeProvider } = await import("./llm/claude-provider");
  return new ClaudeProvider();
}

/** Append llm-sourced adjudications to the rule verdicts (rules are never overridden). */
function mergeVerdicts(
  classification: RunClassification,
  adjudications: readonly { verdict: Verdict }[],
): readonly Verdict[] {
  return [...classification.verdicts, ...adjudications.map((a) => a.verdict)];
}

export async function analyzeRun(
  input: string | readonly TelemetryEvent[], // JSONL path or in-memory events
  opts?: AnalyzeOptions,
): Promise<RunAnalysis> {
  const events = loadEvents(input);
  const classification = classify(events);
  const explain = opts?.explain ?? true;

  const base: RunAnalysis = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: classification.runId,
    outcome: classification.outcome,
    verdicts: classification.verdicts,
    usedLlm: false,
  };

  let provider: LlmProvider | null;
  try {
    provider = await resolveProvider(opts?.provider);
  } catch (err) {
    // a lazy-import / construction failure must never fail the analysis.
    return { ...base, llmError: errorMessage(err) };
  }

  const shouldUseLlm =
    provider !== null && (classification.indeterminate.length > 0 || explain);

  // auto-mode with explain requested but no key/provider => note it, rules-only.
  if (provider === null) {
    if (opts?.provider === undefined && explain) {
      return { ...base, llmError: "no ANTHROPIC_API_KEY; rules-only" };
    }
    return base;
  }

  if (!shouldUseLlm) return base;

  const ctx: AnalysisContext = {
    runId: classification.runId,
    outcome: classification.outcome,
    classification,
    events: redactEvents(events),
  };

  try {
    const result = await provider.analyze(ctx);
    return {
      ...base,
      usedLlm: true,
      explanation: result.explanation,
      verdicts: mergeVerdicts(classification, result.adjudications),
    };
  } catch (err) {
    // graceful: rules verdicts intact, LLM skipped.
    return { ...base, llmError: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

Run:

```
npm run typecheck
```

Expected: exits `0`. (`redactEvents` from B2 `redact.ts`; the lazy `./llm/claude-provider` `ClaudeProvider` symbol arrives in B5 — at compile time `tsc -b` requires the module to exist. If B5 is not yet built in your local stack, this import is the one forward reference; the orchestrator tests never execute it, but `tsc` needs the file. See Step 3.)

- [ ] **Step 3: Ensure the lazy import resolves at compile time (forward-reference stub if B5 is not landed yet).**

This task only needs `ClaudeProvider` to _exist as a type/value_ for `tsc -b`; it is never executed by the offline tests (no `ANTHROPIC_API_KEY` in CI, and every orchestrator test passes an explicit provider or `null`). If `packages/ai/src/llm/claude-provider.ts` is not present yet on this branch, the lazy `await import("./llm/claude-provider")` will fail `tsc`. Confirm:

```
ls packages/ai/src/llm/claude-provider.ts
```

Expected: the file exists (authored in B5). If it does NOT exist yet because B5 lands after B4 in your build order, create the minimal compile stub below; B5 replaces it wholesale.

```ts
// packages/ai/src/llm/claude-provider.ts  (compile stub; B5 replaces this with the real @anthropic-ai/sdk provider)
import type { AnalysisContext, LlmProvider, LlmRunResult } from "./provider";

export class ClaudeProvider implements LlmProvider {
  analyze(_ctx: AnalysisContext): Promise<LlmRunResult> {
    throw new Error("ClaudeProvider not implemented until B5");
  }
}
```

Run:

```
npm run typecheck
```

Expected: exits `0`.

- [ ] **Step 4: Run the orchestrator suite — all merge/explain cases green.**

Run:

```
npm run test:unit -- packages/ai/tests/analyze.test.ts
```

Expected: `5 passed` (rules-only + merge + explain-default + explain:false + the Task-4 reject test once added — at this point the four existing tests pass: `4 passed`).

- [ ] **Step 5: Commit.**

```
git add packages/ai/src/analyze.ts packages/ai/tests/analyze.test.ts
git commit -m "feat(ai): resolve provider, redact, merge llm explanation+adjudications"
```

Expected: commit created; hooks pass.

---

### B4 — Task 4: Graceful degradation — provider rejection + auto-no-key

**Files:**

- Modify: `packages/ai/tests/analyze.test.ts`

- [ ] **Step 1: Add the failing graceful-degradation tests.**

Append to `packages/ai/tests/analyze.test.ts`:

```ts
import type { AnalysisContext, LlmProvider, LlmRunResult } from "../src/llm";

/** A provider whose analyze() always rejects. */
class RejectingProvider implements LlmProvider {
  analyze(_ctx: AnalysisContext): Promise<LlmRunResult> {
    return Promise.reject(new Error("rate limited"));
  }
}

test("provider.analyze rejects => usedLlm:false, llmError set, verdicts intact", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: new RejectingProvider(),
  });

  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBe("rate limited");
  expect(analysis.explanation).toBeUndefined();
  // rule verdicts survive the LLM failure.
  expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  expect(analysis.verdicts.every((v) => v.source === "rule")).toBe(true);
});

test("auto-mode (provider undefined) with no ANTHROPIC_API_KEY => rules-only + llmError note", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const analysis = await analyzeRun(realBugEvents()); // no opts => explain default true
    expect(analysis.usedLlm).toBe(false);
    expect(analysis.llmError).toBe("no ANTHROPIC_API_KEY; rules-only");
    expect(analysis.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("explain:false, provider:null => clean rules-only, no llmError", async () => {
  const analysis = await analyzeRun(realBugEvents(), {
    provider: null,
    explain: false,
  });
  expect(analysis.usedLlm).toBe(false);
  expect(analysis.llmError).toBeUndefined();
});
```

Run:

```
npm run test:unit -- packages/ai/tests/analyze.test.ts
```

Expected: the three new tests pass immediately against the Task-3 implementation (it already catches rejections, notes the absent-key case, and stays clean for `provider:null`+`explain:false`). This is the green confirmation that the orchestrator's graceful paths are correct. Full file: `7 passed`.

> If the absent-key test instead sees a real `ANTHROPIC_API_KEY` in your shell, the `delete`/restore guard in the test neutralizes it for the duration of the assertion; confirm no leftover env by `printenv ANTHROPIC_API_KEY` returning empty before the run.

- [ ] **Step 2: Commit.**

```
git add packages/ai/tests/analyze.test.ts
git commit -m "test(ai): orchestrator graceful degradation (provider reject + no-key)"
```

Expected: commit created; hooks pass.

---

### B4 — Task 5: Sub-step gate — typecheck + lint + full unit suite

**Files:** (none — verification only)

- [ ] **Step 1: Typecheck the whole project graph.**

Run:

```
npm run typecheck
```

Expected: exits `0` (no errors across `@sentinel/ai` and references).

- [ ] **Step 2: Lint — confirm the driver/`@playwright/test` boundary holds for the new src files.**

Run:

```
npm run lint
```

Expected: exits `0`. `analyze.ts`, `llm/provider.ts`, and `llm/index.ts` import only `@sentinel/core` + intra-package relative paths (no `@playwright/test`, no `playwright`, no `@sentinel/driver-*`); the `no-restricted-imports` boundary is not tripped. `tests/**` retains the test-runner exemption.

- [ ] **Step 3: Run the entire offline unit suite (no browser, no API).**

Run:

```
npm run test:unit
```

Expected: all suites green, including `packages/ai/tests/llm-provider.test.ts` (`2 passed`) and `packages/ai/tests/analyze.test.ts` (`7 passed`). Zero browser launches (no `page` fixture requested), zero network calls.

- [ ] **Step 4: Final B4 commit (no-op if tree clean).**

```
git status --porcelain
```

Expected: empty (all B4 work already committed in Tasks 1–4). If anything is staged, commit with:

```
git commit -m "chore(ai): b4 sub-step gate — typecheck, lint, unit suite green"
```

---

Authored the complete B4 fragment (5 TDD tasks) for `packages/ai/src/llm/provider.ts` + `llm/index.ts` + `analyze.ts`, copied from spec §5.1 / §6 verbatim. Key grounding decisions baked into the fragment, surfaced here for the assembler:

- `TelemetryEvent` is re-exported from the `@sentinel/core` barrel (verified in `packages/core/src/index.ts` → `telemetry/index.ts`), so the spec's `import type { TelemetryEvent } from "@sentinel/core"` resolves as written.
- Tests import `{ test, expect } from "@playwright/test"` and use relative `../src/...` imports (matching every existing `packages/**/tests/*.test.ts`); they are pure/offline and never request the `page` fixture.
- One cross-slice dependency flagged in B4-Task 3 Step 3: the spec-mandated lazy `await import("./llm/claude-provider")` is a forward reference to a B5 file. The offline orchestrator tests never execute it (explicit provider or `null`, no key in CI), but `tsc -b` needs the module to exist — so if B5 lands after B4 in the build order, Task 3 Step 3 supplies a throwaway compile stub that B5 overwrites. This is the only ordering coupling and is called out explicitly.
- The orchestrator never throws on LLM failure: provider rejection and lazy-import/construction failure both route through a `try/catch` that returns rules-only `RunAnalysis` with `llmError`; the absent-key-with-explain auto path sets `llmError: "no ANTHROPIC_API_KEY; rules-only"` exactly as spec §6 dictates.

Relevant absolute paths: `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/llm/provider.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/llm/index.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/analyze.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/tests/llm-provider.test.ts`, `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/tests/analyze.test.ts`.

---

> Sub-step B5 — real Claude provider + redaction/integration tests

This sub-step authors `packages/ai/src/llm/claude-provider.ts` — the single SDK-touching file — implementing `ClaudeProvider implements LlmProvider` with `claude-opus-4-8`, a cached system block, forced `report_run_analysis` tool use, and tool-input parsing into `LlmRunResult` (verdicts stamped `source:"llm"`). It is verified by a redaction-before-send spy test (offline) and an opt-in, key-gated Claude integration test that also asserts prompt-cache usage; the import-audit assertion that the SDK appears only here is owned by B6 and merely referenced.

### B5 — Task 1: redaction-before-send proof (spy provider)

This is the offline, always-running test that proves the orchestrator redacts events before any provider sees them. It uses a spy `LlmProvider` (not the real Claude one), so it needs no key and no SDK — it locks the security contract before we build the real provider.

**Files:**

- Test: `packages/ai/tests/redact-send.test.ts` (Create)

- [ ] **Step 1: Write the failing redaction-before-send test.**

Create `packages/ai/tests/redact-send.test.ts`:

```ts
import { test, expect } from "@playwright/test";
import type { TelemetryEvent } from "@sentinel/core";
import { analyzeRun } from "@sentinel/ai/analyze";
import type {
  AnalysisContext,
  LlmProvider,
  LlmRunResult,
} from "@sentinel/ai/llm/provider";

/** A spy provider: records the events it was handed, returns a canned result. */
class SpyLlmProvider implements LlmProvider {
  public seen: readonly TelemetryEvent[] = [];
  analyze(ctx: AnalysisContext): Promise<LlmRunResult> {
    this.seen = ctx.events;
    return Promise.resolve({ explanation: "spy", adjudications: [] });
  }
}

const PLANTED_SECRET = "super-secret-bearer-value";

function eventsWithPlantedSecret(): TelemetryEvent[] {
  const base = {
    schemaVersion: "1.0.0",
    traceId: "run-redact-1",
    spanId: "span-1",
    name: "auth.login",
    timing: { startWallClockMs: 1, startMonotonicNs: "1" },
  };
  return [
    {
      ...base,
      eventId: "ev-1",
      type: "locator.resolved",
      sequence: 1,
      logicalName: "auth.login.username",
      resolvedKind: "css",
      resolvedRank: 0,
      degraded: false,
      candidates: [{ kind: "css", outcome: "matched", rank: 0 }],
      score: 1,
      resolveDurationMs: 5,
      // planted secret lives on the redactable `attributes` map by KEY
      attributes: { authorization: PLANTED_SECRET, ok: "plain" },
    },
    {
      ...base,
      eventId: "ev-2",
      type: "flow.finished",
      sequence: 2,
      outcome: "success",
      didDegrade: false,
    },
  ] as unknown as TelemetryEvent[];
}

test("orchestrator redacts events before handing them to the provider", async () => {
  const spy = new SpyLlmProvider();

  await analyzeRun(eventsWithPlantedSecret(), {
    provider: spy,
    explain: true,
  });

  const serialized = JSON.stringify(spy.seen);
  expect(serialized).not.toContain(PLANTED_SECRET);
  expect(serialized).toContain("[redacted]");
});
```

Run:

```bash
npm run test:unit -- packages/ai/tests/redact-send.test.ts
```

Expected: the suite runs and FAILS — the assertion shows the spy saw the planted secret (e.g. `Expected substring: not "super-secret-bearer-value"`) because nothing yet proves redaction wiring. (If B4's `analyzeRun` already redacts, this passes immediately; either way it is the regression lock — proceed once it runs.)

- [ ] **Step 2: Confirm the orchestrator wiring satisfies it (no production change expected).**

The redaction itself lives in `redact.ts` (B2) and is invoked by `analyzeRun` (B6 §6 pipeline). If the test FAILED in Step 1 because `analyzeRun` did not yet redact before `provider.analyze`, add the redact call in `packages/ai/src/analyze.ts` at the point where the `AnalysisContext` is built — wrap the events with `redactEvents(...)`:

```ts
// in analyze.ts, where ctx.events is assembled:
import { redactEvents } from "./redact";
// ...
const ctx: AnalysisContext = {
  runId,
  outcome: classification.outcome,
  classification,
  events: redactEvents(events),
};
```

Run:

```bash
npm run test:unit -- packages/ai/tests/redact-send.test.ts
```

Expected: `1 passed`.

- [ ] **Step 3: Typecheck, lint, commit.**

Run:

```bash
npm run typecheck && npm run lint && git add packages/ai/tests/redact-send.test.ts packages/ai/src/analyze.ts && git commit -m "test(ai): prove orchestrator redacts events before provider sees them"
```

Expected: `tsc -b` exits 0, `eslint` exits 0 (the `packages/**/tests/**` exemption permits the `@playwright/test` import), commit succeeds. (If `analyze.ts` was unchanged in Step 2, drop it from `git add`.)

### B5 — Task 2: ClaudeProvider scaffold + cached system prompt (red)

Stand up the real provider file as the single SDK importer, with the static cached system prompt (rubric + telemetry schema + output contract) but a stub `analyze`. We assert the constructor + model + system-prompt constant exist before wiring the API call.

**Files:**

- Create: `packages/ai/src/llm/claude-provider.ts`
- Modify: `packages/ai/package.json` (already has `@anthropic-ai/sdk` from B1 — verify only)
- Test: `packages/ai/tests/claude-provider.test.ts` (Create — offline portion)

- [ ] **Step 1: Verify `@anthropic-ai/sdk` is a dependency and installed.**

Run:

```bash
node -e "console.log(require('/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/package.json').dependencies['@anthropic-ai/sdk'])" && ls /Users/zeeshan.amjad/Documents/sentinel-e2e/node_modules/@anthropic-ai/sdk/package.json
```

Expected: prints `^0.100.1` and lists the SDK `package.json` path. (If missing, `npm install` at the repo root first — B1 declared the dep.)

- [ ] **Step 2: Write the offline scaffold test (red).**

Create `packages/ai/tests/claude-provider.test.ts`:

```ts
import { test, expect } from "@playwright/test";
import { ClaudeProvider, CLAUDE_MODEL } from "@sentinel/ai/llm/claude-provider";

test("ClaudeProvider pins claude-opus-4-8 and constructs from an explicit key", () => {
  expect(CLAUDE_MODEL).toBe("claude-opus-4-8");
  const provider = new ClaudeProvider({ apiKey: "test-key-not-used" });
  expect(provider).toBeInstanceOf(ClaudeProvider);
});

test("ClaudeProvider throws a clear error when no key is available", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    expect(() => new ClaudeProvider()).toThrow(/ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});
```

Run:

```bash
npm run test:unit -- packages/ai/tests/claude-provider.test.ts
```

Expected: FAILS to resolve the module — `Cannot find module '@sentinel/ai/llm/claude-provider'` (the file does not exist yet).

- [ ] **Step 3: Create the provider with the cached system prompt and a stub `analyze`.**

Create `packages/ai/src/llm/claude-provider.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { LlmProvider, AnalysisContext, LlmRunResult } from "./provider";

/** Locked model for the AI run-analyzer (spec D-3 / §5.2). */
export const CLAUDE_MODEL = "claude-opus-4-8" as const;

/** The forced structured-output tool name (spec §5.2). */
export const REPORT_TOOL_NAME = "report_run_analysis" as const;

export interface ClaudeProviderOptions {
  /** Falls back to process.env.ANTHROPIC_API_KEY when omitted. */
  readonly apiKey?: string;
  /** Cost ceiling for the single analysis call. */
  readonly maxTokens?: number;
}

/**
 * The static classification rubric + telemetry-event schema + output contract.
 * This is the large, STABLE prefix sent as a cached system block so repeated
 * runs reuse it (spec §5.2 — prompt caching mandatory). Keep this byte-stable:
 * no timestamps, no per-run data — those go in the user message.
 */
export const SYSTEM_PROMPT = `You are the Sentinel run-analyzer's explanation and adjudication layer.

A deterministic rule engine has ALREADY classified an end-to-end test run from its
structured telemetry. Your job is NOT to re-classify. Your job is to:
  1. Write a concise, plain-language explanation of what happened in the run,
     referencing the deterministic verdicts you are given.
  2. Adjudicate ONLY the verdicts the rules marked "indeterminate": assign each a
     concrete VerdictKind with a one-line reason grounded in the telemetry.
  3. NEVER override or contradict a high-confidence rule verdict.

VerdictKind values (use EXACTLY these strings):
  - "real-bug"          the app behaved wrong with a stable, most-durable locator.
  - "infra-flake"       transient failure: retry-then-pass, or a retryable timeout/session loss.
  - "selector-drift"    a locator degraded to a fallback, or was not-found / ambiguous.
  - "healthy"           success with no degradation.
  - "business-outcome"  an expected domain result (e.g. INVALID_CREDENTIALS) — NOT a defect.
  - "indeterminate"     only if you genuinely cannot adjudicate from the evidence.

Telemetry event types you may see (driver-agnostic; already REDACTED):
  - locator.resolved {logicalName, resolvedKind, resolvedRank, degraded, candidates[]}
      resolvedRank>0 or degraded:true => the durable locator missed and a fallback won.
  - assertion {state, matched, locatorRank, branchProgress[]}
      matched:false && locatorRank===0 && no prior retry => a real defect signal.
  - retry {attempt, maxAttempts, reason, previousOutcome}
  - business.failure {domainReason}   the run mechanically succeeded; the domain said no.
  - system.failure {errorKind, message, retryable, artifactRefs[]}
  - flow.finished {outcome, terminalReason, didDegrade}

Output contract: you MUST call the tool "report_run_analysis" exactly once. Do not
write free-text JSON. Provide:
  - explanation: a short paragraph (no markdown headers).
  - adjudications: one entry per INDETERMINATE verdict you resolved, each with the
    matching logicalName and/or eventId and a verdict object whose kind is one of the
    VerdictKind strings above, a confidence in [0,1], a one-line summary, and an
    evidence array. Return an empty adjudications array if there were none.`;

/** JSON Schema for the forced tool input — mirrors LlmRunResult (spec §5.1). */
export const REPORT_TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["explanation", "adjudications"],
  properties: {
    explanation: { type: "string" },
    adjudications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["verdict"],
        properties: {
          logicalName: { type: "string" },
          eventId: { type: "string" },
          verdict: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "confidence", "summary", "evidence"],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "real-bug",
                  "infra-flake",
                  "selector-drift",
                  "healthy",
                  "business-outcome",
                  "indeterminate",
                ],
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              summary: { type: "string" },
              logicalName: { type: "string" },
              evidence: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["eventId", "type", "detail"],
                  properties: {
                    eventId: { type: "string" },
                    type: { type: "string" },
                    detail: { type: "string" },
                    fields: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export class ClaudeProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: ClaudeProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        "ClaudeProvider requires an ANTHROPIC_API_KEY (pass apiKey or set the env var).",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.maxTokens = options.maxTokens ?? 1024;
  }

  analyze(_ctx: AnalysisContext): Promise<LlmRunResult> {
    return Promise.reject(new Error("not implemented"));
  }
}
```

Run:

```bash
npm run test:unit -- packages/ai/tests/claude-provider.test.ts
```

Expected: `2 passed` (constructor pins the model and validates the key; the stub `analyze` is not yet called).

- [ ] **Step 4: Typecheck, lint, commit.**

Run:

```bash
npm run typecheck && npm run lint && git add packages/ai/src/llm/claude-provider.ts packages/ai/tests/claude-provider.test.ts && git commit -m "feat(ai): scaffold ClaudeProvider with cached system prompt and tool schema"
```

Expected: `tsc -b` exits 0, `eslint` exits 0 (the `@anthropic-ai/sdk` import is allowed in this file; the new driver-ban for `packages/ai/**` does not touch the SDK), commit succeeds.

### B5 — Task 3: implement `analyze()` — cached system block, forced tool, parse to LlmRunResult

Wire the real `messages.create` call: model `claude-opus-4-8`, the cached system block, the per-run redacted classification + events as the user message, the forced `report_run_analysis` tool, then narrow the `tool_use` block from `response.content` and parse its `input` into `LlmRunResult`, stamping every adjudication verdict with `source:"llm"`.

**Files:**

- Modify: `packages/ai/src/llm/claude-provider.ts`

- [ ] **Step 1: Implement `analyze()` and the user-message builder.**

In `packages/ai/src/llm/claude-provider.ts`, replace the stub `analyze` and add the helper + imports. First update the imports at the top of the file:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmProvider,
  AnalysisContext,
  LlmRunResult,
  LlmAdjudication,
} from "./provider";
import type { Verdict, VerdictKind } from "../verdict";
```

Then replace the stub method:

```ts
  async analyze(ctx: AnalysisContext): Promise<LlmRunResult> {
    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: this.maxTokens,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildUserMessage(ctx) }],
      tools: [
        {
          name: REPORT_TOOL_NAME,
          description:
            "Report the plain-language run explanation and adjudications for the indeterminate verdicts.",
          input_schema: REPORT_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === REPORT_TOOL_NAME,
    );
    if (toolUse === undefined) {
      throw new Error(
        `ClaudeProvider: model did not call ${REPORT_TOOL_NAME} (stop_reason=${response.stop_reason}).`,
      );
    }
    return parseToolInput(toolUse.input);
  }
}

/** Build the small, VARIABLE per-run user message (after the cached prefix). */
function buildUserMessage(ctx: AnalysisContext): string {
  return [
    `runId: ${ctx.runId}`,
    `outcome: ${ctx.outcome}`,
    "deterministic classification (verdicts the rules already decided):",
    JSON.stringify(ctx.classification.verdicts),
    "indeterminate verdicts to adjudicate:",
    JSON.stringify(ctx.classification.indeterminate),
    "redacted telemetry events:",
    JSON.stringify(ctx.events),
  ].join("\n");
}

const VERDICT_KINDS: readonly VerdictKind[] = [
  "real-bug",
  "infra-flake",
  "selector-drift",
  "healthy",
  "business-outcome",
  "indeterminate",
];

/** Parse + validate the tool input into an LlmRunResult; stamp source:"llm". */
function parseToolInput(input: unknown): LlmRunResult {
  if (typeof input !== "object" || input === null) {
    throw new Error("ClaudeProvider: tool input was not an object.");
  }
  const obj = input as Record<string, unknown>;
  const explanation = obj.explanation;
  if (typeof explanation !== "string") {
    throw new Error("ClaudeProvider: tool input missing string 'explanation'.");
  }
  const rawAdjs = Array.isArray(obj.adjudications) ? obj.adjudications : [];
  const adjudications: LlmAdjudication[] = rawAdjs.map((raw) =>
    parseAdjudication(raw),
  );
  return { explanation, adjudications };
}

function parseAdjudication(raw: unknown): LlmAdjudication {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("ClaudeProvider: adjudication entry was not an object.");
  }
  const obj = raw as Record<string, unknown>;
  const v =
    typeof obj.verdict === "object" && obj.verdict !== null
      ? (obj.verdict as Record<string, unknown>)
      : undefined;
  if (v === undefined) {
    throw new Error("ClaudeProvider: adjudication missing 'verdict'.");
  }
  const kind = v.kind;
  if (typeof kind !== "string" || !VERDICT_KINDS.includes(kind as VerdictKind)) {
    throw new Error(`ClaudeProvider: invalid verdict kind '${String(kind)}'.`);
  }
  const verdict: Verdict = {
    kind: kind as VerdictKind,
    confidence: typeof v.confidence === "number" ? v.confidence : 0,
    summary: typeof v.summary === "string" ? v.summary : "",
    evidence: Array.isArray(v.evidence)
      ? (v.evidence as Verdict["evidence"])
      : [],
    ...(typeof v.logicalName === "string"
      ? { logicalName: v.logicalName }
      : {}),
    source: "llm",
  };
  return {
    ...(typeof obj.logicalName === "string"
      ? { logicalName: obj.logicalName }
      : {}),
    ...(typeof obj.eventId === "string" ? { eventId: obj.eventId } : {}),
    verdict,
  };
}
```

Note: the closing `}` of the class is now provided by the `analyze()` block above; ensure the file has exactly one trailing class brace (delete the old stub's brace if duplicated). The exact SDK call shape (`system` cached block, `tools[].input_schema`, `tool_choice`, reading `tool_use` from `response.content`, and `response.usage.cache_*`) was verified against the `claude-api` skill (TypeScript Claude API + tool-use docs). At implement-time, re-confirm `@anthropic-ai/sdk@^0.100.1` exposes `Anthropic.Tool.InputSchema` / `Anthropic.ToolUseBlock`; if the type path drifted, consult the `claude-api` skill or context7 for `@anthropic-ai/sdk` and correct the annotation (the runtime shape is stable).

- [ ] **Step 2: Typecheck and lint (no new offline test — `analyze` is exercised by the integration test in Task 4).**

Run:

```bash
npm run typecheck && npm run lint
```

Expected: both exit 0. The existing `claude-provider.test.ts` still passes (`npm run test:unit -- packages/ai/tests/claude-provider.test.ts` → `2 passed`) since `analyze` is not invoked offline.

- [ ] **Step 3: Commit.**

Run:

```bash
git add packages/ai/src/llm/claude-provider.ts && git commit -m "feat(ai): implement ClaudeProvider.analyze with prompt caching and forced tool use"
```

Expected: commit succeeds.

### B5 — Task 4: opt-in, key-gated Claude integration test (asserts prompt-cache usage)

Add the cost-bounded real-API test that runs only when `ANTHROPIC_API_KEY` is set (and is cleanly skipped otherwise). It calls `analyze()` on a small `AnalysisContext`, asserts a non-empty `explanation` + well-formed adjudications, and asserts prompt-cache usage appears in the SDK response.

**Files:**

- Modify: `packages/ai/tests/claude-provider.test.ts` (append the guarded integration test)

Note on file extension: the unit runner's `testMatch` is `packages/**/tests/**/*.test.ts`, so a `.itest.ts` file would NOT be collected. We therefore guard the integration test inside the existing `.test.ts` with `test.skip` (spec §10 / §12.5 allow either; this keeps it inside the runner and skipped by default).

- [ ] **Step 1: Append the key-gated integration test, capturing usage via a one-call hook.**

The `analyze()` method returns only `LlmRunResult`, so to assert cache usage the test makes its own minimal SDK call mirroring the provider's request (same cached system block) and checks `response.usage`, then separately asserts `analyze()` returns a well-formed result. Append to `packages/ai/tests/claude-provider.test.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { TelemetryEvent } from "@sentinel/core";
import type { AnalysisContext } from "@sentinel/ai/llm/provider";
import {
  SYSTEM_PROMPT,
  CLAUDE_MODEL,
  REPORT_TOOL_NAME,
  REPORT_TOOL_INPUT_SCHEMA,
} from "@sentinel/ai/llm/claude-provider";

const runItest = process.env.ANTHROPIC_API_KEY ? test : test.skip;

function sampleContext(): AnalysisContext {
  const events: TelemetryEvent[] = [
    {
      schemaVersion: "1.0.0",
      eventId: "ev-1",
      type: "flow.finished",
      traceId: "run-itest-1",
      spanId: "span-1",
      sequence: 1,
      name: "auth.login",
      timing: { startWallClockMs: 1, startMonotonicNs: "1" },
      outcome: "system-failure",
      didDegrade: false,
    } as unknown as TelemetryEvent,
  ];
  return {
    runId: "run-itest-1",
    outcome: "system-failure",
    classification: {
      runId: "run-itest-1",
      outcome: "system-failure",
      degraded: false,
      verdicts: [],
      indeterminate: [
        {
          kind: "indeterminate",
          confidence: 0,
          summary: "flow.finished system-failure with no pinned cause",
          evidence: [
            {
              eventId: "ev-1",
              type: "flow.finished",
              detail: "system-failure terminal with no matching rule",
            },
          ],
          source: "rule",
        },
      ],
    },
    events,
  };
}

runItest(
  "real ClaudeProvider returns a well-formed result and uses prompt caching",
  async () => {
    const { ClaudeProvider } = await import("@sentinel/ai/llm/claude-provider");
    const provider = new ClaudeProvider({ maxTokens: 512 });

    const result = await provider.analyze(sampleContext());
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(Array.isArray(result.adjudications)).toBe(true);
    for (const adj of result.adjudications) {
      expect(typeof adj.verdict.kind).toBe("string");
      expect(adj.verdict.source).toBe("llm");
    }

    // Second, independent call mirroring the provider request to inspect usage.
    const client = new Anthropic();
    const raw = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "runId: cache-probe\noutcome: success" },
      ],
      tools: [
        {
          name: REPORT_TOOL_NAME,
          description: "Report the run analysis.",
          input_schema:
            REPORT_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
    });
    const cacheCreate = raw.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = raw.usage.cache_read_input_tokens ?? 0;
    expect(cacheCreate + cacheRead).toBeGreaterThan(0);
  },
);
```

Run (without a key — default CI path):

```bash
npm run test:unit -- packages/ai/tests/claude-provider.test.ts
```

Expected: `2 passed`, `1 skipped` (the offline scaffold tests pass; the integration test is skipped because `ANTHROPIC_API_KEY` is unset).

- [ ] **Step 2: Run the opt-in path locally to confirm it passes when a key is present (cost-bounded).**

Run (only if you have a key; makes two small real calls):

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" npm run test:unit -- packages/ai/tests/claude-provider.test.ts
```

Expected: `3 passed` — the integration test runs, `explanation` is non-empty, every adjudication verdict carries `source:"llm"`, and `cache_creation_input_tokens + cache_read_input_tokens > 0` proving the system block was cached. (If only `cache_creation` is non-zero on the first run of a fresh prefix, the assertion still holds; a repeat run shows `cache_read`.)

- [ ] **Step 3: Typecheck, lint, commit.**

Run:

```bash
npm run typecheck && npm run lint && git add packages/ai/tests/claude-provider.test.ts && git commit -m "test(ai): add opt-in key-gated claude integration test asserting prompt caching"
```

Expected: `tsc -b` exits 0, `eslint` exits 0 (the test dir is exempt from the import bans, so importing `@anthropic-ai/sdk` and `@playwright/test` here is allowed), commit succeeds.

---

Authoring notes (grounding facts the implementing engineer must keep):

- Verified telemetry shape at `packages/core/src/telemetry/{event,signals}.ts` and `SystemFailureKind` at `packages/core/src/errors/system-failure-error.ts` (`timeout | selector-not-found | selector-ambiguous | driver-session | assertion-infrastructure`) — the synthetic events in the tests use only real fields. `startMonotonicNs` is a `bigint` in the type but arrives as a string in JSONL; tests pass it as a string cast through `as unknown as TelemetryEvent`, matching B2's load/revive decision.
- The unit runner config `playwright.unit.config.ts` `testMatch` is `packages/**/tests/**/*.test.ts` only — a `claude-provider.itest.ts` would not be collected, so the integration test lives in `claude-provider.test.ts` guarded by `process.env.ANTHROPIC_API_KEY ? test : test.skip`.
- The eslint exemption block already covers `packages/**/tests/**` (`no-restricted-imports: off`), so test files may import `@playwright/test` and `@anthropic-ai/sdk`. B1 must (a) add `@anthropic-ai/sdk` to the `packages/ai/**` driver-ban allowance for `src/llm/claude-provider.ts` only, and (b) ban `@sentinel/driver-*` from `packages/ai/**` — neither touches the SDK import in the provider file. The import-audit assertion (SDK appears only in `claude-provider.ts`) is owned by B6 per the global conventions.
- SDK call shape verified against the `claude-api` skill (TS Claude API + tool-use docs): `client.messages.create({ model, max_tokens, system:[{type:"text",text,cache_control:{type:"ephemeral"}}], messages, tools:[{name,description,input_schema}], tool_choice:{type:"tool",name} })`, read the `tool_use` block via `response.content.find(b => b.type==="tool_use")`, and `response.usage.cache_creation_input_tokens` / `cache_read_input_tokens`. The skill's default model is `claude-opus-4-7`, but spec D-3 locks `claude-opus-4-8` — the spec wins. Re-confirm `Anthropic.Tool.InputSchema` / `Anthropic.ToolUseBlock` type paths against `@anthropic-ai/sdk@^0.100.1` at implement-time (runtime shape is stable; only the TS type-path annotation might drift).

---

> Sub-step B6 — render + CLI + fixture + e2e + acceptance
> This sub-step adds the human/JSON renderers (`render.ts`), the `sentinel-analyze` CLI (`cli.ts`, exit 1 iff a `real-bug` verdict exists), the public barrel (`index.ts`, ClaudeProvider deliberately excluded to keep the SDK lazy), a committed degraded-invalid JSONL fixture, the end-to-end test on that fixture, and the final §11 acceptance gate. The CLI runs compiled JS (`node packages/ai/dist/cli.js`) because the repo has no `tsx`/`ts-node`; the root `analyze` script does `tsc -b` first to emit `dist/`.

### B6 — Task 1: `render.ts` — `toJson` + `toText`

**Files:**

- Test: `packages/ai/tests/render.test.ts`
- Create: `packages/ai/src/render.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/ai/tests/render.test.ts
import { test, expect } from "@playwright/test";
import type { RunAnalysis } from "../src/analysis";
import { ANALYSIS_SCHEMA_VERSION } from "../src/analysis";
import { toJson, toText } from "../src/render";

function sample(overrides: Partial<RunAnalysis> = {}): RunAnalysis {
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    runId: "trace-1",
    outcome: "business-failure",
    verdicts: [
      {
        kind: "business-outcome",
        confidence: 1,
        summary: "domain returned INVALID_CREDENTIALS",
        evidence: [],
        source: "rule",
      },
      {
        kind: "selector-drift",
        confidence: 0.9,
        summary: "auth.login.username degraded to rank 6",
        evidence: [],
        logicalName: "auth.login.username",
        source: "rule",
      },
    ],
    usedLlm: false,
    ...overrides,
  };
}

test("toJson round-trips a stable, indented RunAnalysis", () => {
  const json = toJson(sample());
  expect(json.endsWith("\n")).toBe(false);
  const parsed = JSON.parse(json) as RunAnalysis;
  expect(parsed.runId).toBe("trace-1");
  expect(parsed.outcome).toBe("business-failure");
  expect(parsed.verdicts).toHaveLength(2);
  expect(json).toContain('  "schemaVersion"'); // 2-space indent
});

test("toText renders outcome, runId and each verdict line", () => {
  const text = toText(sample());
  expect(text).toContain("Run trace-1");
  expect(text).toContain("Outcome: business-failure");
  expect(text).toContain("business-outcome");
  expect(text).toContain("conf 1.00");
  expect(text).toContain("domain returned INVALID_CREDENTIALS");
  expect(text).toContain("selector-drift");
  expect(text).toContain("[auth.login.username]");
});

test("toText includes the explanation when present", () => {
  const text = toText(
    sample({
      usedLlm: true,
      explanation: "The login was rejected by the app.",
    }),
  );
  expect(text).toContain("Explanation:");
  expect(text).toContain("The login was rejected by the app.");
});

test("toText shows an llmError degradation note and omits the explanation block", () => {
  const text = toText(sample({ llmError: "no ANTHROPIC_API_KEY; rules-only" }));
  expect(text).toContain("LLM: skipped (no ANTHROPIC_API_KEY; rules-only)");
  expect(text).not.toContain("Explanation:");
});
```

Run:

```
npm run test:unit -- packages/ai/tests/render.test.ts
```

Expected: FAIL — `Cannot find module '../src/render'` (file does not exist yet).

- [ ] **Step 2: Implement `render.ts`.**

```ts
// packages/ai/src/render.ts
import type { RunAnalysis } from "./analysis";
import type { Verdict } from "./verdict";

/** The machine artifact: pretty-printed, no trailing newline. */
export function toJson(analysis: RunAnalysis): string {
  return JSON.stringify(analysis, null, 2);
}

function renderVerdict(v: Verdict): string {
  const tag = v.logicalName ? ` [${v.logicalName}]` : "";
  const conf = v.confidence.toFixed(2);
  return `  - ${v.kind} (conf ${conf}, ${v.source})${tag}: ${v.summary}`;
}

/** Human-readable terminal/markdown summary derived from the RunAnalysis. */
export function toText(analysis: RunAnalysis): string {
  const lines: string[] = [];
  lines.push(`Run ${analysis.runId}`);
  lines.push(`Outcome: ${analysis.outcome}`);
  if (analysis.verdicts.length === 0) {
    lines.push("Verdicts: (none)");
  } else {
    lines.push("Verdicts:");
    for (const v of analysis.verdicts) {
      lines.push(renderVerdict(v));
    }
  }
  if (analysis.explanation !== undefined) {
    lines.push("");
    lines.push("Explanation:");
    lines.push(analysis.explanation);
  }
  if (analysis.llmError !== undefined) {
    lines.push("");
    lines.push(`LLM: skipped (${analysis.llmError})`);
  }
  return lines.join("\n");
}
```

Run:

```
npm run test:unit -- packages/ai/tests/render.test.ts
```

Expected: PASS — 4 passed.

- [ ] **Step 3: Typecheck + commit.**

Run:

```
npm run typecheck && git add packages/ai/src/render.ts packages/ai/tests/render.test.ts && git commit -m "feat(ai): render run analysis to json and human text"
```

Expected: `tsc -b` exits 0; commit created (commitlint passes — lowercase conventional subject).

---

### B6 — Task 2: public barrel `index.ts` (SDK kept lazy)

**Files:**

- Test: `packages/ai/tests/barrel.test.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write the failing test.** Asserts the public surface is exported and `ClaudeProvider` is NOT re-exported (so importing the barrel never pulls the SDK).

```ts
// packages/ai/tests/barrel.test.ts
import { test, expect } from "@playwright/test";
import * as ai from "../src/index";

test("barrel exports the deterministic public surface", () => {
  const surface = ai as Record<string, unknown>;
  expect(typeof surface.analyzeRun).toBe("function");
  expect(typeof surface.classify).toBe("function");
  expect(typeof surface.toJson).toBe("function");
  expect(typeof surface.toText).toBe("function");
  expect(typeof surface.redactEvents).toBe("function");
  expect(typeof surface.loadEvents).toBe("function");
  expect(typeof surface.FakeLlmProvider).toBe("function");
  expect(surface.ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
});

test("barrel does NOT re-export ClaudeProvider (keeps the SDK lazy)", () => {
  const surface = ai as Record<string, unknown>;
  expect(surface.ClaudeProvider).toBeUndefined();
});
```

Run:

```
npm run test:unit -- packages/ai/tests/barrel.test.ts
```

Expected: FAIL — `analyzeRun`/`toJson`/`toText` are `undefined` (barrel does not yet export render or the full surface).

- [ ] **Step 2: Update the barrel.** Replace whatever the skeleton/prior slices left (e.g. `export {}` or partial exports) with the full deterministic surface. `claude-provider.ts` is intentionally NOT exported.

```ts
// packages/ai/src/index.ts
export type { VerdictKind, Verdict, Evidence } from "./verdict";
export type { RunOutcome, RunClassification, RunAnalysis } from "./analysis";
export { ANALYSIS_SCHEMA_VERSION } from "./analysis";
export { loadEvents } from "./load";
export { redactEvents } from "./redact";
export { classify } from "./classify";
export type {
  AnalysisContext,
  LlmAdjudication,
  LlmRunResult,
  LlmProvider,
} from "./llm/provider";
export { FakeLlmProvider } from "./llm/provider";
export type { AnalyzeOptions } from "./analyze";
export { analyzeRun } from "./analyze";
export { toJson, toText } from "./render";
// NOTE: ClaudeProvider is deliberately NOT re-exported here. It is the only
// importer of @anthropic-ai/sdk; keeping it out of the barrel keeps the SDK
// lazy (imported only when llm/claude-provider.ts is imported directly by the
// orchestrator's auto-resolution path).
```

> Adjust the named exports above ONLY if a prior slice used a different export name (e.g. `loadEvents`/`classify`/`redactEvents`). The names here match the symbols defined in B2–B4 (`loadEvents` from `load.ts`, `redactEvents` from `redact.ts`, `classify` from `classify/index.ts`, `FakeLlmProvider` from `llm/provider.ts`). Confirm against those files before editing.

Run:

```
npm run test:unit -- packages/ai/tests/barrel.test.ts
```

Expected: PASS — 2 passed.

- [ ] **Step 3: Typecheck + commit.**

Run:

```
npm run typecheck && git add packages/ai/src/index.ts packages/ai/tests/barrel.test.ts && git commit -m "feat(ai): export public surface from barrel, keep sdk lazy"
```

Expected: `tsc -b` exits 0; commit created.

---

### B6 — Task 3: commit the degraded-invalid JSONL fixture

**Files:**

- Create: `packages/ai/tests/fixtures/invalid-run.jsonl`

This mirrors the real degraded-invalid auth sample: one `flow.started`, two `locator.resolved` (`resolvedRank:6, degraded:true` for `auth.login.username`/`auth.login.password`), an `assertion`, a `business.failure` (`domainReason:"INVALID_CREDENTIALS"`), and a `flow.finished` (`outcome:"business-failure", didDegrade:true`). All share `traceId "trace-invalid-1"`; every line carries valid envelope fields (`schemaVersion "1.0.0"`, monotonic `sequence`, `timing.startMonotonicNs` as a STRING per spec §13 Q3). `test-results/` is gitignored, so this small representative fixture is committed under `tests/fixtures`.

- [ ] **Step 1: Create the fixture (one JSON object per line, no trailing blank line).**

```jsonl
{"schemaVersion":"1.0.0","eventId":"ev-1","type":"flow.started","traceId":"trace-invalid-1","spanId":"sp-flow","sequence":1,"name":"auth.login","status":"unset","timing":{"startWallClockMs":1717322400000,"startMonotonicNs":"1000"}}
{"schemaVersion":"1.0.0","eventId":"ev-2","type":"locator.resolved","traceId":"trace-invalid-1","spanId":"sp-user","parentSpanId":"sp-flow","sequence":2,"name":"auth.login.username","status":"ok","timing":{"startWallClockMs":1717322400010,"startMonotonicNs":"2000"},"logicalName":"auth.login.username","resolvedKind":"css","resolvedRank":6,"degraded":true,"candidates":[{"kind":"label","outcome":"missed","rank":0},{"kind":"role","outcome":"missed","rank":1},{"kind":"placeholder","outcome":"missed","rank":2},{"kind":"testid","outcome":"missed","rank":3},{"kind":"name","outcome":"missed","rank":4},{"kind":"text","outcome":"missed","rank":5},{"kind":"css","outcome":"matched","rank":6}],"score":0.4,"resolveDurationMs":12}
{"schemaVersion":"1.0.0","eventId":"ev-3","type":"locator.resolved","traceId":"trace-invalid-1","spanId":"sp-pass","parentSpanId":"sp-flow","sequence":3,"name":"auth.login.password","status":"ok","timing":{"startWallClockMs":1717322400020,"startMonotonicNs":"3000"},"logicalName":"auth.login.password","resolvedKind":"css","resolvedRank":6,"degraded":true,"candidates":[{"kind":"label","outcome":"missed","rank":0},{"kind":"role","outcome":"missed","rank":1},{"kind":"placeholder","outcome":"missed","rank":2},{"kind":"testid","outcome":"missed","rank":3},{"kind":"name","outcome":"missed","rank":4},{"kind":"text","outcome":"missed","rank":5},{"kind":"css","outcome":"matched","rank":6}],"score":0.4,"resolveDurationMs":11}
{"schemaVersion":"1.0.0","eventId":"ev-4","type":"assertion","traceId":"trace-invalid-1","spanId":"sp-assert","parentSpanId":"sp-flow","sequence":4,"name":"auth.login.errorBanner","status":"ok","timing":{"startWallClockMs":1717322400030,"startMonotonicNs":"4000"},"state":"visible","matched":true,"locatorRank":0}
{"schemaVersion":"1.0.0","eventId":"ev-5","type":"business.failure","traceId":"trace-invalid-1","spanId":"sp-biz","parentSpanId":"sp-flow","sequence":5,"name":"auth.login","status":"ok","timing":{"startWallClockMs":1717322400040,"startMonotonicNs":"5000"},"domainReason":"INVALID_CREDENTIALS"}
{"schemaVersion":"1.0.0","eventId":"ev-6","type":"flow.finished","traceId":"trace-invalid-1","spanId":"sp-flow","sequence":6,"name":"auth.login","status":"ok","timing":{"startWallClockMs":1717322400050,"startMonotonicNs":"6000"},"outcome":"business-failure","terminalReason":"INVALID_CREDENTIALS","didDegrade":true}
```

- [ ] **Step 2: Sanity-check the fixture is valid JSONL (every line parses).**

Run:

```
node -e "const fs=require('fs');const n=fs.readFileSync('packages/ai/tests/fixtures/invalid-run.jsonl','utf8').trim().split('\n');n.forEach(l=>JSON.parse(l));console.log('lines',n.length)"
```

Expected: `lines 6`

- [ ] **Step 3: Commit.**

Run:

```
git add packages/ai/tests/fixtures/invalid-run.jsonl && git commit -m "test(ai): add degraded-invalid run jsonl fixture"
```

Expected: commit created.

---

### B6 — Task 4: end-to-end test on the real fixture

**Files:**

- Create: `packages/ai/tests/e2e.test.ts`

- [ ] **Step 1: Write the failing test.** Drives the orchestrator with `provider:null` (forced rules-only) over the committed JSONL path and asserts the spec §10 end-to-end expectations.

```ts
// packages/ai/tests/e2e.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { analyzeRun } from "../src/analyze";
import type { Verdict } from "../src/verdict";

const FIXTURE = path.join(__dirname, "fixtures", "invalid-run.jsonl");

test("analyzeRun classifies the degraded-invalid auth run (rules-only)", async () => {
  const analysis = await analyzeRun(FIXTURE, { provider: null });

  expect(analysis.runId).toBe("trace-invalid-1");
  expect(analysis.outcome).toBe("business-failure");
  expect(analysis.usedLlm).toBe(false);

  const business = analysis.verdicts.filter(
    (v: Verdict) => v.kind === "business-outcome",
  );
  expect(business).toHaveLength(1);
  expect(
    business[0]?.evidence.some(
      (e) => e.fields?.domainReason === "INVALID_CREDENTIALS",
    ),
  ).toBe(true);

  const drift = analysis.verdicts.filter(
    (v: Verdict) => v.kind === "selector-drift",
  );
  expect(drift).toHaveLength(2);
  const driftNames = drift.map((v) => v.logicalName).sort();
  expect(driftNames).toEqual(["auth.login.password", "auth.login.username"]);

  // no real-bug present -> CLI must exit 0 (covered by the CLI task)
  expect(analysis.verdicts.some((v: Verdict) => v.kind === "real-bug")).toBe(
    false,
  );
});
```

> The `domainReason` evidence assertion above assumes the B3 `business-outcome` verdict attaches `domainReason` in `evidence[].fields.domainReason` (spec §3.1 `Evidence.fields` + §4.5). If B3 instead surfaces it only in `summary`, relax this line to `expect(business[0]?.summary).toContain("INVALID_CREDENTIALS")`. Confirm against `classify/rules.ts` before finalizing.

Run:

```
npm run test:unit -- packages/ai/tests/e2e.test.ts
```

Expected: PASS — 1 passed (the orchestrator + rules from B3/B4 already implement this; this test wires them to the committed fixture). If it FAILS, the failure pinpoints a real B3/B4 gap (e.g. drift not emitted on a business-failure run) to fix before continuing.

- [ ] **Step 2: Commit.**

Run:

```
git add packages/ai/tests/e2e.test.ts && git commit -m "test(ai): end-to-end analysis of degraded-invalid run fixture"
```

Expected: commit created.

---

### B6 — Task 5: `cli.ts` — `sentinel-analyze <path> [--json]`, exit 1 iff a real-bug

**Files:**

- Test: `packages/ai/tests/cli.test.ts`
- Create: `packages/ai/src/cli.ts`

The CLI is unit-tested as a pure function (`runCli(argv): Promise<{ output; exitCode }>`) so the test stays offline and makes no process exit. The `#!`-headed entry calls it and maps the result to `process.stdout`/`process.exitCode`. Exit code is `1` IFF any `verdict.kind === "real-bug"`, else `0`.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/ai/tests/cli.test.ts
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { runCli } from "../src/cli";

const FIXTURE = path.join(__dirname, "fixtures", "invalid-run.jsonl");

test("runCli prints human text and exits 0 on a business-outcome run", async () => {
  const res = await runCli([FIXTURE]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("Run trace-invalid-1");
  expect(res.output).toContain("Outcome: business-failure");
  expect(res.output).toContain("business-outcome");
  expect(res.output).toContain("selector-drift");
});

test("runCli --json prints parseable JSON and exits 0", async () => {
  const res = await runCli([FIXTURE, "--json"]);
  expect(res.exitCode).toBe(0);
  const parsed = JSON.parse(res.output) as { runId: string; outcome: string };
  expect(parsed.runId).toBe("trace-invalid-1");
  expect(parsed.outcome).toBe("business-failure");
});

test("runCli errors (exit 2) when no path argument is given", async () => {
  const res = await runCli([]);
  expect(res.exitCode).toBe(2);
  expect(res.output.toLowerCase()).toContain("usage");
});
```

Run:

```
npm run test:unit -- packages/ai/tests/cli.test.ts
```

Expected: FAIL — `Cannot find module '../src/cli'`.

- [ ] **Step 2: Implement `cli.ts`.** `runCli` is forced rules-only (`provider: null`) so the CLI stays deterministic/offline by default; the orchestrator's auto path (real Claude when a key is present) is exercised only by the B5 integration test, not the CLI unit test.

```ts
// packages/ai/src/cli.ts
import { analyzeRun } from "./analyze";
import { toJson, toText } from "./render";
import type { Verdict } from "./verdict";

export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

const USAGE = "usage: sentinel-analyze <path-to-jsonl> [--json]";

export async function runCli(argv: readonly string[]): Promise<CliResult> {
  const args = argv.filter((a) => a !== "--json");
  const asJson = argv.includes("--json");
  const pathArg = args[0];
  if (pathArg === undefined) {
    return { output: USAGE, exitCode: 2 };
  }

  const analysis = await analyzeRun(pathArg, { provider: null });
  const output = asJson ? toJson(analysis) : toText(analysis);
  const hasRealBug = analysis.verdicts.some(
    (v: Verdict) => v.kind === "real-bug",
  );
  return { output, exitCode: hasRealBug ? 1 : 0 };
}

/* istanbul ignore next -- thin process shim, exercised via the `analyze` script */
async function main(): Promise<void> {
  const res = await runCli(process.argv.slice(2));
  process.stdout.write(res.output + "\n");
  process.exitCode = res.exitCode;
}

if (require.main === module) {
  void main();
}
```

> The `#!/usr/bin/env node` shebang is intentionally omitted from the source: this is a CommonJS `.ts` compiled to `dist/cli.js` and invoked via `node packages/ai/dist/cli.js` (the root `analyze` script in Task 6), not as a chmod'd executable. The `bin` field in `package.json` (added in Task 6) points at the compiled `dist/cli.js`.

Run:

```
npm run test:unit -- packages/ai/tests/cli.test.ts
```

Expected: PASS — 3 passed.

- [ ] **Step 3: Typecheck + commit.**

Run:

```
npm run typecheck && git add packages/ai/src/cli.ts packages/ai/tests/cli.test.ts && git commit -m "feat(ai): sentinel-analyze cli with real-bug exit code"
```

Expected: `tsc -b` exits 0; commit created.

---

### B6 — Task 6: wire the `analyze` script + `bin` (compiled entry)

**Files:**

- Modify: `package.json` (root — add `analyze` script)
- Modify: `packages/ai/package.json` (add `bin`)

Decision (stated): the repo has no `tsx`/`ts-node`, and every package's `main` points at raw `src/index.ts` (only Playwright's loader executes TS). The simplest working approach is to **compile** `@sentinel/ai` with `tsc -b` (already configured in B1 with `outDir: dist`) and run the emitted JS. So `analyze` = `tsc -b` then `node packages/ai/dist/cli.js`.

- [ ] **Step 1: Add the root `analyze` script.** Edit root `package.json` `scripts`, inserting after the `"typecheck"` line:

```json
    "typecheck": "tsc -b",
    "analyze": "tsc -b && node packages/ai/dist/cli.js",
```

- [ ] **Step 2: Add the `bin` to the package manifest.** Edit `packages/ai/package.json` to add a `bin` entry pointing at the compiled CLI (placed alongside the existing `main`/`types` fields from B1):

```json
  "bin": {
    "sentinel-analyze": "dist/cli.js"
  },
```

> Keep the surrounding B1 fields intact (`name: "@sentinel/ai"`, `main`/`types` at `src/index.ts`, `dependencies` incl. `@anthropic-ai/sdk`/`@sentinel/core`/`@sentinel/contracts`). Only the `bin` key is added.

- [ ] **Step 3: Build then run the CLI end-to-end on the fixture (proves the compiled entry + exit code).**

Run:

```
npm run analyze packages/ai/tests/fixtures/invalid-run.jsonl; echo "exit=$?"
```

Expected: prints a readable analysis then `exit=0`, e.g.:

```
Run trace-invalid-1
Outcome: business-failure
Verdicts:
  - business-outcome (conf 1.00, rule): domain returned INVALID_CREDENTIALS
  - selector-drift (conf 0.90, rule) [auth.login.username]: ...
  - selector-drift (conf 0.90, rule) [auth.login.password]: ...

LLM: skipped (no ANTHROPIC_API_KEY; rules-only)
exit=0
```

> Exact verdict `summary` text and ordering follow B3's `classify` output; only the structure (outcome line, three rule verdicts, no `real-bug`, `exit=0`) is load-bearing here. The `LLM: skipped` line appears because, with `provider:null`, the orchestrator records `llmError: "no ANTHROPIC_API_KEY; rules-only"` only when `explain` was requested — if B4 suppresses the note under forced `provider:null`, that final line is simply absent; `exit=0` is unchanged.

- [ ] **Step 4: `--json` variant exits 0 and emits parseable JSON.**

Run:

```
npm run analyze packages/ai/tests/fixtures/invalid-run.jsonl -- --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s.trim().split('\n').slice(-1)[0]||s);console.log(a.outcome)})"
```

Expected: `business-failure` (the JSON parses; `npm` may prepend its own lines, so the last line is parsed).

- [ ] **Step 5: Commit.**

Run:

```
git add package.json packages/ai/package.json && git commit -m "feat(ai): add analyze script and sentinel-analyze bin"
```

Expected: commit created.

---

### B6 — Task 7: final acceptance gate (spec §11)

**Files:** none (verification only; commit any incidental formatting fixes).

Runs the full §11 acceptance: typecheck 0, lint 0, all unit tests green (incl. the new ai tests), the import audits, and the CLI smoke. The import-audit greps assert the SDK is confined to `claude-provider.ts` and that no driver / `@playwright/test` import leaks into `packages/ai/src`.

- [ ] **Step 1: Typecheck (§11.1).**

Run:

```
npm run typecheck
```

Expected: exits 0, no output errors (`tsc -b` clean).

- [ ] **Step 2: Lint (§11.1 + §11.2 boundary).**

Run:

```
npm run lint
```

Expected: exits 0 (no `no-restricted-imports` violations; the B1 lint extension bans `@sentinel/driver-*` from `packages/ai/**` and the SDK ban scoping holds).

- [ ] **Step 3: Import audit — SDK confined to the provider (§11.2).**

Run:

```
grep -rn "@anthropic-ai/sdk" packages/ai/src
```

Expected: exactly one match, in `packages/ai/src/llm/claude-provider.ts`, e.g.:

```
packages/ai/src/llm/claude-provider.ts:1:import Anthropic from "@anthropic-ai/sdk";
```

- [ ] **Step 4: Import audit — no driver / no Playwright in the analyzer (§11.2).**

Run:

```
grep -rn "@playwright/test\|@sentinel/driver" packages/ai/src; echo "exit=$?"
```

Expected: no matches, `exit=1` (grep found nothing).

- [ ] **Step 5: Full unit suite green (§11.3).**

Run:

```
npm run test:unit
```

Expected: all tests pass, including the new `packages/ai/tests/{render,barrel,e2e,cli}.test.ts` (plus the B2–B5 ai tests). The opt-in Claude integration test (B5) is reported as skipped because `ANTHROPIC_API_KEY` is unset. Summary line shows `0 failed`.

- [ ] **Step 6: CLI smoke — readable analysis, exit 0, not a real-bug (§11.6).**

Run:

```
npm run analyze packages/ai/tests/fixtures/invalid-run.jsonl; echo "exit=$?"
```

Expected: prints the run analysis (outcome `business-failure`, a `business-outcome` verdict, two `selector-drift` verdicts, NO `real-bug`) and `exit=0`.

- [ ] **Step 7: Commit (only if Steps produced incidental fixes; otherwise skip).**

Run:

```
git add -A && git commit -m "chore(ai): slice b6 acceptance — render, cli, e2e green" || echo "nothing to commit"
```

Expected: commit created, or `nothing to commit` if the tree is already clean (all prior tasks committed).

---

Grounding notes for the assembler (verified against the repo, not part of the emitted plan):

- `TelemetryEvent` / envelope shapes confirmed in `packages/core/src/telemetry/{event,signals}.ts`; `business.failure.domainReason`, `locator.resolved.{degraded,resolvedRank,candidates}`, `flow.finished.{outcome,didDegrade}`, and bigint `timing.startMonotonicNs` (kept as JSONL string per spec §13 Q3) all match the fixture.
- No `tsx`/`ts-node` exists in the repo (`node_modules/.bin` has only `playwright`/`playwright-core`); TS executes only through Playwright's loader. Hence the CLI runs **compiled** `dist/cli.js` and the `analyze` script does `tsc -b` first — the simplest working approach, stated in Task 6.
- Unit tests import `{ test, expect } from "@playwright/test"` and live under `packages/ai/tests/**`, already covered by `playwright.unit.config.ts` `testMatch` and exempt from the import ban via the `packages/**/tests/**` ESLint block.
- Cross-task assumptions on B2–B5 symbol names (`loadEvents`, `redactEvents`, `classify`, `FakeLlmProvider`) and on B3's `business-outcome` evidence carrying `domainReason` are flagged inline with fallbacks, since those files are authored in earlier sub-steps.

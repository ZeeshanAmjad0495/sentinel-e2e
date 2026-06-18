# Sentinel Slice B — `@sentinele2e/ai` Run-Analyzer: Design Spec

- **Status:** Draft for review
- **Date:** 2026-06-02
- **Branch:** `feat/ai-run-analyzer` (stacked on `feat/core-spine`; retarget to `main` once slice A merges)
- **Scope:** The phase-1 AI beachhead — a single-run analyzer that consumes the structured telemetry from slice A, classifies each failure (real-bug / infra-flake / selector-drift) deterministically, and uses Claude to explain the run in plain language and adjudicate ambiguous cases.

---

## 0. Locked decisions (from design review)

| #   | Decision                                                        | Effect                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Single-run scope**                                            | Analyze one run's JSONL (classify + explain). Cross-run flake-trend detection is deferred (depends on the cross-run join key the slice-A spec §9 also deferred).                                                                                                          |
| D-2 | **Deterministic rules classify; Claude explains + adjudicates** | A pure rule layer produces the verdicts from telemetry fields (offline, free, fully unit-testable). Claude turns the verdict into a plain-language explanation and adjudicates only `indeterminate` verdicts — it never overrides a high-confidence rule verdict.         |
| D-3 | **Model: `claude-opus-4-8`**                                    | The LLM explanation/adjudication layer uses Opus 4.8.                                                                                                                                                                                                                     |
| D-4 | **LLM optional + graceful**                                     | Rules work with NO key. The Claude layer activates only when `ANTHROPIC_API_KEY` is present, behind an `LlmProvider` abstraction with a `FakeLlmProvider` for tests (zero API calls in CI). The real provider is exercised only in an opt-in, key-gated integration test. |

---

## 1. Overview & design principles

The analyzer is the first realization of Sentinel's thesis: the framework emits a clean, structured, domain-level telemetry record, and AI reasons _over that record_ rather than guessing at selectors. Slice A produces the record (JSONL per run); slice B consumes it.

Principles:

1. **Driver-agnostic by construction.** `@sentinele2e/ai` depends ONLY on the telemetry contract (`@sentinele2e/core` event/signal types) — it has zero knowledge of Playwright or any driver. The lint boundary BANS driver imports from `@sentinele2e/ai`. The same analyzer will work unchanged on future mobile/Selenium runs. This is the tool-agnostic thesis paying a dividend.
2. **Determinism first.** The telemetry was deliberately designed so failure classification is derivable from envelope fields (slice-A spec §6). The rule layer is pure, free, and exhaustively unit-testable. The LLM is an _explainer and tie-breaker_, not the classifier — keeping results grounded, cheap, and reproducible.
3. **Graceful degradation.** No `ANTHROPIC_API_KEY` → a complete rules-only analysis (verdicts + evidence), with a note that the explanation was skipped. An LLM error never fails the analysis.
4. **Nothing secret leaves the process.** The telemetry is already credential-free (verified in slice A). The analyzer adds a redaction pass as defense-in-depth before any payload is sent to the Claude API, and sends _only_ telemetry-derived data — never env vars or anything else.
5. **JSON-first output.** `RunAnalysis` is a typed, versioned object; a human-readable rendering is derived from it.

---

## 2. Package layout

New workspace package `@sentinele2e/ai`, depends on `@sentinele2e/core` (telemetry types) + `@sentinele2e/contracts` (shared types) + `@anthropic-ai/sdk` (the real provider only).

```
packages/
  ai/                                  # @sentinele2e/ai — driver-AGNOSTIC; may import @anthropic-ai/sdk, NEVER a driver
    package.json   tsconfig.json
    src/
      load.ts                          # JSONL/in-memory -> typed ordered TelemetryEvent[]
      redact.ts                        # defense-in-depth secret stripping before any LLM call
      verdict.ts                       # Verdict / VerdictKind / Evidence types
      classify/
        rules.ts                       # the deterministic classifier (pure)
        index.ts
      llm/
        provider.ts                    # LlmProvider interface + FakeLlmProvider
        claude-provider.ts             # real provider: @anthropic-ai/sdk, claude-opus-4-8, prompt caching
        index.ts
      analyze.ts                       # orchestrator: analyzeRun(...)
      analysis.ts                      # RunAnalysis / RunClassification types
      render.ts                        # RunAnalysis -> JSON + human-readable text
      cli.ts                           # `sentinel-analyze <run.jsonl>`
      index.ts                         # barrel
    tests/                             # Playwright unit runner (*.test.ts); offline, no API
```

**Wiring:** add `@sentinele2e/ai` to the root `tsconfig` references graph, to `tsconfig.base.json` `paths` (`@sentinele2e/ai` + `@sentinele2e/ai/*`), to `tsconfig.eslint.json` `include`, and as a workspace. **ESLint boundary:** extend the `no-restricted-imports` ban so `@sentinele2e/ai/**` cannot import `@playwright/test`, `playwright`, OR any `@sentinele2e/driver-*` package — the analyzer must stay driver-agnostic. `@anthropic-ai/sdk` is allowed only inside `packages/ai/src/llm/claude-provider.ts` (scope the SDK to the provider file; the rest of the package stays SDK-free and pure).

---

## 3. Types

### 3.1 Verdict (`verdict.ts`)

```ts
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

### 3.2 Classification & analysis (`analysis.ts`)

```ts
import type { TelemetryEvent } from "@sentinele2e/core";

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
```

---

## 4. Deterministic classifier (`classify/rules.ts`)

Pure function `classify(events: readonly TelemetryEvent[]): RunClassification`. No I/O, no API. The algorithm walks the ordered events:

1. **Outcome & degradation:** read the terminal `flow.finished` → `outcome` + `didDegrade`. `degraded = didDegrade || any locator.resolved.degraded`.
2. **selector-drift** (confidence 0.9): for each `locator.resolved` with `degraded:true`/`resolvedRank>0`, emit a `selector-drift` verdict (evidence: the `candidates[]` trail — which durable kind missed, which fallback won, at what rank). Also: each `system.failure` with `errorKind ∈ {selector-not-found, selector-ambiguous}` → `selector-drift` (evidence: `logicalName` + attempted trail). Drift is surfaced **even on a passing run** (silent drift is a leading indicator).
3. **real-bug** (confidence 0.85): each `assertion` with `matched:false && locatorRank===0` and **no preceding `retry`** for the same span → `real-bug` (a stable, most-durable locator resolved, but the asserted state never held). Also: a `system.failure` of kind `timeout` whose `branchProgress` shows the success-signal locator reached `attached` but not `visible` → `real-bug` candidate.
4. **infra-flake** (confidence 0.8): a `retry` event followed by an eventual passing terminal (retry-then-pass); or a `system.failure` with `retryable:true` (`timeout`/`driver-session`) that is NOT already a rank-0 assertion mismatch → `infra-flake`.
5. **business-outcome** (confidence 1.0): each `business.failure` → a `business-outcome` verdict carrying `domainReason` (e.g. `INVALID_CREDENTIALS`). This is the system working correctly — explicitly **not** a defect. (Slice 1 does not judge whether the business outcome was _expected_ given inputs — that needs an expectation the analyzer doesn't have. The LLM MAY note an apparent mismatch in its explanation, but the rule verdict stays `business-outcome`.)
6. **healthy** (confidence 1.0): `outcome === "success"` with no defects. If `degraded`, the run is healthy **and** carries the drift verdicts as warnings (both coexist).
7. **indeterminate** (confidence ~0): a failure/anomaly matching none of the above (e.g. `system.failure` of kind `assertion-infrastructure`, or a `flow.finished system-failure` whose cause the rules can't pin) → an `indeterminate` verdict added to `RunClassification.indeterminate` for the LLM to adjudicate.

A single run yields a **list** of verdicts (e.g. the real auth-invalid run → `[business-outcome(INVALID_CREDENTIALS), selector-drift(auth.login.username), selector-drift(auth.login.password)]`, outcome `business-failure`, `degraded:true`). The classifier is exhaustively unit-tested with synthetic event arrays.

---

## 5. LLM layer

### 5.1 Provider abstraction (`llm/provider.ts`)

```ts
import type { TelemetryEvent } from "@sentinele2e/core";
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

### 5.2 Claude provider (`llm/claude-provider.ts`)

- The ONLY file importing `@anthropic-ai/sdk`. Model: **`claude-opus-4-8`**.
- **Prompt caching (mandatory, per the `claude-api` skill):** the large static system prompt — the classification rubric + the telemetry-event schema + output contract — is sent with `cache_control` so repeated runs reuse it. The per-run user message (the redacted classification + events) is the small variable part.
- **Structured output via tool use:** a single tool (e.g. `report_run_analysis`) whose input schema matches `LlmRunResult` (explanation + adjudications). The provider forces the tool call and parses the validated input — no free-text JSON parsing.
- **Grounding:** the prompt instructs Claude to (a) write a concise plain-language explanation of what happened in the run, referencing the deterministic verdicts; (b) adjudicate ONLY the `indeterminate` verdicts into a concrete `VerdictKind` with a one-line reason; (c) NOT override any rule verdict. Adjudications carry `source:"llm"`.
- **Construction:** reads `ANTHROPIC_API_KEY` from env. The provider is only instantiated when a key is present (see §6). Errors (rate-limit/network/4xx) propagate to the orchestrator, which degrades gracefully.

---

## 6. Orchestrator (`analyze.ts`)

```ts
import type { TelemetryEvent } from "@sentinele2e/core";
import type { LlmProvider } from "./llm/provider";
import type { RunAnalysis } from "./analysis";

export interface AnalyzeOptions {
  /** undefined = auto (ClaudeProvider iff ANTHROPIC_API_KEY present); null = force rules-only. */
  readonly provider?: LlmProvider | null;
  readonly explain?: boolean; // default true
}

export async function analyzeRun(
  input: string | readonly TelemetryEvent[], // JSONL path or in-memory events
  opts?: AnalyzeOptions,
): Promise<RunAnalysis>;
```

Pipeline: **load** (`load.ts`: parse JSONL or accept events; revive bigint timing; warn on unknown `schemaVersion` major) → **classify** (`rules.classify`) → resolve provider (explicit `opts.provider`, else auto: `ClaudeProvider` iff key present, else none) → **if provider && (indeterminate exists || explain)**: `redact(events)` then `provider.analyze(ctx)`; merge `explanation` + adjudications (matched into `verdicts` by `eventId`/`logicalName`) → build `RunAnalysis`. On provider throw or absent key → `usedLlm:false`, `llmError` set when attempted-and-failed (absent key when `explain` requested → `llmError: "no ANTHROPIC_API_KEY; rules-only"`), verdicts still complete.

---

## 7. Redaction (`redact.ts`)

`redactEvents(events): TelemetryEvent[]` — defense-in-depth before anything is sent to the API. Deep-clones events and (a) replaces values whose KEY matches a secret pattern (`/pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i`) with `"[redacted]"`, and (b) scrubs any string VALUE that matches an **unambiguous secret shape** — JWTs (`eyJ…`), `Bearer …` tokens, and common API-key prefixes (`sk-`, `ghp_`, `xox[baprs]-`, AWS `AKIA…`). Generic high-entropy detection is deliberately NOT done so that UUID ids (`traceId`/`spanId`/`eventId`), selectors, prose and numbers are preserved. The orchestrator builds the API-bound `AnalysisContext` from the redacted events — so the `classification` it carries (whose evidence `detail` strings embed `system.failure.message`) is scrubbed too; the local `RunAnalysis` keeps the raw-events classification for full fidelity. The telemetry is already credential-free (verified in slice A), so this is belt-and-suspenders; it is unit-tested with a planted secret field (both by key and by value-shape) to prove the payload reaching a (spy) provider is clean. **The orchestrator sends only redacted telemetry events — never `process.env` or any other host data.**

---

## 8. Rendering & CLI

- `render.ts`: `toJson(analysis)` (the machine artifact) and `toText(analysis)` (a human-readable terminal/markdown summary: outcome, each verdict with kind/confidence/summary, the explanation if present, and an `llmError` note if degraded).
- `cli.ts` (`bin: sentinel-analyze`): `sentinel-analyze <path-to-jsonl> [--json]`. Loads the file, runs `analyzeRun`, prints `toText` (or `toJson` with `--json`). **Exit code:** `1` if any `real-bug` verdict is present, else `0` (so CI can gate on real bugs while treating flake/drift/business outcomes as non-fatal — drift still printed as a warning). Root `package.json` gains `"analyze": "node packages/ai/dist/cli.js"` (or a ts entry via the existing loader) — exact entry decided in the plan.

---

## 9. Error handling

- Malformed JSONL line → skip + `console.warn`; if zero valid events → throw a clear error.
- Unknown telemetry `schemaVersion` major → warn, best-effort continue.
- bigint timing fields arrive as strings in JSONL → revive to `bigint` (or keep as string for analysis; the analyzer doesn't need bigint math — document which).
- LLM failure (no key / rate-limit / network / malformed tool output) → caught; `RunAnalysis` returns rules-only with `llmError`. Never throws out of `analyzeRun` due to the LLM.

---

## 10. Testing

- **Rules (`classify/rules.ts`):** pure unit tests, synthetic `TelemetryEvent[]` per verdict — drift (degraded resolution + selector-not-found), real-bug (rank-0 assertion mismatch; branchProgress attached-not-visible), infra-flake (retry-then-pass; retryable timeout), business-outcome, healthy, healthy-but-drifting, indeterminate. Offline, zero API. Under the Playwright unit runner (`packages/ai/tests/*.test.ts`, no `page` fixture → no browser).
- **Orchestrator (`analyze.ts`):** `FakeLlmProvider` → asserts merge of explanation + adjudications; `provider:null` → rules-only; auto with no key → `usedLlm:false` + `llmError`.
- **Redaction:** planted-secret event → a spy `LlmProvider` captures the `ctx.events` and asserts the secret is `[redacted]`.
- **Real Claude (opt-in):** one key-gated integration test (`test.skip` when `!process.env.ANTHROPIC_API_KEY`) that runs the real provider on a sample run and asserts a non-empty `explanation` + well-formed adjudications; asserts prompt-cache usage is present in the SDK response (`cache_creation_input_tokens`/`cache_read_input_tokens`). Cost-bounded (single small call).
- **End-to-end:** `analyzeRun(<real auth-invalid JSONL>, { provider: null })` → assert outcome `business-failure`, a `business-outcome` verdict with `domainReason "INVALID_CREDENTIALS"`, and `selector-drift` verdicts for the degraded `auth.login.username`/`auth.login.password` resolutions (matching the real sample's `resolvedRank:6 degraded:true`).

---

## 11. Acceptance criteria

1. `npm run typecheck` 0 and `npm run lint` 0 with `@sentinele2e/ai` in the project graph + lint projects.
2. **Boundary:** `@sentinele2e/ai/**` imports no driver (`@playwright/test`/`playwright`/`@sentinele2e/driver-*`) — proven by lint + an import audit; `@anthropic-ai/sdk` appears only in `llm/claude-provider.ts`.
3. `npm run test:unit` green including all new `@sentinele2e/ai` tests (rules per-verdict, orchestrator, redaction, e2e on the real JSONL) — all offline, zero API.
4. The opt-in Claude integration test passes when `ANTHROPIC_API_KEY` is set (and is cleanly skipped without it), and demonstrates prompt caching.
5. `analyzeRun` with no key returns a complete rules-only `RunAnalysis` (verdicts + `llmError`, `usedLlm:false`).
6. `sentinel-analyze <jsonl>` prints a readable analysis and exits non-zero only on a `real-bug` verdict.

---

## 12. Ordered implementation sub-steps (non-normative)

1. **B1 — package skeleton + wiring.** `packages/ai` workspace (`package.json` incl. `@anthropic-ai/sdk` + `@sentinele2e/core`/`contracts`; composite `tsconfig`); add to root tsconfig references, `tsconfig.base.json` paths, `tsconfig.eslint.json` include; extend the ESLint `no-restricted-imports` ban (no drivers in `@sentinele2e/ai`). Acceptance: `tsc -b` + lint green on an `export {}` skeleton.
2. **B2 — types + load + redact.** `verdict.ts`, `analysis.ts`, `load.ts` (JSONL parse + bigint revive + schemaVersion guard), `redact.ts`; unit tests for load (malformed line, bigint) + redact (planted secret).
3. **B3 — deterministic classifier.** `classify/rules.ts` + exhaustive per-verdict unit tests.
4. **B4 — provider interface + orchestrator.** `llm/provider.ts` (interface + `FakeLlmProvider`); `analyze.ts` (rules + provider resolution + merge + graceful no-key/error); orchestrator tests with the fake.
5. **B5 — real Claude provider.** `llm/claude-provider.ts` (`@anthropic-ai/sdk`, `claude-opus-4-8`, prompt caching, tool-use structured output); redaction-before-send test (spy); opt-in key-gated integration test.
6. **B6 — render + CLI + e2e.** `render.ts`, `cli.ts`, npm `analyze` script; the end-to-end test on the real auth JSONL; final acceptance (§11).

---

## 13. Open questions for the user

1. **CLI bin name:** `sentinel-analyze` (and `npm run analyze`). Accept, or prefer another name?
2. **Analyzer output schema version:** start at `1.0.0` (independent of the telemetry `schemaVersion`). Accept?
3. **bigint timing in analysis:** the analyzer doesn't need nanosecond math; keep timing fields as their JSONL string form (don't revive to `bigint`) unless a rule needs duration. Accept (simpler), or revive to `bigint`?

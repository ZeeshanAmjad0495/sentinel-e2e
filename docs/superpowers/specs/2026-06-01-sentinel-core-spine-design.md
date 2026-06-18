# Sentinel Slice A — `@sentinele2e/core` Spine: Design Spec

- **Status:** Draft for review
- **Date:** 2026-06-01
- **Branch:** `feat/core-spine`
- **Scope:** Slice A of the approved Sentinel roadmap — the tool-agnostic core spine + the Playwright adapter, with the existing auth slice migrated onto it.

---

## 0. Locked decisions (from design review)

These four decisions were taken at the design-approval gate and govern this spec. Where they diverge from the workflow's recommended defaults, that is intentional.

| #   | Decision                               | Effect                                                                                                                                                                                                   |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Full monorepo move now**             | `domain` / `flows` / `components` / `config` + tests move into an `examples/web-erpnext` workspace this slice (not deferred).                                                                            |
| D-2 | **Specs migrate to the nested result** | The flat `LoginResult` projection is dropped. The flow returns the rich discriminated-union `Result`; `log-in.spec.ts` and `fixtures/auth.ts` are edited to read `result.status` / `reason` / `message`. |
| D-3 | **Dual-candidate `.invalid` fallback** | The `invalid` locator leads with the structural `.page-card-body.invalid …` candidate and retains the submit-button candidate second. No live-app verification required this slice.                      |
| D-4 | **`JsonlSink` ships now**              | `CompositeSink([InMemorySink, JsonlSink])` is wired in the example session; JSONL telemetry is written to disk per run for analyzer experiments.                                                         |

**Open interpretation flagged for review (R-1):** D-2 rejected the _flat result projection_, not the _call signature_. This spec keeps `logIn(page, credentials, opts)` and wraps the `Page` internally, so fixtures still call `logIn(page, …)`. If you also want a `logIn(session, …)` primary signature, say so at the spec-review gate.

---

## 1. Overview & design principles

Sentinel produces a clean, structured, domain-level **telemetry record** of everything an automation run did; AI reasons over that record (explain runs; classify each failure as real-bug / infra-flake / selector-drift). Tool-agnosticism is a _consequence_ of three honest plugin seams — **driver registry**, **locator-strategy registry**, **telemetry sinks** — not the headline.

Five principles govern every decision:

1. **Business failures are returned** as a discriminated-union `Result`; **system failures are thrown** as typed errors carrying context.
2. The **universal contract surface** is the genuinely cross-platform subset (`tap` / `typeText` / `clear` / `read` / `waitFor` / `waitForFirstOf`); everything web-only or mobile-only is **capability-gated**, never on the base interface.
3. **Observability is structural** — the only path to acting on an element runs through a `resolve()` that emits a telemetry event, so drift cannot be silently skipped.
4. **Detect-and-record, never silent-mutate** — drift is surfaced, never auto-healed.
5. **Smallest correct change that keeps the suite passing** — the bottom CSS locator candidate stays byte-identical to today's selector, so live ERPNext resolution is unchanged; only the contract surface, the result shape, and emitted telemetry change.

---

## 2. Package layout (full monorepo move — D-1)

The repo is a single flat package today (`erpnext-e2e`, `tsconfig baseUrl:"."`, CommonJS, `src/core/*` are 0-byte stubs). Slice A converts it into an npm-workspaces monorepo: three framework packages plus one example app that holds the migrated auth slice.

```
sentinel-e2e/                              # workspace root
  package.json                             # "workspaces": ["packages/*","examples/*"]; keep "type":"commonjs"
  tsconfig.base.json                       # strict + noUncheckedIndexedAccess + @sentinele2e/* paths (lifted from current tsconfig)
  tsconfig.json                            # solution-style: references all packages + example
  eslint.config.cjs                        # + no-restricted-imports ban; parserOptions -> projectService:true (solution-style root tsconfig includes no files)
  packages/
    contracts/                             # @sentinele2e/contracts — ZERO runtime deps, pure types
      package.json  tsconfig.json
      src/{capability,locator,element,action,assertion,session,driver,index}.ts
    core/                                  # @sentinele2e/core — depends ONLY on @sentinele2e/contracts
      package.json  tsconfig.json
      src/result/{result,factory,index}.ts
      src/errors/{system-failure-error,kinds,index}.ts
      src/telemetry/{event,signals,sink,jsonl-sink,timers,index}.ts
      src/locator/{strategy-registry,engine,index}.ts
      src/index.ts
    driver-playwright/                     # @sentinele2e/driver-playwright — ONLY package importing @playwright/test
      package.json  tsconfig.json
      src/{driver,session,action,assertion,resolver,strategy-compiler,element,index}.ts
  examples/
    web-erpnext/                           # @sentinele2e/example-web-erpnext (private) — the migrated auth slice
      package.json  tsconfig.json  playwright.config.ts
      src/
        domain/auth/   { credentials.ts, log-in-result.ts, locators.ts }
        components/auth/ { log-in-form.ts, app-shell.ts }
        flows/auth/    log-in.ts
        config/        { env.ts, timeout.ts }
      tests/
        auth/log-in.spec.ts
        smoke.spec.ts
        _support/fixtures/{auth.ts,test.ts}
  docs/                                     # specs, ADRs
```

**Transition mechanics:**

- The empty `src/core/*` stubs (`page-handle.ts`, `telemetry.ts`, `system-failure-error.ts`, `timers.ts`, etc.) are **deleted**; nothing imports them, so there is no fallout. The whole flat `src/` tree is replaced by the package + example layout above (`git mv` where a file survives, e.g. `credentials.ts`, `env.ts`).
- `tsconfig.base.json` holds `strict`, `noUncheckedIndexedAccess`, `module: CommonJS`, `target: ES2022`, and explicit per-package `paths` (a single `@sentinele2e/*` glob silently misses the `/src/` segment on subpath imports):

  ```jsonc
  "paths": {
    "@sentinele2e/contracts": ["packages/contracts/src/index.ts"],
    "@sentinele2e/contracts/*": ["packages/contracts/src/*"],
    "@sentinele2e/core": ["packages/core/src/index.ts"],
    "@sentinele2e/core/*": ["packages/core/src/*"],
    "@sentinele2e/driver-playwright": ["packages/driver-playwright/src/index.ts"],
    "@sentinele2e/driver-playwright/*": ["packages/driver-playwright/src/*"]
  }
  ```

  Each package's `tsconfig.json` extends the base with `composite: true` and `references` to its dependencies (`core` → `contracts`; `driver-playwright` → `contracts` + `core`; `example` → all three).

- **Boundary enforcement:** an ESLint `no-restricted-imports` rule bans `@playwright/test` (and `playwright`) everywhere except `packages/driver-playwright/**` **and the example's test-runner files** (`examples/web-erpnext/tests/**` specs + `_support/fixtures/**`, which legitimately need Playwright's test runner). The ban targets app/flow/component code, not the spec runner; the boundary becomes a lint failure, not a convention. In flat config this is two ordered entries: a global `{ files: ['**/*.ts'], rules: { 'no-restricted-imports': ['error', { paths: ['@playwright/test','playwright'] }] } }`, then a later `{ files: ['packages/driver-playwright/**/*.ts','examples/web-erpnext/tests/**'], rules: { 'no-restricted-imports': 'off' } }` (last match wins).
- **Typed-lint transition:** the root `tsconfig.json` becomes references-only and includes no files, so the ESLint typed parser is switched from `parserOptions.project: './tsconfig.json'` to `parserOptions.projectService: true` (typescript-eslint v8); otherwise `no-floating-promises`/`no-misused-promises`/`await-thenable` fail to resolve on every `packages/**` and `examples/**` file.
- **VCS + resolution hygiene:** this slice adds `test-results/` and `playwright-report/` to `.gitignore` (currently absent — only the ESLint/Prettier ignore lists mention them, which do not affect VCS). `@sentinele2e/*` resolves **exclusively via tsconfig `paths` → `src`**; package `main`/`exports` are omitted (or point at `src/index.ts`) until the deferred publication slice, to avoid a half-true `dist` entry that fails outside the Playwright/tsc loaders.
- **Playwright runner:** the config moves to `examples/web-erpnext/playwright.config.ts` (`testDir: "./tests"`). Root `package.json` scripts pass `--config examples/web-erpnext/playwright.config.ts`. Playwright's TS loader honors `tsconfig` `paths`, so `@sentinele2e/*` imports resolve in specs and app code without a build step.

---

## 3. Core contracts (`@sentinele2e/contracts`)

Driver-agnostic, zero runtime deps. Components and flows import **only** these.

### 3.1 Capability detection — the escape hatch

```ts
// capability.ts
export type Capability =
  | "navigation" // URL + back/forward .......... web / mobile-webview
  | "dom" // a document tree ............. web
  | "accessibilityTree" // getByRole semantics ......... web
  | "gestures" // swipe/scroll/pinch/long-press  mobile-native
  | "contexts" // NATIVE_APP <-> WEBVIEW ....... mobile
  | "screenshot"
  | "networkInspection";

export interface CapabilityProbe {
  supports(cap: Capability): boolean;
  /** Loud, typed gate. Throws CapabilityUnsupportedError (a SystemFailureError) if absent. */
  require(cap: Capability): void;
}
```

### 3.2 Locator — an ordered, lazy description (never a live handle)

`StrategyKind` is an **open string** — a closed union cannot represent `-android uiautomator`, `accessibility id`, `image`. Drivers advertise which kinds they compile (`Driver.strategies`).

```ts
// locator.ts
export type StrategyKind = string; // "role" | "label" | "text" | "testid" | "css" | "xpath" | "-ios predicate string" ...

export interface LocatorStrategy {
  readonly kind: StrategyKind;
  readonly value: string; // role name / testid / css / predicate
  readonly options?: Readonly<Record<string, string | number | boolean>>; // strategy-scoped; {name,exact} only meaningful to role/label
}

export interface Locator {
  readonly logicalName: string; // STABLE id, "auth.login.submit" — the drift anchor
  readonly candidates: readonly LocatorStrategy[]; // ordered most-durable -> css/xpath fallback
  readonly minScore?: number; // accept threshold; default 1.0 in Slice A (binary)
  within(parent: Locator): Locator; // scoping/chaining
}
```

### 3.3 ElementHandle — re-resolved per call (no stale handles)

```ts
// element.ts
export interface ElementHandle {
  readonly locator: Locator;
  exists(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  text(): Promise<string>;
  /** NB: attribute namespaces are driver-specific (HTML attrs vs resource-id/content-desc). */
  attribute(name: string): Promise<string | null>;
}
```

### 3.4 Gesture target — does NOT require a Locator (mobile honesty)

```ts
// action.ts
export type GestureTarget =
  | { readonly kind: "element"; readonly locator: Locator }
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "percent"; readonly xPct: number; readonly yPct: number };
```

### 3.5 Action — universal verbs total; gestures gated & locator-free

```ts
// action.ts (cont.)
export interface Action {
  // UNIVERSAL surface — genuinely total across web + native. Neutral verb is "tap", not "click".
  tap(target: Locator): Promise<void>;
  typeText(target: Locator, text: string): Promise<void>;
  clear(target: Locator): Promise<void>;
  read(target: Locator): Promise<string>;

  // capability "gestures" (mobile-native) — absent => CapabilityUnsupportedError.
  swipe?(
    from: GestureTarget,
    dir: "up" | "down" | "left" | "right",
    opts?: { velocity?: number },
  ): Promise<void>;
  longPress?(target: GestureTarget, ms?: number): Promise<void>;
  scrollTo?(target: Locator): Promise<void>;
}
```

### 3.6 Assertion — explicit, retrying, driver-owned multi-condition wait

The second-web-driver lens forces the biggest contract change: **no flow-orchestrated `Promise.race` of two blocking waits** (Selenium/WDIO are serial single-session channels). `waitForFirstOf` is a **single driver-owned primitive** — Playwright maps it to `Promise.race` and owns loser-cancellation; a serial driver maps it to one interleaved poll loop. On timeout it throws, with per-branch **closest-reached state** so the analyzer can disambiguate broken-shell vs slow-infra vs drift.

```ts
// assertion.ts
export type ElementState =
  | "attached"
  | "detached"
  | "visible"
  | "hidden"
  | "enabled";

export interface BranchProgress<L extends string = string> {
  readonly label: L;
  readonly reachedState: ElementState | "none"; // closest state observed before timeout
  readonly resolvedRank: number | null; // locator rank that matched, or null if unresolved
}

export interface Assertion {
  /** Resolves on success; THROWS TimeoutError (with timings + artifacts) on timeout. NEVER returns on timeout. */
  waitFor(
    target: Locator,
    state: ElementState,
    opts?: { timeoutMs?: number },
  ): Promise<void>;

  /** Driver-owned race. Returns the winning label. On no winner, throws TimeoutError whose context
   *  carries per-branch BranchProgress[]. The driver OWNS loser-cancellation (no unhandled rejections). */
  waitForFirstOf<L extends string>(
    conditions: ReadonlyArray<{
      label: L;
      target: Locator;
      state: ElementState;
    }>,
    opts?: { timeoutMs?: number },
  ): Promise<L>;
}
```

### 3.7 Session & Driver — capabilities declared up front; nav/contexts async + gated

```ts
// session.ts
export interface Session extends CapabilityProbe {
  readonly id: string; // == telemetry traceId == ResultMeta.correlationId
  readonly driver: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly telemetry: TelemetrySink;

  locate(locator: Locator): ElementHandle;
  readonly action: Action;
  readonly assert: Assertion;

  // capability "navigation" (web / webview) — async (Appium webview URL is async). NOT on universal surface.
  navigate?(url: string): Promise<void>;
  currentUrl?(): Promise<string>;
  back?(): Promise<void>;

  // capability "contexts" (mobile)
  contexts?(): Promise<readonly string[]>;
  switchContext?(name: string): Promise<void>;

  screenshot?(): Promise<Buffer>; // capability "screenshot"
  end(): Promise<void>;
}

// driver.ts
export interface Driver {
  readonly name: string; // "playwright" | "appium-uiautomator2"
  readonly capabilities: ReadonlySet<Capability>;
  readonly strategies: ReadonlySet<StrategyKind>; // which locator kinds this driver can compile
  createSession(
    config: SessionConfig,
    telemetry: TelemetrySink,
  ): Promise<Session>;
}

export interface SessionConfig {
  readonly baseUrl?: string; // OPTIONAL: ignored on the page-wrap path (test owns page.goto)
  readonly defaultTimeoutMs: number; // single timeout source of truth (replaces 10_000 literals)
  /** Slice-A only: wrap a pre-navigated Playwright Page so logIn(page,...) stays working. */
  readonly existingPage?: unknown;
}
```

> **`existingPage` narrowing** is confined to `@sentinele2e/driver-playwright`: the driver duck-types it (presence of `goto`/`locator`) and throws `DriverSessionError` (`kind:"driver-session"`) on mismatch. The `as Page` cast exists at exactly this one guarded point; no other package narrows `existingPage`.
>
> **Id generation:** `Session.id` is minted once via `crypto.randomUUID()` in `@sentinele2e/core` at `createSession`, and is the single source feeding the JSONL filename and every envelope's `traceId`/`correlationId`. `eventId` is a fresh uuid per `emit`.

### 3.8 Explicitly EXCLUDED from core

| Concept                                                        | Why excluded           | Where it lives instead                                                                  |
| -------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `Page` / `BrowserContext` / `Browser` Playwright nouns         | tool-specific          | inside `@sentinele2e/driver-playwright`, behind `Session`                               |
| Raw CSS string as _the_ locator                                | absent in native       | a `LocatorStrategy{kind:"css"}` the web driver compiles                                 |
| `getByRole` / accessibility semantics as a method              | web-only               | gated `accessibilityTree`; strategy `kind:"role"`                                       |
| `url` / `finalUrl` / `currentUrl` as a **required** field      | web/webview-only       | `currentUrl?` gated `navigation`; in results an **optional artifact**                   |
| `back` / history, `waitForFunction(window.location…)`          | browser-only           | gated `navigation`; dead `waitForSuccessSignal` deleted                                 |
| Gestures, `NATIVE_APP↔WEBVIEW` switching                       | mobile-only            | optional gated methods on `Action`/`Session`                                            |
| `ElementHandle` as a _stateful, cached_ object                 | stale-handle bug class | re-resolved per call from the `Locator` description                                     |
| `screenshot` / `har` as a public success-path API              | not used by auth slice | failure-path artifact capture + gated `screenshot?`                                     |
| Fuzzy/Healenium scoring, `relative` strategy impl, multiremote | speculative            | declared in type space (`minScore`, open `StrategyKind`) so non-retrofit; unimplemented |

Calling any gated method on an unsupporting driver throws the typed `CapabilityUnsupportedError` — "unsupported" stays inside the taxonomy and telemetry, never a raw `undefined is not a function` crash.

---

## 4. Result model (`@sentinele2e/core` → `result/`) — nested shape, specs edited (D-2)

System failures are **thrown, never a `Result` variant**. A `Result` means "the run completed and produced a domain answer." Discriminant is `status` (string — narrows cleanly, extends without boolean explosion).

```ts
// result/result.ts
export interface ResultMeta {
  readonly correlationId: string; // == Session.id == telemetry traceId — THE join key
  readonly flowName: string; // "auth.login" — domain intent
  readonly startedAt: number; // single canonical epoch ms at flow entry
  readonly durationMs: number;
  readonly artifacts?: Readonly<Record<string, string>>; // e.g. {traceRef} — OPTIONAL string refs (NOT finalUrl; see below)
}

export interface Success<T> {
  readonly status: "success";
  readonly data: T;
  readonly meta: ResultMeta;
}
export interface BusinessFailure<R extends string = string, D = unknown> {
  readonly status: "business-failure";
  readonly reason: R; // STABLE enum, "INVALID_CREDENTIALS" — NEVER the localized UI string
  readonly message?: string; // human/UI text (localized; display-only, never keyed on)
  readonly details?: D;
  readonly meta: ResultMeta;
}
export type Result<T, R extends string = string, D = unknown> =
  | Success<T>
  | BusinessFailure<R, D>;

// result/factory.ts
export const ok = <T>(data: T, meta: ResultMeta): Success<T> => ({
  status: "success",
  data,
  meta,
});
export const businessFailure = <R extends string, D = unknown>(
  reason: R,
  meta: ResultMeta,
  opts?: { message?: string; details?: D },
): BusinessFailure<R, D> => ({
  status: "business-failure",
  reason,
  message: opts?.message,
  details: opts?.details,
  meta,
});
export const isSuccess = <T, R extends string, D>(
  r: Result<T, R, D>,
): r is Success<T> => r.status === "success";
export const assertNever = (x: never): never => {
  throw new Error(`Unhandled Result variant: ${JSON.stringify(x)}`);
};
```

### `LoginResult` is now the rich model (flat projection dropped)

```ts
// examples/web-erpnext/src/domain/auth/log-in-result.ts
import type { Result } from "@sentinele2e/core";

export interface LoginSuccessData {
  readonly username: string;
  readonly finalUrl?: string;
}
export type LoginReason = "INVALID_CREDENTIALS"; // stable, language-independent
export interface LoginFailureDetails {
  readonly username: string;
  readonly finalUrl?: string;
}

export type LoginResult = Result<
  LoginSuccessData,
  LoginReason,
  LoginFailureDetails
>;
```

There is **no `toFlatLoginResult`** and no flat interface. The flow returns `LoginResult` (the rich `Result`); the specs and fixtures read `status` / `reason` / `message` (see §8). `finalUrl` survives as a typed optional field on the success/details payload, populated only when `session.supports("navigation")`. Callers read `result.data.finalUrl` (success) / `result.details?.finalUrl` (failure) — `finalUrl` is a **typed payload field, not a `meta.artifacts` entry** (`Record<string,string>` cannot model an optional typed field, and `noUncheckedIndexedAccess` would widen it to `string | undefined`).

---

## 5. Error taxonomy (`@sentinele2e/core` → `errors/`)

Only kinds a current call site produces, plus the gated-method guard. Base carries the join key + artifacts; open by subclassing.

```ts
// errors/system-failure-error.ts
import type {
  Capability,
  StrategyKind,
  BranchProgress,
} from "@sentinele2e/contracts";

export type SystemFailureKind =
  | "timeout"
  | "selector-not-found"
  | "selector-ambiguous"
  | "driver-session"
  | "assertion-infrastructure"
  | "capability-unsupported";

export interface Artifact {
  readonly kind:
    | "screenshot"
    | "dom-snapshot"
    | "a11y-snapshot"
    | "trace"
    | "console-log"
    | "har";
  readonly ref?: string;
  readonly inline?: string;
}

export interface SystemFailureContext {
  readonly correlationId: string; // SAME id as ResultMeta + every telemetry event
  readonly flowName: string;
  readonly startedAt: number;
  readonly durationMs: number; // elapsed before failure
  readonly artifacts?: readonly Artifact[];
  readonly logicalName?: string; // for selector-* kinds: which element
  readonly attempted?: readonly {
    strategy: StrategyKind;
    matched: boolean;
    rank: number;
  }[];
  readonly branchProgress?: readonly BranchProgress[]; // for waitForFirstOf timeouts (disambiguation)
  readonly capability?: Capability; // for capability-unsupported
  readonly cause?: unknown; // raw driver error preserved
}

export abstract class SystemFailureError extends Error {
  abstract readonly kind: SystemFailureKind;
  abstract readonly retryable: boolean; // A-PRIORI flake HINT, not a verdict; analyzer refines via history
  constructor(
    message: string,
    readonly context: SystemFailureContext,
  ) {
    super(message);
    this.name = new.target.name;
    if (context.cause !== undefined)
      (this as { cause?: unknown }).cause = context.cause;
    Error.captureStackTrace?.(this, new.target);
  }
}
```

| Class                          | `kind`                     | `retryable` | Carries / classifier signal                                     |
| ------------------------------ | -------------------------- | ----------- | --------------------------------------------------------------- |
| `TimeoutError`                 | `timeout`                  | **true**    | timings + `branchProgress[]`; transient → lean infra-flake      |
| `SelectorNotFoundError`        | `selector-not-found`       | false       | `logicalName` + `attempted[]`; deterministic → selector-drift   |
| `SelectorAmbiguousError`       | `selector-ambiguous`       | false       | `logicalName` + match count; AI locator-fix candidate           |
| `DriverSessionError`           | `driver-session`           | **true**    | `cause`; browser/context lost → infra-flake                     |
| `AssertionInfrastructureError` | `assertion-infrastructure` | false       | the _check itself_ couldn't run (≠ a failed business assertion) |
| `CapabilityUnsupportedError`   | `capability-unsupported`   | false       | `capability`; thrown by `require(cap)` / gated-method calls     |

```ts
export const isSystemFailure = (e: unknown): e is SystemFailureError =>
  e instanceof SystemFailureError;
```

The load-bearing boundary: a failed _business_ assertion (wrong password) is a `BusinessFailure` **result**; `AssertionInfrastructureError` is only when the checking _machinery_ couldn't execute. Keeping these apart is what prevents false "real-bug" reports.

---

## 6. Telemetry event model (`@sentinele2e/core` → `telemetry/`)

JSON-first append-only stream, correlated by `correlationId` (= `Session.id`), ordered by a monotonic per-run `sequence` plus wall-clock `tsWallMs`. OTel-shaped `traceId` / `spanId` / `parentSpanId` are present so a span tree is additive later; Slice A only requires the flat correlation. Readers MUST ignore unknown `type`.

```ts
// telemetry/event.ts
export const TELEMETRY_SCHEMA_VERSION = "1.0.0";

export interface Timing {
  startWallClockMs: number; // Date.now() — cross-machine ordering
  startMonotonicNs: bigint; // process.hrtime.bigint() — duration source of truth
  endMonotonicNs?: bigint;
  durationMs?: number;
}
export type SpanStatus = "unset" | "ok" | "error";

export type TelemetryEventType =
  | "run.started"
  | "run.finished"
  | "flow.started"
  | "flow.finished"
  | "component.action"
  | "locator.resolved"
  | "retry"
  | "assertion"
  | "artifact.captured"
  | "business.failure"
  | "system.failure";

export interface TelemetryEnvelope<
  T extends TelemetryEventType = TelemetryEventType,
> {
  schemaVersion: string;
  eventId: string; // uuid
  type: T;
  traceId: string; // == correlationId == Session.id
  spanId: string;
  parentSpanId?: string;
  sequence: number; // monotonic per run — total order without a span tree
  name: string; // "auth.login" / "loginForm.submit"
  status?: SpanStatus;
  timing: Timing;
  attributes?: Readonly<Record<string, string | number | boolean>>;
}
```

```ts
// telemetry/signals.ts — classifier-critical payloads
import type {
  StrategyKind,
  ElementState,
  BranchProgress,
} from "@sentinele2e/contracts";
import type { Artifact, SystemFailureKind } from "../errors";
export interface LocatorResolvedEvent extends TelemetryEnvelope<"locator.resolved"> {
  logicalName: string;
  resolvedKind: StrategyKind;
  resolvedRank: number; // >0 => SELECTOR-DRIFT
  degraded: boolean; // resolvedRank > 0
  candidates: readonly {
    kind: StrategyKind;
    outcome: "matched" | "missed" | "skipped";
    rank: number;
  }[];
  score: number;
  resolveDurationMs: number;
}
export interface AssertionEvent extends TelemetryEnvelope<"assertion"> {
  state: ElementState;
  matched: boolean;
  locatorRank: number; // matched:false && rank===0 && no prior retry => REAL-BUG
  branch?: string;
  branchProgress?: readonly BranchProgress[];
}
export interface RetryEvent extends TelemetryEnvelope<"retry"> {
  attempt: number;
  maxAttempts: number;
  reason: string;
  previousOutcome: "error" | "assertionFailed" | "timeout"; // retry-then-pass => INFRA-FLAKE
}
export interface BusinessFailureEvent extends TelemetryEnvelope<"business.failure"> {
  status: "ok"; // run mechanically succeeded; domain said no
  domainReason: string; // STABLE "INVALID_CREDENTIALS" — emitted independent of localized message
}
export interface SystemFailureEvent extends TelemetryEnvelope<"system.failure"> {
  status: "error";
  errorKind: SystemFailureKind;
  message: string;
  retryable: boolean;
  artifactRefs: readonly string[];
}
export interface ArtifactCapturedEvent extends TelemetryEnvelope<"artifact.captured"> {
  artifactKind: Artifact["kind"];
  ref: string;
  capturedOn: "systemFailure" | "degradedResolution"; // attachable to NON-failing drifted runs too
}
export interface FlowFinishedEvent extends TelemetryEnvelope<"flow.finished"> {
  outcome: "success" | "business-failure" | "system-failure";
  terminalReason?: string; // domainReason or SystemFailureKind
  didDegrade: boolean; // true if ANY locator.resolved in the flow had resolvedRank>0
}
```

```ts
// telemetry/sink.ts
export interface TelemetrySink {
  emit(event: TelemetryEvent): void; // sync, non-throwing; never breaks the run
  child(name: string): TelemetrySink; // opens a nested span (run -> flow -> action)
}
export class InMemorySink implements TelemetrySink {
  readonly events: TelemetryEvent[] = []; /* ... */
}
export class NoopSink implements TelemetrySink {
  emit(): void {}
  child() {
    return this;
  }
}
export class CompositeSink implements TelemetrySink {
  /* fan-out — SEAM 3 */
}
```

**Span/sequence model (specified, not placeholder).** A single per-run `SpanContext` — created at `createSession` and threaded to every sink — owns the monotonic `sequence` counter, generates `spanId` per span, and sets `parentSpanId` on `child()`; sinks do **not** each own counters. `InMemorySink.events` is the flat, append-order array the unit test reads (`emit` pushes, `child` returns a sink writing to the same array under a new span name). `CompositeSink(members: TelemetrySink[])` fans `emit` to every member and returns a `CompositeSink` over each member's `child(name)`. `NoopSink` is the default when no sink is supplied.

### `JsonlSink` (D-4) — disk export now

```ts
// telemetry/jsonl-sink.ts
export interface JsonlSinkOptions {
  readonly filePath: string;
}
export class JsonlSink implements TelemetrySink {
  // Appends one JSON object per line. MUST serialize bigint timing fields:
  //   JSON.stringify(event, (_k, v) => typeof v === "bigint" ? v.toString() : v)
  // child() returns a sink sharing the same file handle/path with an updated span name.
}
```

- **bigint hazard:** `JSON.stringify` throws on `bigint`. `JsonlSink` uses a replacer that stringifies `startMonotonicNs` / `endMonotonicNs`. Documented and unit-tested.
- **Default wiring:** the example session is created with `new CompositeSink([new InMemorySink(), new JsonlSink({ filePath })])`. `filePath` defaults to `test-results/telemetry/<runId>.jsonl` (runId = `Session.id`). The dir is created on first write. This slice **adds `test-results/` and `playwright-report/` to `.gitignore`** (currently absent — only the ESLint/Prettier ignore lists mention them, which do not affect VCS).
- Emission is sync and swallows its own I/O errors (telemetry must never fail a run); a failed write is itself emitted as a best-effort `console.warn`, not thrown.

### The classifier's three signals — derivable from envelope fields alone

| Verdict            | Decisive fields                                                                                                                                                               | Contract that guarantees it                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **selector-drift** | `locator.resolved` `resolvedRank>0` / `degraded:true`, or `candidates[]` primary `missed` → fallback `matched`; or `SelectorNotFoundError.attempted[]`                        | resolve **must** emit before any action returns             |
| **real-bug**       | `assertion` `matched:false` while `locatorRank===0` and no prior `retry`; or on the login race, `branchProgress` showing app-shell `attached`-not-`visible` after valid creds | `AssertionEvent.locatorRank` + `branchProgress` on the race |
| **infra-flake**    | `retry` then passing terminal; `system.failure` `retryable:true`; no rank-0 `assertion matched:false`                                                                         | `retryable` hint + cross-run join (§9)                      |

**Emission is structural.** The Playwright `Action` / `Assertion` / resolver are constructed with the sink + span context. Every `Action` method takes a `Locator`, so the only path to acting runs through `resolve()`, which **must** emit `locator.resolved` before returning a handle. `waitFor` / `waitForFirstOf` emit `assertion` (and on timeout, `system.failure` + `artifact.captured`, then throw). The flow emits `flow.started` / `flow.finished` (with the `didDegrade` rollup) and, on a business failure, `business.failure` carrying the **stable `domainReason`** independent of the localized message. Native non-locator actions (coordinate gestures) emit `component.action` directly. **Versioning:** `schemaVersion` on every envelope; MAJOR=breaking, MINOR=additive/new event types (readers must not throw on unknown `type`), PATCH=docs.

---

## 7. Locator engine (`@sentinele2e/core` → `locator/`)

A `Locator` is a prioritized candidate list (most-durable first, css/xpath as the bottom rung). The resolver (per driver) tries candidates in order, **first unique match ≥ `minScore` wins** (binary `1.0` in Slice A), and **emits which candidate won**. Self-healing is **detect + record + propose, never silent-mutate**.

### Durability-ranked strategy registry (SEAM 2) — open, driver-advertised

```ts
// locator/strategy-registry.ts
export interface StrategyMeta {
  readonly rank: number;
} // lower = more durable
export class StrategyRegistry {
  register(kind: StrategyKind, meta: StrategyMeta): void;
  rankOf(kind: StrategyKind): number;
}
```

| Rank | kind                             | Playwright compile              | Native (later)                                  |
| ---- | -------------------------------- | ------------------------------- | ----------------------------------------------- |
| 0    | `role`                           | `getByRole(value,{name,exact})` | gated `accessibilityTree`                       |
| 1    | `label`                          | `getByLabel(value)`             | accessibility id                                |
| 2    | `text`                           | `getByText(value,{exact})`      | `-android uiautomator` text                     |
| 3    | `placeholder`/`altText`/`title`  | situational getters             | —                                               |
| 4    | `testid`                         | `getByTestId(value)`            | accessibility id                                |
| 5    | `relative` _(declared, unimpl.)_ | `:near`                         | UiSelector relative                             |
| 6    | `css` / `xpath`                  | `locator(value)`                | xpath (discouraged) — **migration bottom rung** |

### Resolution algorithm (driver-honest)

```ts
// locator/engine.ts
export interface LocatorResolution {
  handle: ElementHandle;
  resolvedKind: StrategyKind;
  resolvedRank: number;
  degraded: boolean;
  score: number;
}
export interface LocatorResolver {
  resolve(locator: Locator): Promise<LocatorResolution>;
}
```

1. Iterate `candidates` in order. **If a candidate's `kind` is not in `driver.strategies`, SKIP it** (record `outcome:"skipped"`, do not fail) — a css-only Selenium driver simply falls through to its css candidate.
2. First _supported_ candidate that uniquely matches ≥ `minScore` wins (`score` fixed `1.0`).
3. Emit `locator.resolved` with `resolvedKind`, `resolvedRank` (winner index), `candidates[]` (each `matched`/`missed`/`skipped`), `degraded = rank>0`. A `degraded` resolution also triggers a DOM-snapshot `artifact.captured` so a later human-approved locator-fix slice has evidence even when the run did not fail.
4. If **all supported** candidates miss → throw `SelectorNotFoundError` with `logicalName` + `attempted[]`. Ambiguous unique-match violation → `SelectorAmbiguousError`.

**Authoring guarantee:** every component locator MUST include at least one universally-supported candidate (`css`/`xpath`) so a minimal driver can always resolve. **Actionability obligation (documented contract):** `tap`/`typeText` carry actionability-wait semantics the **driver** guarantees — Playwright via native auto-wait, a serial driver via an injected wait bounded by `defaultTimeoutMs`. The Assertion layer does not assume a "native auto-wait to wrap."

### How a Component declares locators (no `@playwright/test` import)

```ts
// examples/web-erpnext/src/domain/auth/locators.ts
import type { Locator } from "@sentinele2e/contracts";

export const loginLocators = {
  username: {
    logicalName: "auth.login.username",
    candidates: [
      { kind: "label", value: "Email" },
      { kind: "css", value: "input#login_email[autocomplete='username']" }, // migrated rank-6 fallback
    ],
  },
  password: {
    logicalName: "auth.login.password",
    candidates: [
      { kind: "label", value: "Password" },
      {
        kind: "css",
        value: "input#login_password[autocomplete='current-password']",
      },
    ],
  },
  submit: {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Login" } },
      { kind: "css", value: "button.btn-login[type='submit']" },
    ],
  },
  // INVALID detection (D-3): structural .invalid candidate FIRST, invalid-MESSAGE text SECOND.
  // CORRECTION (post-impl, commit 09ee4ac): candidate 2 was originally specified as the bare
  // `button.btn-login[type='submit']` with a visibility check — but that button is always
  // present/visible while the login form is on screen, so the INVALID branch won the
  // waitForFirstOf race during a SUCCESSFUL login's redirect window (false business-failure on
  // a valid login). Candidate 2 must match the invalid STATE, not button presence — a text
  // match on the invalid message (durable-first / text-fallback; neither matches on success).
  invalid: {
    logicalName: "auth.login.invalidState",
    candidates: [
      {
        kind: "css",
        value: ".page-card-body.invalid .btn-login[type='submit']",
      }, // structural (enum INVALID_STATE)
      { kind: "text", value: "Invalid Login. Try again." }, // fallback: button shows invalid text (NOT mere presence)
    ],
  },
} satisfies Record<string, Locator>;

export const appShellLocators = {
  // DRIVER-NEUTRAL success signal — an app-shell Locator, NOT a URL. URL is reinforcement only.
  ready: {
    logicalName: "auth.appShell.ready",
    candidates: [
      { kind: "css", value: "div.desktop-wrapper" }, // AppShellSelectors.ROOT
    ],
  },
} satisfies Record<string, Locator>;
```

**driver-playwright obligations (each an acceptance hook).** (a) `resolve()` emits `locator.resolved` **before** returning any handle; (b) `waitForFirstOf` maps to `Promise.race` and the driver cancels losing branches (zero unhandled rejections), throwing `TimeoutError` with per-branch `BranchProgress[]` on no winner; (c) `tap`/`typeText` carry actionability waits bounded by `defaultTimeoutMs`; (d) `timers.ts` derives `durationMs` from `process.hrtime.bigint()` deltas, not wall clock.

---

## 8. Auth-slice migration map (D-1 full move + D-2 spec edits)

Verified live defects: **D1** `app-shell.ts:26` captures `page.url()` once (stale); **D2** `app-shell.ts:28-34` _returns_ on timeout so the race in `log-in-page.ts:31-34` can resolve `"SUCCESS"` by timing out; **D3** `log-in-page.ts:66-75` `waitForSuccessSignal` is dead code; **D4** `log-in-form.ts:50-63` manual `while`+`waitForTimeout` polling; **D5** `log-in-form.ts:5,55` keys invalidity off the English string `"Invalid Login. Try again."`.

| Existing file                                                                                                                                                                                      | Becomes                                                                                                                                                                          | How / defects fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/selectors/log-in-selectors.ts` (`const enum`)                                                                                                                                                 | CSS folds into `examples/web-erpnext/src/domain/auth/locators.ts` as **rank-6 `css` fallbacks**; `role`/`label` added on top. `const enum` deleted.                              | Live resolution unchanged (css identical). `INVALID_STATE` becomes the `invalid` locator's structural candidate. **D5 fixed.**                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/selectors/app-shell-selectors.ts`                                                                                                                                                             | CSS folds into `appShellLocators` as `css` fallbacks.                                                                                                                            | `ROOT` becomes the driver-neutral `ready` success signal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `src/ui/components/log-in-form/log-in-form.ts`                                                                                                                                                     | **Rewritten** as `components/auth/log-in-form.ts` on `Session` (no `@playwright/test`). `fill→action.typeText`, `submit→action.tap`.                                             | **D4 fixed:** manual poll deleted; the INVALID wait uses the driver `waitForFirstOf`/`waitFor`; throws `TimeoutError` not bare `Error`. `read()` of the message element populates `message`.                                                                                                                                                                                                                                                                                                                                |
| `src/ui/components/app-shell/app-shell.ts`                                                                                                                                                         | **Rewritten** as `components/auth/app-shell.ts` on `Session`. `ready` exposed as a Locator.                                                                                      | **D1 fixed:** no captured-once URL; readiness is `assert.waitFor(appShellLocators.ready,"visible")`, re-resolved each tick. **D2 fixed:** `waitFor` **throws** on timeout. URL check (if `navigation`) is non-load-bearing reinforcement.                                                                                                                                                                                                                                                                                   |
| `src/ui/pages/log-in-page.ts`                                                                                                                                                                      | **Folded into the flow body** (FPM).                                                                                                                                             | **D3 fixed:** dead `waitForSuccessSignal` deleted. The `Promise.race` is replaced by `session.assert.waitForFirstOf([{label:"INVALID",target:loginLocators.invalid,state:"visible"},{label:"SUCCESS",target:appShellLocators.ready,state:"visible"}],{timeoutMs})` — driver owns concurrency + loser-cancellation and **throws on no-winner**. One `correlationId` + one `startedAt` at entry (replaces the two `Date.now()`). Builds `LoginResult` via `ok`/`businessFailure`; emits `flow.finished` + `business.failure`. |
| `src/flows/auth/log-in.ts`                                                                                                                                                                         | **Signature preserved (R-1):** `logIn(page, credentials, opts): Promise<LoginResult>`.                                                                                           | Internally builds `const sink = new CompositeSink([new InMemorySink(), new JsonlSink({ filePath })])` and wraps the `Page` in `PlaywrightDriver.createSession({ existingPage: page, defaultTimeoutMs }, sink)` (telemetry is the required 2nd arg per §3.7). `opts` gains an optional `sink?: TelemetrySink` (default as above) so the §10.4 unit test can inject and read an `InMemorySink`. Returns the rich `LoginResult`; call sites still pass `page`.                                                                 |
| `src/domain/auth/log-in-result.ts`                                                                                                                                                                 | `LoginResult = Result<LoginSuccessData, LoginReason, LoginFailureDetails>` (rich; §4). Flat interface + projection **removed**.                                                  | Specs/fixtures updated to nested shape (below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/domain/auth/credentials.ts`                                                                                                                                                                   | **Moved unchanged** to `examples/web-erpnext/src/domain/auth/credentials.ts`.                                                                                                    | `Readonly<{username,password}>` already tool-agnostic.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/config/{env,timeout}.ts`                                                                                                                                                                      | `env.ts` **moved** to `examples/web-erpnext/src/config/`; `timeout.ts` **authored new** (currently a 0-byte stub) to export `defaultTimeoutMs` (replaces the `10_000` literals). | env vars unchanged (`BASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD`).                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/core/*` 0-byte stubs                                                                                                                                                                          | **Deleted**; reborn as `@sentinele2e/contracts` + `@sentinele2e/core`.                                                                                                           | Empty stubs import nothing → no fallout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| All other flat-tree stubs (empty `data-table`/`dialog`/`form` components, empty barrels `src/config/index.ts` + `src/ui/**/index.ts`, `tests/_support/test.config.ts`, dead `index.ts` re-exports) | **Deleted** as unused.                                                                                                                                                           | `src/domain/auth/index.ts`'s **value** re-export of `LoginResult` is rewritten to `export type` (it is now a type alias; else `consistent-type-imports` flags it).                                                                                                                                                                                                                                                                                                                                                          |

### Test edits (D-2 — specs migrate to nested shape)

`tests/auth/log-in.spec.ts` (moves to `examples/web-erpnext/tests/auth/log-in.spec.ts`):

```ts
// BEFORE
expect(result.success).toBe(false);
expect(result.errorMessage).toBeTruthy();
// AFTER
expect(result.status).toBe("business-failure");
if (result.status === "business-failure") {
  expect(result.reason).toBe("INVALID_CREDENTIALS");
  expect(result.message).toBeTruthy(); // localized text still surfaced for humans
}
```

`tests/_support/fixtures/auth.ts` (moves under the example):

```ts
// BEFORE
if (!result.success) {
  throw new Error(
    `Admin login failed: ${result.errorMessage ?? "unknown error"}`,
  );
}
// AFTER
if (result.status !== "success") {
  throw new Error(`Admin login failed: ${result.message ?? result.reason}`);
}
```

`loginAsAdmin(page)` keeps its `page` parameter (R-1). `smoke.spec.ts` and the fixture files (`fixtures/test.ts`, `fixtures/auth.ts`) keep their `@playwright/test` **runner** imports unchanged, covered by the test-dir lint exemption (§2). The `loginAsAdmin` and `adminCredentials` fixtures are otherwise untouched.

### `.invalid` MUST-FIX (D-3)

The live code binds `invalidState = submitButton` and detects invalidity via button **textContent**, not `.invalid` — so it is unverified that `.page-card-body` gets `.invalid` on a real Frappe failure. **Resolution:** the `invalid` locator leads with the structural `.page-card-body.invalid …` candidate **and retains the submit-button candidate second**; the INVALID branch detection waits over that ordered list. If `.invalid` toggles, we get the durable signal; if not, resolution falls through to the button candidate exactly as today. The invalid-credentials test cannot regress. `message` (→ truthy assertion) is populated by `action.read()` of the message element, decoupled from the `reason` enum.

---

## 9. Residual risks & explicitly deferred items

- **In-flow retry / retry-then-pass is not produced in Slice A.** `RetryEvent` is defined but nothing in the auth flow retries within a run; Playwright spec-level retries create a _new_ `correlationId`. Slice A detects infra-flake only **cross-run**. We define the cross-run join key now (`flowRunGroupId`, a stable hash of `flowName` + **non-secret input identity only — never the password or any credential**, distinct from per-run `correlationId`) and emit it on `run.started` / `flow.finished`, but the in-flow `retry` wrapper is deferred.
- **`.invalid` structural signal unverified against the live app** — mitigated by the dual-candidate fallback (D-3); live confirmation deferred.
- **No real second driver / no mobile driver exists yet.** Capability gating, open `StrategyKind`, `GestureTarget`, async `currentUrl?`, and `waitForFirstOf` as a driver-owned primitive are designed so Appium/WDIO are _additive registrations_, but only the Playwright adapter is implemented and proven.
- **Fuzzy/self-healing scoring, `relative` strategy, OTel span tree, Allure/JUnit sinks, npm-package publication (real `dist` builds), multiremote** — declared in type space (non-retrofit) but **unimplemented**. `resolvedRank`/`degraded`/`minScore`/`traceId`/`CompositeSink` are the forward-compatible seams.
- **`SessionConfig.baseUrl` is dead on the page-wrap path** (the test owns `page.goto("/login")`); optional and ignored there. `defaultTimeoutMs` is the single timeout source of truth.
- **Artifact persistence beyond JSONL telemetry** (screenshots/DOM snapshots to disk) is referenced by `Artifact.ref` but the on-disk store is a later reporting slice; Slice A may inline small snapshots.

---

## 10. Acceptance criteria (how Slice A is verified)

1. `npm run lint` passes — typed rules resolve under `parserOptions.projectService: true` (the references-only root tsconfig includes no files), and the new `no-restricted-imports` ban reports no `@playwright/test` import outside `packages/driver-playwright/**` and the test-runner exemption.
2. `tsc -b` (project references) type-checks all packages + the example under `strict` + `noUncheckedIndexedAccess`.
3. `npm test` (Playwright, `examples/web-erpnext`) passes: the invalid-credentials spec asserts the nested `business-failure` / `INVALID_CREDENTIALS` / truthy `message`; the admin-login spec passes via the fixture.
4. A run writes `test-results/telemetry/<runId>.jsonl`; a `@sentinele2e/core` unit test asserts `InMemorySink` captured `locator.resolved` (with `resolvedRank`/`candidates`), `assertion`, `flow.finished`, and on the invalid path `business.failure` with `domainReason:"INVALID_CREDENTIALS"`; and that `JsonlSink` round-trips bigint timing fields.
5. The login success path no longer resolves by timeout (D2 fix): a unit/integration test proves `waitForFirstOf` throws `TimeoutError` (with `branchProgress`) when neither branch is reached, rather than returning `"SUCCESS"`.
6. No `@playwright/test` symbol is importable from `@sentinele2e/core` or `@sentinele2e/contracts` (enforced by lint + verified by the package `dependencies` having no `@playwright/test`).

---

## 11. Open questions for the user

1. **R-1 (signature):** keep `logIn(page, …)` (page-wrap) as specified, or also expose/prefer `logIn(session, …)`?
2. **Example app home:** `examples/web-erpnext` as the migrated-slice workspace (matches the README) — accept, or prefer `apps/` / keeping tests at repo root?
3. **JSONL path:** `test-results/telemetry/<runId>.jsonl` acceptable, or a different location (e.g. a git-ignored `.sentinel/`)?
4. **Playwright loader tsconfig (validate at build time):** which tsconfig Playwright's esbuild loader reads for _transitively-imported_ `packages/**` files (outside `examples/web-erpnext`) is genuinely uncertain — it may pick a package tsconfig lacking the `@sentinele2e/*` paths. Likely fix is `build: { tsconfig: '<the tsconfig that declares the paths>' }` in `playwright.config.ts`, but the implementer must confirm empirically (a spec importing `@sentinele2e/core` **and** a `driver-playwright` file importing `@sentinele2e/contracts` both resolving at test time) rather than asserting it here.

---

## 12. Ordered implementation sub-steps (non-normative)

Slice A bundles five independently-riskful workstreams; the implementation plan should sequence them so each is verifiable before the next, each gated on its §10 acceptance subset:

1. **S1 — Monorepo move + tooling.** Create the workspace, `tsconfig.base.json` (+ explicit `paths`), per-package tsconfigs, the ESLint flat-config ban + `projectService` switch, the `.gitignore` additions, and move the Playwright config. Acceptance: `tsc -b` and `lint` green on an empty-but-wired tree; existing tests still run from their new home (before the contract migration).
2. **S2 — `@sentinele2e/contracts` + `@sentinele2e/core` types.** Contracts, Result model, error taxonomy, telemetry event/sink model (incl. `SpanContext`, `InMemorySink`, `NoopSink`, `CompositeSink`, `JsonlSink` with bigint replacer), locator engine interfaces + `StrategyRegistry`. Acceptance: §10.2 type-check + core unit tests for sinks/result factories (no driver yet).
3. **S3 — `@sentinele2e/driver-playwright`.** Driver/session/action/assertion/resolver/strategy-compiler/element, including the four §7 obligations (esp. `waitForFirstOf` race + loser-cancellation and the resolve→`locator.resolved` emit). Acceptance: §10.5 (race throws on no-winner) + a resolver emit test.
4. **S4 — Auth-slice migration.** Locators, `LogInForm`/`AppShell` on `Session`, the folded flow, the rich `LoginResult`, the `logIn(page,…)` page-wrap. Acceptance: defects D1–D5 fixed.
5. **S5 — Spec edits + telemetry assertions green.** Edit the two specs/fixtures to the nested shape; assert `InMemorySink` events + `JsonlSink` round-trip. Acceptance: full §10 (1–6).

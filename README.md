# Sentinel

Sentinel is an automation framework built around one core idea: every action in a run produces a clean, structured, domain-level **telemetry record**, and AI reasons over that record to explain runs and classify failures as real-bug, infra-flake, or selector-drift.

Tool-agnosticism is a consequence of honest plugin seams — driver contracts, locator-strategy registry, telemetry sinks — not the headline. A second driver (Appium, a different web driver) can implement the same contracts without touching framework or flow code.

This repository holds **Slice A**: the first implemented slice. It is a working monorepo with three framework packages and one example app. Features not yet built are listed under [Roadmap](#roadmap).

---

## What is built today (Slice A)

### `@sentinel/contracts`

Zero runtime dependencies. Pure TypeScript interfaces that every driver and flow codes against:

- `Driver` / `Session` / `SessionConfig` — the factory contract; sessions declare capabilities up-front.
- `Locator` / `LocatorStrategy` — an ordered, lazily-resolved description (never a live DOM handle); `logicalName` is the stable drift anchor.
- `Action` — universal verbs (`tap`, `typeText`, `clear`, `read`); mobile-only gestures (`swipe`, `longPress`, `scrollTo`) are optional and capability-gated.
- `Assertion` — `waitFor` and `waitForFirstOf`; both throw on timeout, never resolve silently.
- `Capability` / `CapabilityProbe` — typed gates for web-only (`navigation`, `dom`, `accessibilityTree`) and mobile-only (`gestures`, `contexts`) features.
- `TelemetrySinkLike` — a minimal structural interface so `@sentinel/contracts` stays dependency-free while still carrying a sink reference on `Session`.

### `@sentinel/core`

Runtime utilities that all framework packages and flows use. Depends only on `@sentinel/contracts`.

**Result model.** A discriminated-union `Result<T, R, D>` with two variants:

```ts
// status: "success"
{ status: "success"; data: T; meta: ResultMeta }

// status: "business-failure"
{ status: "business-failure"; reason: R; message?: string; details?: D; meta: ResultMeta }
```

`ResultMeta` carries `correlationId` (the join key tying the result to every telemetry event in the run), `flowName`, `startedAt`, and `durationMs`. Factory helpers `ok(data, meta)` and `businessFailure(reason, meta, opts)` build the two variants. Business failures are returned; system failures are thrown.

**Error taxonomy.** `SystemFailureError` is the abstract base for typed thrown errors. Concrete subclasses:

| Class                          | `kind`                       | `retryable` |
| ------------------------------ | ---------------------------- | ----------- |
| `TimeoutError`                 | `"timeout"`                  | true        |
| `SelectorNotFoundError`        | `"selector-not-found"`       | false       |
| `SelectorAmbiguousError`       | `"selector-ambiguous"`       | false       |
| `DriverSessionError`           | `"driver-session"`           | true        |
| `AssertionInfrastructureError` | `"assertion-infrastructure"` | false       |
| `CapabilityUnsupportedError`   | `"capability-unsupported"`   | false       |

Each error carries a `SystemFailureContext` with `correlationId`, `flowName`, `startedAt`, `durationMs`, optional artifacts, and context fields specific to the error kind (e.g. `branchProgress` for `TimeoutError` on a `waitForFirstOf` call).

**Telemetry.** A sink pipeline with clear responsibilities:

- `SpanContext` — owns the monotonic sequence counter and mints span IDs for a run; shared across the whole trace.
- `StampingSink` — the single place stamping happens (applies `traceId`, `spanId`, `parentSpanId`, `sequence` from the `SpanContext`) before delegating to the inner sink.
- `InMemorySink` — pure recorder; children share the same backing array (one flat event log per run).
- `JsonlSink` — appends `JSON.stringify(event)\n` to a file; never throws (best-effort; telemetry must not fail a run).
- `CompositeSink` — fans events to multiple sinks; children propagate.
- `NoopSink` — discards all events; used in tests that do not care about telemetry.

**Locator strategy registry.** `StrategyRegistry` maintains durability ranks for strategy kinds (role=0, label=1, text=2, placeholder/altText/title=3, testid=4, relative=5, css/xpath=6). Drivers resolve candidates in rank order; a winner at rank > 0 signals selector drift.

### `@sentinel/driver-playwright`

The only package that imports `@playwright/test`. Implements the contracts for Playwright:

- `PlaywrightDriver` — implements `Driver`; declares capabilities (`navigation`, `dom`, `accessibilityTree`, `screenshot`) and supported strategy kinds (`role`, `label`, `text`, `testid`, `css`, `xpath`). In Slice A it requires a pre-navigated `Page` via `SessionConfig.existingPage` (duck-typed; throws `DriverSessionError` on mismatch). This is the single guarded `as Page` narrowing point.
- `PlaywrightSession` — wraps the `Page`; creates a `SpanContext` keyed on `session.id` and wraps the supplied sink in a `StampingSink`, so `session.id == traceId == correlationId == JSONL filename` throughout the run.
- `PlaywrightResolver` — walks `locator.candidates` in declaration order using the `StrategyRegistry` rank table; emits a `locator.resolved` event before returning the handle. A `resolvedRank > 0` means a lower-durability candidate won — that is the selector-drift signal.
- `PlaywrightAction` — implements `tap`, `typeText`, `clear`, `read` via the resolver.
- `PlaywrightAssertion` — implements `waitFor` and `waitForFirstOf`. `waitForFirstOf` runs all branches concurrently in short poll slices (a shared winner latch cancels losers without unhandled rejections). On no winner it emits an `assertion` event with the per-branch `BranchProgress` and throws `TimeoutError`. It never resolves on timeout.

### `examples/web-erpnext` (`@sentinel/example-web-erpnext`)

A private example app demonstrating the auth slice on the contracts. It is not a framework package; it is the reference SUT (system under test).

- `logIn(page, credentials, opts)` — the top-level flow function. Builds a `PlaywrightSession` over the caller's `Page`, fills and submits the login form, and races two locator branches via `session.assert.waitForFirstOf`: `INVALID` (the `.page-card-body.invalid` structural state or the invalid-message text) vs `SUCCESS` (the `div.desktop-wrapper` app shell). Returns a `LoginResult` (a `Result<LoginSuccessData, "INVALID_CREDENTIALS", LoginFailureDetails>`).
- The `runId` is minted before the session is created, so `runId == session.id == correlationId == traceId == JSONL filename`. Telemetry is written to `test-results/telemetry/<runId>.jsonl` via a `CompositeSink([InMemorySink, JsonlSink])`.
- Locators in `domain/auth/locators.ts` each carry multiple ordered candidates (most-durable first, CSS fallback last), satisfying the `Locator` contract with `within` scoping.

---

## The Result model

Business failures are returned as a `Result`; system failures are thrown as typed `SystemFailureError` subclasses. This keeps the happy path and expected-failure path in the type system while letting real infra/driver failures propagate as errors.

```ts
import type { Result } from "@sentinel/core";

// Checking the outcome
if (result.status === "success") {
  console.log(result.data.username, result.data.finalUrl);
} else {
  // result.status === "business-failure"
  console.log(result.reason); // "INVALID_CREDENTIALS" — stable, never localized
  console.log(result.message); // optional localized UI text
  console.log(result.meta.correlationId); // join key into the JSONL telemetry file
}
```

`ResultMeta.correlationId` is the single join key: it equals `Session.id`, every telemetry event's `traceId`, and the JSONL filename.

---

## Telemetry

Every resolved locator and every assertion emits a structured event. The event types built in Slice A:

| Event type          | When emitted                              | Key fields                                                                                                            |
| ------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `locator.resolved`  | Each resolver call                        | `logicalName`, `resolvedKind`, `resolvedRank`, `degraded` (rank > 0 = drift), `candidates[]` with per-outcome records |
| `assertion`         | Each `waitFor` / `waitForFirstOf` outcome | `state`, `matched`, `locatorRank`, `branchProgress[]`                                                                 |
| `business.failure`  | When a flow returns a business failure    | `domainReason` (stable, e.g. `"INVALID_CREDENTIALS"`)                                                                 |
| `flow.finished`     | At flow exit                              | `outcome`, `terminalReason`, `didDegrade`                                                                             |
| `system.failure`    | On thrown `SystemFailureError`            | `errorKind`, `retryable`, `artifactRefs[]`                                                                            |
| `retry`             | On retry                                  | `attempt`, `maxAttempts`, `previousOutcome`                                                                           |
| `artifact.captured` | On artifact attach                        | `artifactKind`, `ref`, `capturedOn`                                                                                   |

Every event envelope carries `schemaVersion`, `eventId`, `type`, `traceId`, `spanId`, `parentSpanId`, and `sequence`. Stamping happens once in `StampingSink` before fan-out, so the in-memory log and the on-disk JSONL are always identical.

The `CompositeSink([InMemorySink, JsonlSink])` setup in the example app writes one JSONL file per run at `test-results/telemetry/<runId>.jsonl`. This file is the feed for future AI-assisted run analysis.

---

## Getting started

### Prerequisites

- Node.js 20+
- A running ERPNext instance (only needed for the e2e spec)

### Install

```
npm install
npx playwright install chromium
```

### Environment variables (e2e spec only)

```
BASE_URL=https://your-erpnext-instance
ADMIN_USER=Administrator
ADMIN_PASSWORD=your-password
```

These are required by `examples/web-erpnext/src/config/env.ts`. The unit tests do not need them.

### Scripts

All scripts are defined in the root `package.json`.

| Script                 | What it does                                                                             | Needs live app?  |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `npm run typecheck`    | `tsc -b` solution build across all packages                                              | No               |
| `npm run lint`         | ESLint with `--max-warnings=0`                                                           | No               |
| `npm run lint:fix`     | ESLint with auto-fix                                                                     | No               |
| `npm run format`       | Prettier write                                                                           | No               |
| `npm run format:check` | Prettier check                                                                           | No               |
| `npm run test:unit`    | Playwright runner on `playwright.unit.config.ts` — unit and browser tests, no app needed | No               |
| `npm test`             | Playwright e2e spec against ERPNext (`examples/web-erpnext/playwright.config.ts`)        | Yes              |
| `npm run test:all`     | `test:unit` then `test`                                                                  | Yes (for `test`) |
| `npm run test:headed`  | e2e spec in headed mode                                                                  | Yes              |
| `npm run test:ui`      | e2e spec in Playwright UI mode                                                           | Yes              |

---

## Repository layout

```
sentinel-e2e/
  packages/
    contracts/        @sentinel/contracts — zero-dep types
    core/             @sentinel/core — result, errors, telemetry, locator registry
    driver-playwright/ @sentinel/driver-playwright — Playwright adapter
  examples/
    web-erpnext/      @sentinel/example-web-erpnext — auth slice on ERPNext
  docs/               design specs, ADRs
  package.json        workspace root (npm workspaces)
```

---

## Roadmap

The following are designed for but not yet implemented. They are clearly separated from what is built today.

- **Additional drivers.** Mobile automation via Appium (`appium-uiautomator2`). A second web driver to stress-test the contract boundaries.
- **AI run-analyzer.** A phase-1 analyzer that consumes the per-run JSONL telemetry files and classifies each failure as real-bug / infra-flake / selector-drift, using the signals already emitted (`resolvedRank > 0` = drift; `previousOutcome = "error"` + eventual pass = flake; `locatorRank = 0` + unmatched = real bug candidate).
- **Richer reporting sinks.** Allure, JUnit XML, Slack notifications, HTML dashboard.
- **CLI.** A `sentinel-cli` for scaffolding new driver adapters, running flows from the command line, and generating report summaries.
- **Known deferred follow-ups from Slice A design:**
  - Action waits should be bounded by the session's `defaultTimeoutMs`; they currently use Playwright's own timeout.
  - `@playwright/test` is currently a dev-dependency of the driver package; it should become a peer dependency when the package is published.
  - `Locator.within` is defined on the contract but optional for concrete locator objects; the contract needs to make it non-optional or explicitly optional in a future slice.

---

## License

MIT

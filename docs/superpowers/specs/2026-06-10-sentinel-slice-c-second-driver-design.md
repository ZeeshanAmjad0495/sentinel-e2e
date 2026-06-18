# Sentinel Slice C — Second Driver (`@sentinel/driver-selenium`) + Conformance Suite: Design Spec

- **Status:** Draft for review
- **Date:** 2026-06-10
- **Branch:** `feat/slice-c-second-driver` (off `main`; slices A + B merged)
- **Scope:** Prove "tool-agnostic" is real by implementing a second web driver behind the unchanged contracts, extract a shared cross-driver conformance suite both drivers must pass, fold in the three deferred contract refinements, and fix the drift-semantics wrinkle that a limited-strategy driver exposes.

---

## 0. Locked decisions

These were taken autonomously per the standing "complete the project" directive, informed by empirically-verified research (selenium-webdriver@4.44.0 + WebdriverIO probed on this machine).

| #   | Decision                                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1 | **Second driver = `selenium-webdriver`** (not WebdriverIO)                                                                           | The _harshest honest_ proof of tool-agnosticism. selenium has **no auto-wait** (forces the interleaved serial poll loop that slice A's `waitForFirstOf` was explicitly designed to support) and **only css/xpath/id/name/linkText natively** (realistically triggers the drift wrinkle). It exercises both the locator-contract and the wait-contract honesty; WebdriverIO's auto-wait + broad selectors would exercise neither. Verified: Selenium Manager auto-provisions chromedriver (cached, network once ~15s, ~2-4s warm), `--headless=new`, `data:`/`file://` URLs substitute for `setContent`, `findElements → []` (no throw) is the poll primitive, explicit `driver.wait(until…)` throws `TimeoutError`. Node ≥ 20 (repo is 22). |
| C-2 | **Drift-semantics fix = Option 3** (analyzer infers from `candidates[].outcome`; no contract change) + a one-line resolver alignment | `candidates[]` already carries `matched/missed/skipped` on the wire. Drift = "a more-durable candidate was **missed** (tried, failed), not **skipped** (unsupported)". Zero `LocatorResolvedEvent` schema change → telemetry stays schema-identical across drivers; analyzer stays driver-agnostic; Playwright slice-A/B behavior preserved exactly.                                                                                                                                                                                                                                                                                                                                                                                        |
| C-3 | **Three contract refinements land in this slice**                                                                                    | Cheapest to do before a second driver multiplies their cost: (a) optional per-action `timeoutMs` on `Action`; (b) `Locator.within` becomes optional (drop the `defineLocator` tax); (c) `@playwright/test` → `peerDependencies` + `devDependencies` in driver-playwright.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C-4 | **A shared, parameterized conformance suite** is the durable artifact                                                                | One suite both drivers (and any future Appium driver) instantiate, proving the contract behaviors identically. Skips gracefully when no browser binary is available (like the key-gated Claude test).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 1. Overview & principles

Slice A built the contracts and one driver; slice B proved AI rides the telemetry. Slice C proves the headline claim: a second, deliberately-different driver implements the **unchanged** `@sentinel/contracts` and produces **schema-identical** telemetry the analyzer consumes without modification.

Principles:

1. **Contracts unchanged except the three planned refinements.** If the second driver needs a contract change beyond C-3, that is a leak to surface, not silently shim.
2. **Schema-identical telemetry.** `@sentinel/driver-selenium` emits the same `locator.resolved` / `assertion` / `flow.finished` envelopes via the same `StampingSink` wiring. The existing JSONL fixture and the analyzer remain valid representations of reality.
3. **The conformance suite is the source of truth for "a driver is correct."** Behaviors are asserted once, run against every driver.
4. **Offline by default.** Conformance + auth-on-selenium tests use `data:`/`file://` fixtures — no live app. They **skip gracefully** when no browser/driver is available, so CI without browsers stays green.
5. **Honest capability advertisement.** selenium advertises only the strategies it can faithfully compile; `role` is **not** advertised (it needs the accessibility tree) — it is recorded `skipped` and falls through to a css fallback. A partial `role` impl would be dishonestly lossy.

---

## 2. Package layout & wiring

```
packages/
  driver-selenium/                       # @sentinel/driver-selenium — ONLY importer of selenium-webdriver
    package.json   tsconfig.json
    src/
      driver.ts            # SeleniumDriver: capabilities, strategies (NO role), createSession (Selenium Manager bootstrap)
      session.ts           # SeleniumSession: id, StampingSink(SpanContext(id)), locate/action/assert, navigate/currentUrl, end()=quit()
      strategy-compiler.ts # Sentinel kind -> selenium By (css/xpath templates; throws on unsupported -> caller skips)
      resolver.ts          # walks candidates, skips unadvertised kinds, findElements()->matched/missed/ambiguous, emits locator.resolved BEFORE handle
      element.ts           # SeleniumElementHandle, re-resolved per call (no stale WebElement)
      action.ts            # tap/typeText/clear/read with EXPLICIT actionability waits bounded by timeout (no auto-wait)
      assertion.ts         # waitFor + waitForFirstOf as a single interleaved poll loop (findElements->[]), throws TimeoutError with BranchProgress
      index.ts
    tests/                 # browser-backed; skip when no chromedriver; instantiates the conformance suite
  conformance/                           # @sentinel/conformance — driver-agnostic shared test suite (dev-only)
    package.json   tsconfig.json
    src/
      suite.ts             # runDriverConformance(opts) — parameterized over a session factory + fixture loader
      fixtures.ts          # the shared login-like HTML fixtures (string constants reused by both drivers)
      index.ts
```

**Dependencies:** `@sentinel/driver-selenium` deps: `selenium-webdriver@^4.44.0` (+ devDep `@types/selenium-webdriver`), `@sentinel/contracts`, `@sentinel/core`. `@sentinel/conformance` deps: `@sentinel/contracts`, `@sentinel/core` (+ `@playwright/test` as the test runner — see lint note). Neither imports the other driver.

**tsconfig:** add both packages to root `tsconfig.json` references and `tsconfig.base.json` `paths` (`@sentinel/driver-selenium`(+`/*`), `@sentinel/conformance`(+`/*`)). `tsconfig.eslint.json` already globs `packages/*/{src,tests}`.

**ESLint boundary:** add a `no-restricted-imports` block (mirroring the driver-playwright exemption at `eslint.config.cjs:97-110`) so `selenium-webdriver` is allowed only under `packages/driver-selenium/**`, and is **banned** in contracts/core/ai/conformance/driver-playwright. `@sentinel/conformance/src/**` is a test-support module that uses `@playwright/test` (the runner) — add it to the test-runner exemption so the Playwright-import ban doesn't fire there (it imports the runner only, never a driver).

---

## 3. Contract refinements (C-3)

### 3a. Per-action timeout (`packages/contracts/src/action.ts`)

```ts
export interface ActionOptions {
  /** Upper bound for reaching actionable state; clamped to SessionConfig.defaultTimeoutMs. */
  readonly timeoutMs?: number;
}

export interface Action {
  tap(target: Locator, opts?: ActionOptions): Promise<void>;
  typeText(target: Locator, text: string, opts?: ActionOptions): Promise<void>;
  clear(target: Locator, opts?: ActionOptions): Promise<void>;
  read(target: Locator, opts?: ActionOptions): Promise<string>;
  // gesture methods unchanged (still optional/gated)
}
```

- **Playwright impl:** pass `Math.min(opts?.timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs)` as the `timeout` to the underlying pw call (auto-wait already does actionability).
- **Selenium impl (defines the semantics for a no-auto-wait driver):** "action timeout" = the budget to reach **actionable** state = located ∧ displayed ∧ enabled. Before `click/sendKeys/clear/getText`, `await driver.wait(until.elementIsVisible(el) && elementIsEnabled, t)` with `t = Math.min(opts?.timeoutMs ?? defaultTimeoutMs, defaultTimeoutMs)`; on exceed → `TimeoutError`. This is the explicit answer to "what does an action timeout mean without auto-wait."
- Existing call sites pass no opts → behavior unchanged.

### 3b. `Locator.within` optional (`packages/contracts/src/locator.ts`)

```ts
export interface Locator {
  readonly logicalName: string;
  readonly candidates: readonly LocatorStrategy[];
  readonly minScore?: number;
  within?(parent: Locator): Locator; // was required; now optional
}
```

- Delete the `defineLocator` wrapper in `examples/web-erpnext/src/domain/auth/locators.ts`; locator literals become plain objects (`satisfies Record<string, Locator>` still holds).
- `packages/contracts/tests/capability-locator.test.ts:65` → guard `child.within?.(parent)` (skip the assertion when absent, or test it on a locator that defines it).

### 3c. `@playwright/test` peerDependency (`packages/driver-playwright/package.json`)

Move `@playwright/test` from `dependencies` to both `peerDependencies` (`"^1.58.2"`) and `devDependencies` (for the package's own tests). Workspace install still resolves it from the root. The driver-playwright wiring test that asserts the dependency placement updates accordingly.

---

## 4. Drift-semantics fix (C-2)

### The problem (verified)

`resolver.ts:94` computes `degraded = winner.rank > 0` (absolute rank). `rules.ts:129-132` flags drift on `(e.degraded || e.resolvedRank > 0)`. A css/xpath-only driver resolves **everything** at rank 6 with higher-rank kinds `skipped` → today it would flag **every** resolution as `selector-drift` and set `flow.finished.didDegrade` true for every run. That is a false positive that would make the analyzer useless on driver #2.

### The fix

**Degradation = the resolved candidate was beaten by a more-durable candidate that was tried and `missed` — NOT one that was `skipped` (unsupported).** The data is already on the wire (`candidates[].outcome`).

**Required — `@sentinel/ai/src/classify/rules.ts`:** replace the degradation predicate. A `locator.resolved` event is drift iff:

```ts
function isDrift(e: LocatorResolvedEvent): boolean {
  return e.candidates.some(
    (c) => c.outcome === "missed" && c.rank < e.resolvedRank,
  );
}
```

Use `isDrift` for both the per-event `selector-drift` verdicts and the run-level `degraded` aggregate (stop trusting `e.degraded || e.resolvedRank > 0`, and stop trusting `flow.didDegrade` as a drift source — the resolution scan is authoritative).

- css/xpath-only driver: rank-6 win, all higher `skipped` → no `missed` below 6 → **not drift**. ✓
- Playwright slice-A/B drift (role `missed`@0, css `matched`@6): role missed, rank 0 < 6 → **drift**. ✓ Preserved.

**Optional but recommended — `packages/driver-playwright/src/resolver.ts:94`** (and the new selenium resolver): align the emitted `degraded` boolean so it is honest for limited-strategy drivers:

```ts
const degraded = records.some(
  (r) => r.outcome === "missed" && r.rank < winner.rank,
);
```

Behaviorally identical for the locked Playwright resolver tests (role missed@0 beats css matched@6 → true; clean rank-0 win → false), and prevents a misleading `degraded:true` on every css-only event. Both drivers emit the same enriched, honest boolean — schema unchanged.

**`flow.finished.didDegrade`:** the example flow currently hardcodes `false` (`log-in.ts`). Leave the field; the analyzer no longer relies on it for drift (the resolution scan is the source of truth). Optionally compute it in the flow from the same missed-below-resolved test if convenient — not required for correctness.

### Regression test (the proof)

Add to `packages/ai/tests/rules.test.ts`: a run whose `locator.resolved` has only `skipped` candidates above a `matched` rank-6 candidate (no `missed`) → assert **no `selector-drift` verdict** and run `degraded:false`. This locks the css-only-driver guarantee. All existing drift tests (role-missed cases) stay green unchanged.

---

## 5. The selenium driver (`@sentinel/driver-selenium`)

### Bootstrap (`driver.ts`)

`SeleniumDriver`: `name="selenium"`; capabilities `{navigation, dom, screenshot}` (NOT `accessibilityTree` — no role engine; gestures/contexts absent); `strategies = {testid, css, xpath, text, label, placeholder, altText, title}` (**NOT `role`**). `createSession(config, sink)`:

```ts
import { Builder, Browser } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
const options = new Options().addArguments(
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--window-size=1280,800",
);
const driver = await new Builder()
  .forBrowser(Browser.CHROME)
  .setChromeOptions(options)
  .build();
```

`SessionConfig.existingDriver?` (analogous to `existingPage?`) lets a test/flow pass a pre-built `WebDriver` (the single guarded duck-type/`as` point, throwing `DriverSessionError` on mismatch); otherwise build one. `sessionId` adopted for `Session.id` as in driver-playwright. **Teardown:** `session.end()` calls `driver.quit()` (must run or chromedriver leaks).

> **Note on `SessionConfig`:** `existingDriver?: unknown` is added alongside `existingPage?: unknown` (both Slice-tool-specific escape hatches). This is a minimal additive contract change in the same spirit as `existingPage`; flagged in §9 open questions in case a single generic `existingHandle?` is preferred.

### Strategy compiler (`strategy-compiler.ts`) — kind → `By`

`$v`=value, `$n`=options.name, `$exact`=options.exact (xpath embedded quotes escaped via `concat()` when needed):

| kind          | By            | template                                                                                                                                   |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `testid`      | css           | `[data-testid="$v"]`                                                                                                                       |
| `css`         | css           | `$v`                                                                                                                                       |
| `xpath`       | xpath         | `$v`                                                                                                                                       |
| `placeholder` | css           | exact `[placeholder="$v"]`, else `[placeholder*="$v"]`                                                                                     |
| `altText`     | css           | exact `[alt="$v"]`, else `[alt*="$v"]`                                                                                                     |
| `title`       | css           | exact `[title="$v"]`, else `[title*="$v"]`                                                                                                 |
| `text`        | xpath         | exact `.//*[normalize-space(.)="$v"]`, else `.//*[contains(normalize-space(.),"$v")]` (substring default, matching Playwright `getByText`) |
| `label`       | xpath (union) | `label[for]→#id` ∪ wrapping-label ∪ `[aria-label]` ∪ single-id `aria-labelledby` (multi-token `aria-labelledby` documented gap)            |
| `role`        | —             | **not advertised** → resolver records `skipped`                                                                                            |

Compiler throws `UnsupportedStrategyError` for any kind not in the table; the resolver catches "not advertised" _before_ compiling (records `skipped`), so the compiler only ever sees advertised kinds.

### Resolver (`resolver.ts`) — schema-identical emission

Walk `locator.candidates` in order: kind ∉ `driver.strategies` → record `{kind, outcome:"skipped", rank}`; else compile to `By`, `await driver.findElements(by)` → length 0 = `missed`, 1 = `matched` (winner), >1 = `SelectorAmbiguousError` with `attempted[]`. First `matched` wins. Compute `degraded` per the aligned definition (§4). **Emit `locator.resolved` BEFORE returning the handle**, with `candidates[]`/`resolvedKind`/`resolvedRank`/`degraded`/`resolveDurationMs` (hrtime). All `skipped`/`missed` → `SelectorNotFoundError` with `attempted[]`. Identical event shape to driver-playwright.

### Actions (`action.ts`) — explicit actionability (no auto-wait)

Each verb: resolve (emits `locator.resolved`) → re-find the `WebElement` → `await driver.wait(until.elementIsVisible(el), t)` then `elementIsEnabled` (`t` per §3a) → `click()` / `sendKeys(text)` / `clear()` / `getText()`. This is the concrete no-auto-wait actionability the Action timeout governs.

### Assertion (`assertion.ts`) — the interleaved serial poll loop

`waitFor(target, state, opts)`: poll until deadline — resolve candidates via `findElements` (→`[]`, no throw), check the `ElementState` (`attached` = found; `visible` = `isDisplayed()`; `hidden`/`detached` = negation; `enabled` = `isEnabled()`); on satisfy → emit `assertion{matched:true}` + return; on deadline → emit `assertion{matched:false, branchProgress}` + **throw `TimeoutError`** (never resolve on timeout).

`waitForFirstOf(conditions, opts)`: **one sequential loop** (the design slice A anticipated for serial drivers — zero detached promises, zero unhandled rejections): until deadline, for each condition in order, attempt resolve+state-check via `findElements`; first satisfied → emit the winning `assertion` + return its label; track each branch's closest `reachedState`; on deadline with no winner → emit `assertion` with per-branch `BranchProgress[]` + **throw `TimeoutError`**. Poll slice floored at ≥1ms (mirror the driver-playwright `Math.max(1, …)` guard).

### Telemetry wiring

`SeleniumSession` constructs `new StampingSink(new SpanContext(this.id), sink)` and threads it to resolver/action/assertion — identical to `PlaywrightSession`. Events are schema-identical; the existing analyzer + JSONL fixture remain valid.

---

## 6. Shared conformance suite (`@sentinel/conformance`)

`runDriverConformance(opts)` — a function that registers a `describe` of contract tests, parameterized so any driver instantiates it:

```ts
export interface ConformanceOptions {
  readonly name: string; // "playwright" | "selenium"
  readonly available: () => boolean | Promise<boolean>; // browser/driver present?
  /** Build a ready Session over the given fixture HTML, wired to the supplied sink. */
  readonly makeSession: (
    html: string,
    sink: TelemetrySink,
  ) => Promise<{ session: Session; cleanup: () => Promise<void> }>;
}
export function runDriverConformance(opts: ConformanceOptions): void;
```

If `!available()` → register the suite with `test.skip` (clean skip, like the key-gated Claude test) so CI without browsers passes. Each driver's test file:

```ts
// packages/driver-playwright/tests/conformance.test.ts
runDriverConformance({
  name: "playwright",
  available: () => true,
  makeSession: async (html, sink) => {
    /* browser, page.setContent(html), PlaywrightDriver.createSession({existingPage}, sink) */
  },
});
// packages/driver-selenium/tests/conformance.test.ts
runDriverConformance({
  name: "selenium",
  available: hasChromedriver,
  makeSession: async (html, sink) => {
    /* driver.get("data:text/html,"+encodeURIComponent(html)); SeleniumDriver.createSession({existingDriver}, sink) */
  },
});
```

**Asserted behaviors** (driver-agnostic, against `fixtures.ts` HTML + an injected `InMemorySink`): resolver emits `locator.resolved` **before** the handle is usable; `skipped` for unadvertised kinds vs `missed` for absent supported kinds; resolved candidate trail + `degraded` per §4; `waitFor` throws `TimeoutError` (never resolves) on a missing element; `waitForFirstOf` returns the reachable branch's label and, on no winner, throws `TimeoutError` with `BranchProgress[]` and **zero unhandled rejections**; `tap`/`typeText`/`clear`/`read` operate; telemetry envelopes are schema-identical (same event types/fields). The selenium run additionally demonstrates the §4 guarantee: a `role`-first locator with a css fallback resolves via css **without** a drift verdict (role was `skipped`, not `missed`).

**Fixtures** (`fixtures.ts`): shared login-like HTML with **proper `<label for>` associations** (so `label` compiles and resolves on selenium, not just css fallback), a `.page-card-body.invalid` state, and a `div.desktop-wrapper` app shell — reused by both drivers (Playwright via `setContent`, selenium via `data:` URL). Runtime budget: selenium ~2-4s/session warm; use one session per `describe` where possible; total suite added wall-clock target < ~30s warm.

---

## 7. Auth-flow-on-selenium proof

Demonstrate the **same** `logIn` flow logic runs on selenium via the existing `opts.createSession` seam: a test builds a `SeleniumDriver` session over a `data:`-loaded login fixture and calls `logIn(driverHandle, creds, { createSession: seleniumCreateSession, sink })`, asserting it returns the rich `LoginResult` and emits schema-identical telemetry. This is the headline proof: unchanged flow + unchanged contracts + a completely different driver. (Skips when no chromedriver.)

> The flow signature is `logIn(page, …)`; the `page` parameter is the caller-supplied driver handle threaded into `createSession`. If the parameter name/typing needs generalizing from `Page` to `unknown`/a handle type for the selenium path, that is a small, expected generalization — captured in the sub-steps.

---

## 8. Testing strategy & acceptance criteria

1. `npm run typecheck` 0; `npm run lint` 0 (selenium import confined to `packages/driver-selenium/**`; conformance uses only the runner).
2. `npm run test:unit` green: the **existing 150 tests stay green** (the drift-fix preserves Playwright behavior — name any that change: only the new `rules.test.ts` regression case is added; the resolver `degraded` alignment must keep `resolver.test.ts` green), plus the new selenium unit tests + the conformance suite for **both** drivers + the auth-on-selenium proof.
3. **Drift-fix proof:** the css-only-style regression test (only-`skipped`-above-`matched` → no drift) passes; the existing role-missed drift tests pass unchanged.
4. **Graceful skip:** with no chromedriver available, the selenium conformance + auth-on-selenium tests `skip` (not fail); CI stays green. With chromedriver (Selenium Manager auto-provisions; network once), they run and pass.
5. **Contract refinements:** action `timeoutMs` honored by both drivers; `defineLocator` removed and locators are plain literals; `@playwright/test` is a peerDep (+devDep) and the wiring test reflects it.
6. **Conformance parity:** both drivers pass the identical suite; telemetry schema identity asserted.

---

## 9. Residual risks & deferred

- **Selenium flake / browser provisioning:** mitigated by one-session-per-describe, explicit waits, `quit()` teardown, and graceful skip when absent. First local run needs network (~15s chromedriver fetch); cached after.
- **`label` xpath emulation gap:** multi-token `aria-labelledby` not supported (documented); covers the example's plain-`<label>` forms.
- **`existingDriver?` additive to `SessionConfig`** — see §9 open question (generic handle vs per-driver field).
- **`role` unsupported on selenium** is by design (honest skip), not a gap to fix.
- **Deferred (not this slice):** WebdriverIO as a third driver; Appium/mobile; the `@sentinel/ai` merge-by-key reconciliation; cross-run flake trends; reporting sinks; CLI scaffolding.

## 9b. Open questions for the user

1. **`existingDriver?` vs generic `existingHandle?`:** add a selenium-specific `existingDriver?: unknown` to `SessionConfig` (mirrors `existingPage?`), or refactor both into one generic `existingHandle?: unknown`? _Default:_ add `existingDriver?` (minimal, consistent with the existing `existingPage?` precedent).
2. **`logIn(page, …)` parameter generalization:** rename the first param's type from `Page` to `unknown`/a handle alias for the selenium path? _Default:_ widen the type to `unknown` (the driver duck-types it), keep the name `page` for call-site stability or rename to `handle` — minor.

---

## 10. Ordered implementation sub-steps

1. **C1 — Contract refinements + drift-semantics fix (no new driver yet).** `ActionOptions` + per-action `timeoutMs` (contracts + PlaywrightAction clamp); `Locator.within` optional + drop `defineLocator`; `@playwright/test` peerDep; the §4 `rules.ts` `isDrift` change + resolver `degraded` alignment + the regression test. Acceptance: existing 150 tests green (modulo the named additions), typecheck/lint green. **This sub-step changes shared code only — the riskiest for regressions, so it gets the full two-stage review.**
2. **C2 — `@sentinel/driver-selenium` package skeleton + wiring** (package.json, tsconfig, root refs, paths, eslint selenium-import boundary, `export {}` seed, `@types/selenium-webdriver`). Acceptance: tsc -b + lint green; `npm install` resolves selenium.
3. **C3 — strategy-compiler** (kind → `By`, the §5 table) + pure unit tests (no browser): assert generated css/xpath strings per kind/exact; `role`/unknown → throws/unsupported.
4. **C4 — resolver + element + telemetry emission** (skipped/missed/matched/ambiguous, emit-before-handle, `degraded` per §4) — browser-backed tests, skip-when-absent.
5. **C5 — actions + assertion serial poll loop** (explicit actionability; `waitFor`/`waitForFirstOf` totality, throws on timeout, zero unhandled rejections) — browser-backed.
6. **C6 — `@sentinel/conformance` suite + fixtures**; instantiate for driver-playwright (proves the suite passes the already-trusted driver) **and** driver-selenium; assert schema identity + the §4 selenium drift guarantee.
7. **C7 — auth-flow-on-selenium proof** + final acceptance (§8).

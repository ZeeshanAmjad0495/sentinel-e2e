# Sentinel Slice C — Second Driver (`@sentinel/driver-selenium`) + Conformance Suite: Design Spec

- **Status:** Approved (adversarially-synthesized; supersedes the initial hand-authored draft)
- **Date:** 2026-06-10
- **Branch:** `feat/slice-c-second-driver` (off `main`; slices A + B merged)

> This spec is the synthesis of a 10-agent design workflow (3 verified-research + 3 competing designs + 3 adversarial lenses + synthesis). It is prescriptive enough to also serve as the implementation guide; sub-steps C1–C10 (§10) are executed directly.

---

# SLICE C — FINAL DESIGN: Second Web Driver + Shared Cross-Driver Conformance Suite

## (0) Locked decisions

| #   | Decision                                                                                                                                                                                                                            | One-line justification (verified against repo)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D0  | **Driver #2 = `selenium-webdriver@^4` (`@sentinel/driver-selenium`)** — chosen autonomously                                                                                                                                         | No auto-wait forces _real_ actionability code (exposes Playwright-isms instead of hiding them); `findElements→[]` is the ideal poll primitive; css/xpath-only is the forcing function for the drift fix. WebdriverIO is rejected on hard evidence: `package-wiring.test.ts` documents that dynamic `import()` of a bare specifier throws `SyntaxError` under this repo's TS-source loader, so WDIO-v9-ESM-via-dynamic-import is unproven-to-broken here; selenium is CommonJS. |
| D1  | **Drift fix = pure-outcome predicate + resolver one-liner; NO event-schema change**                                                                                                                                                 | Keeps `LocatorResolvedEvent` byte-identical for driver #2; analyzer reasons only about `candidates[].outcome`. Verified to keep all locked `rules.test.ts` + `invalid-run.jsonl` cases green. **Reject P3's `baselineRank` field** (it breaks the `locatorResolved` test factory typecheck and makes the jsonl fixture non-representative, for zero analyzer benefit).                                                                                                         |
| D2  | **Action `timeoutMs` semantics PINNED in the contract**: bounds time-to-**actionable** — located+displayed+enabled for `tap`/`typeText`/`clear`, located (attached) for `read` — clamped to `min(opts.timeoutMs, defaultTimeoutMs)` | The contract has no actionability concept today; without pinning, the same `timeoutMs` would mean different things per driver. Conformance suite asserts it identically on both.                                                                                                                                                                                                                                                                                               |
| D3  | **`waitForFirstOf` = single interleaved poll loop** (one promise chain) for Selenium                                                                                                                                                | Structurally zero unhandled rejections (no sibling promises to leak); totality met by construction, not by careful loser-cancellation. Conformance suite asserts only observable behavior, never the 1ms-slice/auto-wait internals.                                                                                                                                                                                                                                            |
| D4  | **Session-adoption seam = additive `existingSession?: unknown` on `SessionConfig`** (not `existingPage` duck-typing)                                                                                                                | `existingPage` is documented "Playwright Page" and the Playwright guard keys on `goto`+`locator`; a future Appium driver has no `get`/page. Additive + backward-compatible; Playwright keeps using `existingPage`, Selenium reads `existingSession ?? existingPage`.                                                                                                                                                                                                           |
| D5  | **`@playwright/test` → peer+dev dependency** AND **update `package-wiring.test.ts`**                                                                                                                                                | The locked test asserts `dependencies["@playwright/test"]` is truthy — refinement (c) _breaks it_; the test must assert `peerDependencies` instead. (No prior design caught this.)                                                                                                                                                                                                                                                                                             |
| D6  | **Shared conformance suite** lives at `packages/contracts/tests/conformance/` as a parameterized factory; per-driver thin adapters instantiate it                                                                                   | `packages/**/tests/**` is already lint-exempt; the factory imports `@playwright/test` (runner) + contracts only, never a driver SDK.                                                                                                                                                                                                                                                                                                                                           |
| D7  | **Browser-driver specs are gated + serialized + long-timeout**                                                                                                                                                                      | Repo has **no `.github/workflows`** and unit config has **no global timeout** + `fullyParallel:true` with no worker cap. Gate via `SENTINEL_SELENIUM=1` (mirroring the verified `ANTHROPIC_API_KEY ? test : test.skip` precedent), `describe.configure({mode:'serial', timeout:60_000})`, teardown in `try/finally`.                                                                                                                                                           |

---

## (1) Overview & principles

Prove "tool-agnostic" is real by running the **unchanged contracts** on a maximally-different second web driver and extracting a **shared conformance suite** both drivers pass. Principles:

1. **Contract honesty** — Selenium implements the literal `Driver`/`Session`/`Action`/`Assertion`/`ElementHandle`/`LocatorResolver` surfaces; any concept the contract lacks (actionability) is _added to the contract_, not invented per-driver.
2. **Schema identity by construction** — both drivers build telemetry envelopes from the same `@sentinel/core` types through the same `StampingSink`; zero new event fields.
3. **Analyzer stays driver-agnostic** — it reads `candidates[].outcome`, never driver capabilities; `role` is honestly **skipped** (never faked).
4. **Refinements folded in now** — cheapest before a 2nd driver multiplies their cost.
5. **TDD, conventional commits**, all under the existing Playwright unit runner.

---

## (2) Package layout + wiring

### 2.1 New package `packages/driver-selenium/`

```
packages/driver-selenium/
  package.json  tsconfig.json
  src/ index.ts driver.ts session.ts resolver.ts element.ts
       action.ts assertion.ts strategy-compiler.ts actionability.ts
  tests/ strategy-compiler.test.ts resolver.test.ts assertion-firstof.test.ts
         action.test.ts package-wiring.test.ts contract.test.ts
```

`package.json` (selenium is a real runtime `dependency` — it bundles Selenium Manager; it has no peer story, unlike Playwright-the-test-runner):

```jsonc
{
  "name": "@sentinel/driver-selenium",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "engines": { "node": ">=20" },
  "dependencies": {
    "selenium-webdriver": "^4.44.0",
    "@sentinel/contracts": "*",
    "@sentinel/core": "*",
  },
  "devDependencies": { "@types/selenium-webdriver": "^4.1.28" },
}
```

`tsconfig.json`: extends base, `composite:true`, `references` to contracts+core, `include:["src/**/*.ts"]`.

### 2.2 tsconfig wiring

- **`tsconfig.base.json` `paths`**: add `"@sentinel/driver-selenium": ["packages/driver-selenium/src/index.ts"]` (+ `/*`).
- **Root `tsconfig.json` `references`**: add `{ "path": "packages/driver-selenium" }`.
- **`tsconfig.eslint.json`**: no edit (already globs `packages/*/src` + `packages/*/tests`).
- **`examples/web-erpnext/tsconfig.json`**: add the `@sentinel/driver-selenium` path entries (anchored to `../../packages/...`, like its sibling overrides) so the example Selenium proof test resolves; add the `{ "path": "../../packages/driver-selenium" }` reference.

### 2.3 Lint boundary (`eslint.config.cjs`) — three edits

1. **App-code block** (the `paths` array currently banning `@playwright/test`/`playwright`): add `{ name: 'selenium-webdriver', message: 'Selenium is confined to @sentinel/driver-selenium and test-runner dirs.' }` plus a `patterns: [{ group: ['selenium-webdriver', 'selenium-webdriver/*'], message: ... }]` (catches deep imports like `selenium-webdriver/chrome`).
2. **`@sentinel/ai/src` block**: add the same `selenium-webdriver` path entry. The existing `patterns: ['@sentinel/driver-*']` already bans `@sentinel/driver-selenium` from the analyzer — no change there.
3. **Exemption block** (`no-restricted-imports: off`): add `'packages/driver-selenium/**/*.ts'`. (`packages/**/tests/**` already covers the conformance suite + example tests.)

A `package-wiring.test.ts` in the selenium package asserts the barrel exports `SeleniumDriver` and that `selenium-webdriver` is a `dependency`.

---

## (3) Contract refinements — exact diffs

### (a) `ActionOptions` + actionability semantics — `packages/contracts/src/action.ts`

```ts
/**
 * Per-action bound. `timeoutMs` bounds the time to make the target ACTIONABLE:
 *  - tap / typeText / clear: located + displayed + enabled
 *  - read: located (attached)
 * Effective timeout = min(timeoutMs, SessionConfig.defaultTimeoutMs) — a caller may
 * only TIGHTEN, never exceed, the session bound. Auto-wait drivers (Playwright) satisfy
 * this by passing { timeout } to the SDK call; no-auto-wait drivers (Selenium) satisfy it
 * by polling to that deadline before performing the verb.
 */
export interface ActionOptions {
  readonly timeoutMs?: number;
}

export interface Action {
  tap(target: Locator, opts?: ActionOptions): Promise<void>;
  typeText(target: Locator, text: string, opts?: ActionOptions): Promise<void>;
  clear(target: Locator, opts?: ActionOptions): Promise<void>;
  read(target: Locator, opts?: ActionOptions): Promise<string>;
  // gestures unchanged
}
```

Optional ⇒ backward compatible; `LogInForm` compiles unchanged.

### (b) `Locator.within` optional — `packages/contracts/src/locator.ts`

```ts
within?(parent: Locator): Locator; // OPTIONAL: scoping/chaining when supported
```

**Verified safe**: grep shows **zero** `.within(` call sites in any `src`; the only `within` _definitions_ are in the example `locators.ts` (dropped, see §3 example) and the contract test (kept, see §4 test list).

**Example** — `examples/web-erpnext/src/domain/auth/locators.ts`: delete `defineLocator`; author plain literals. The `locators.test.ts` assertions (logicalName, css fallbacks, invalid candidate order, appShell) are **unaffected** — they read `.logicalName`/`.candidates`, never `.within`:

```ts
export const loginLocators = {
  username: {
    logicalName: "auth.login.username",
    candidates: [
      { kind: "label", value: "Email" },
      { kind: "css", value: "input#login_email[autocomplete='username']" },
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
  invalid: {
    logicalName: "auth.login.invalidState",
    candidates: [
      {
        kind: "css",
        value: ".page-card-body.invalid .btn-login[type='submit']",
      },
      { kind: "text", value: "Invalid Login. Try again." },
    ],
  },
} satisfies Record<string, Locator>;
export const appShellLocators = {
  ready: {
    logicalName: "auth.appShell.ready",
    candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
  },
} satisfies Record<string, Locator>;
```

### (c) `@playwright/test` peer — `packages/driver-playwright/package.json`

```jsonc
"dependencies": { "@sentinel/contracts": "*", "@sentinel/core": "*" },
"peerDependencies": { "@playwright/test": "^1.58.2" },
"devDependencies": { "@playwright/test": "^1.58.2" }
```

Root devDepends on `@playwright/test@^1.58.2` ⇒ peer satisfied hoisted. **Must-fix (D5)**: `packages/driver-playwright/tests/package-wiring.test.ts` currently asserts `pkg.dependencies?.["@playwright/test"]` — change to `expect(pkg.peerDependencies?.["@playwright/test"]).toBeTruthy()`.

### (d) Session-adoption seam — `packages/contracts/src/session.ts`

```ts
/** Additive, driver-opaque: a pre-built driver session a driver may ADOPT (e.g. a Selenium
 *  WebDriver). Preferred over overloading existingPage for non-Page drivers. */
readonly existingSession?: unknown;
```

Playwright unchanged (reads `existingPage`). Selenium reads `config.existingSession ?? config.existingPage` and duck-types a `WebDriver` by `findElements`/`get` presence — but via the _dedicated_ field so a Page is never misclassified and a future driver isn't forced through a Page-shaped hole.

### Playwright wiring for (a) — `packages/driver-playwright/src/action.ts` + `session.ts`

`PlaywrightAction` constructor gains `defaultTimeoutMs` (2nd arg). Each verb threads `{ timeout: clamp(opts) }`:

```ts
constructor(private readonly resolver: LocatorResolver, private readonly defaultTimeoutMs: number) {}
private clamp(o?: ActionOptions): number { return Math.min(o?.timeoutMs ?? this.defaultTimeoutMs, this.defaultTimeoutMs); }
async tap(t, opts?)        { await (await this.pwLocator(t)).click({ timeout: this.clamp(opts) }); }
async typeText(t, x, opts?){ await (await this.pwLocator(t)).fill(x, { timeout: this.clamp(opts) }); }
async clear(t, opts?)      { await (await this.pwLocator(t)).fill("", { timeout: this.clamp(opts) }); }
async read(t, opts?)       { const l = await this.pwLocator(t); /* read = attached-only: inputValue/textContent, no visible/enabled gate (matches D2) */ ... }
```

`session.ts:` `new PlaywrightAction(this.resolver, opts.defaultTimeoutMs)`. **Must-fix**: `action.test.ts` constructs `new PlaywrightAction(new PlaywrightResolver(...))` (one arg) — update to pass a `defaultTimeoutMs` (e.g. `5000`). (Driver-package test, not a contract lock; safe to edit.)

---

## (4) Drift-semantics fix — exact changes, before/after, green proof

**Rule:** degradation = a more-durable candidate the driver **tried and MISSED** beat the winner; `skipped` (unsupported) never counts.

### 4.1 Event JSDoc only — `packages/core/src/telemetry/signals.ts` (no type change)

```ts
resolvedRank: number; // rank of the winning candidate (0 = most durable)
degraded: boolean;    // a more-durable candidate the driver TRIED was MISSED (skipped != degraded)
...
didDegrade: boolean;  // true iff any locator.resolved was `degraded` by the above rule
```

### 4.2 Resolver — `packages/driver-playwright/src/resolver.ts:94` (and identical in Selenium resolver)

**Before:** `const degraded = winner.rank > 0;`
**After:** `const degraded = records.some((r) => r.outcome === "missed" && r.rank < winner.rank);`

### 4.3 Analyzer — `packages/ai/src/classify/rules.ts` (replace the filter at ~129-134)

```ts
function isDrift(e: LocatorResolvedEvent): boolean {
  return e.candidates.some(
    (c) => c.outcome === "missed" && c.rank < e.resolvedRank,
  );
}
const degradedResolutions = events.filter(
  (e): e is LocatorResolvedEvent => isType(e, "locator.resolved") && isDrift(e),
);
const degraded = degradedResolutions.length > 0; // DROP `|| flow?.didDegrade`: resolution scan is the sole source of truth
```

Rationale for dropping the `didDegrade` OR (D1, P2's stance): the flow **hardcodes `didDegrade:false`** (`log-in.ts` lines for both branches), so the OR is dead for real runs; dropping it removes the only path by which a future css-only run could re-leak false drift through the flow boolean.

### 4.4 Before/after — proof the existing 150 tests stay green

| Locked case                                        | candidates                          | old `degraded`/drift                            | new `isDrift`                   | Verdict                              |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ------------------------------- | ------------------------------------ |
| `rules.test.ts` silent-drift                       | label missed@0, css matched@6       | true / drift                                    | missed@0 < 6 ⇒ **true**         | drift + healthy ✓                    |
| `rules.test.ts` clean rank-0                       | `[]`, rank 0                        | false                                           | no missed-below ⇒ **false**     | purely healthy, `degraded:false` ✓   |
| `rules.test.ts` multi-drift                        | 2× (label missed@0, css matched@6)  | true                                            | 2× true                         | business-outcome + 2 drift ✓         |
| `e2e.test.ts` + `invalid-run.jsonl`                | label missed@0 … css matched@6 (×2) | true                                            | missed@0 < 6 ⇒ true (×2)        | business-outcome + 2 drift ✓         |
| `resolver.test.ts` "degraded when primary missing" | role missed@0, css matched@6        | `winner.rank>0`⇒true                            | missed@0 < 6 ⇒ **true**         | `resolution.degraded === true` ✓     |
| `resolver.test.ts` "skips unadvertised"            | image **skipped**, css matched@6    | (rank>0) was true but test only asserts outcome | skipped not missed ⇒ won't flag | asserts `outcome==="skipped"` only ✓ |

**Tests that MUST CHANGE and why:** none of the above. The only changed tests are infrastructural (D5 `package-wiring`, action ctor) and **new** tests (below). No assertion in `rules.test.ts`/`resolver.test.ts`/`e2e.test.ts` flips.

### 4.5 NEW regression tests (the fix's proof)

- `rules.test.ts` + **"css-only driver: skipped top candidate is not drift"**: `candidates:[{role,skipped,0},{label,skipped,1},{css,matched,6}]`, `resolvedRank:6`, `flow.finished{success}` ⇒ **no `selector-drift`**, `degraded:false`, `healthy` present.
- `rules.test.ts` + **"didDegrade alone does not produce a drift verdict"**: `flow.finished{success, didDegrade:true}` with no `locator.resolved` ⇒ no `selector-drift` verdict (locks the outcome-only reasoning).
- `resolver.test.ts` (selenium) + **"skipped top candidate ⇒ degraded:false"**.

---

## (5) The Selenium driver design

### 5.1 Bootstrap & session adoption — `driver.ts` / `session.ts`

`SeleniumDriver.createSession(config, telemetry)` adopts `config.existingSession ?? config.existingPage`, duck-typed `isWebDriver = typeof c.findElements === "function" && typeof c.get === "function"`; else throws `DriverSessionError` (mirrors `PlaywrightDriver`). `SeleniumSession` wires telemetry **identically**: `this.telemetry = new StampingSink(new SpanContext(this.id), telemetry)`; `id = config.sessionId ?? randomUUID()`; builds `ctx = {correlationId:this.id, flowName, startedAt}`; constructs resolver/action/assertion with the stamped sink and `defaultTimeoutMs`. `end()` is a no-op (the test owns `driver.quit()` — same lifecycle stance as Playwright's page-wrap).

Advertised sets:

```ts
const STRATEGIES = new Set<StrategyKind>([
  "css",
  "xpath",
  "testid",
  "text",
  "label",
  "placeholder",
  "altText",
  "title",
]); // NOT "role","relative"
const CAPABILITIES = new Set<Capability>(["navigation", "dom", "screenshot"]); // NOT accessibilityTree/gestures/contexts/networkInspection
```

### 5.2 Strategy compiler — pure, returns a `By` descriptor (unit-testable, no browser)

Returns `{ using, value }` (structurally Selenium's `By`); a `toBy()` factory wraps it. Defaults to **substring** (Playwright parity) unless `options.exact === true`. `xpathLiteral()` handles embedded quotes via `concat()`; `cssEsc()` escapes `"`/`\`. Throws on any kind not in the table (defense in depth, like Playwright's `default: throw`).

| kind          | using          | template (exact / substring)                                                |
| ------------- | -------------- | --------------------------------------------------------------------------- |
| `css`         | `css selector` | `$v`                                                                        |
| `xpath`       | `xpath`        | `$v`                                                                        |
| `testid`      | `css selector` | `[data-testid="$v"]` (always exact)                                         |
| `placeholder` | `css selector` | `[placeholder="$v"]` / `[placeholder*="$v"]`                                |
| `title`       | `css selector` | `[title="$v"]` / `[title*="$v"]`                                            |
| `altText`     | `css selector` | `[alt="$v"]` / `[alt*="$v"]`                                                |
| `text`        | `xpath`        | `.//*[normalize-space(.)=$lit]` / `.//*[contains(normalize-space(.),$lit)]` |
| `label`       | `xpath`        | union below                                                                 |

`label` union (for/id + wrapping + aria-label + single-token aria-labelledby), `$m = normalize-space()=$lit` (exact) or `contains(normalize-space(),$lit)`:

```
//input[@id=//label[$m]/@for] | //textarea[@id=//label[$m]/@for] | //select[@id=//label[$m]/@for]
| //label[$m]//input | //label[$m]//textarea | //label[$m]//select
| //*[@aria-label=$lit] | //*[@aria-labelledby=//*[$m]/@id]
```

**Note (honest, per analyzer lens):** in the ERPNext example the `label` candidate (rank 1, _supported_) is authored on `username`/`password`. The shared `login-dom.ts` fixtures have **no `<label>`** (only `autocomplete` inputs), so on Selenium `label` legitimately **misses** and css(6) wins ⇒ `isDrift` correctly fires **real** drift for username/password. The **`submit`** locator (role skipped → css matched) is the canonical _no-false-drift_ case. The example proof test (§7) therefore asserts: `submit` has `degraded:false`, and drift on username/password is _expected and correct_ (not a false positive). The no-false-drift guarantee is proven for the skip case, not over-claimed for label-miss.

### 5.3 Resolver — `SeleniumResolver implements LocatorResolver`

Near-clone of `PlaywrightResolver`: iterate candidates; `!strategies.has(kind)` → `skipped`; else `count = (await driver.findElements(toBy(compileStrategy(c)))).length`; `0`→`missed`, `>1`→`SelectorAmbiguousError`, first match→`matched` winner+break; all miss→`SelectorNotFoundError` with `attempted[]`. Ranks via the **shared `StrategyRegistry`** (globally consistent). Emits a `locator.resolved` envelope with the **identical field set + `schemaVersion:"1.0.0"`** and the 4.2 `degraded` rule, **BEFORE** returning the handle (locked by the resolver test + conformance suite). `SeleniumElementHandle` re-resolves per call via `driver.findElement(toBy(...))` (dodges stale-element; matches Playwright's compile-per-call).

### 5.4 Actionability without auto-wait — `actionability.ts` + `action.ts`

One shared `waitActionable(driver, by, {requireEnabled, deadline})` polling `findElements` in 50ms slices (absence = not-ready, never an exception, until the deadline → `TimeoutError`). `SeleniumAction` verbs resolve the target (emitting `locator.resolved`, telemetry parity), then `waitActionable` bounded by `clamp(opts)`:

- `tap`/`typeText`/`clear`: `requireEnabled:true` (located+displayed+enabled — D2).
- `read`: attached-only (D2) — tag-aware (`getAttribute("value")` for input/textarea/select, else `getText()`).

### 5.5 `waitFor` / `waitForFirstOf` — single interleaved poll loop (D3)

`waitForFirstOf` round-robins every branch each 50ms tick in **one** promise chain. A branch's error (ambiguous, etc.) is swallowed in a per-branch `try/catch` (never wins, never rejects the loop). First match → emit assertion + return label. Deadline with no winner → emit `matched:false` + `throwTimeout` with `BranchProgress[]` for **all** labels. **Zero unhandled rejections by construction** — there is literally no second promise. `waitFor` = the degenerate one-branch loop. `probeOnce` maps `ElementState`→Selenium checks (`attached`=`findElements>0`, `visible`=`isDisplayed`, `hidden`/`detached`=negations, `enabled`=`isDisplayed && isEnabled`), tracking `reachedState` via the same `STATE_ORDER`/`closest()` ladder so `branchProgress` feeds the analyzer's real-bug rule identically.

### 5.6 Telemetry — schema-identical

Zero invention. Same `StampingSink` keyed on `session.id` ⇒ `traceId == correlationId == Session.id`. Envelopes constructed field-for-field from `@sentinel/core` `LocatorResolvedEvent`/`AssertionEvent`. Flow events (`flow.started`/`finished`/`business.failure`) come from `log-in.ts` (driver-independent) ⇒ unchanged.

---

## (6) Shared cross-driver conformance suite

**Location:** `packages/contracts/tests/conformance/` — `harness.ts`, `fixtures.ts`, `driver-contract.ts` (factory), `playwright.contract.test.ts`, `selenium.contract.test.ts`. The factory imports `@playwright/test` (runner) + contracts only — **never a driver SDK** (the adapters do that, and they're lint-exempt under `packages/**/tests/**`).

**Harness:**

```ts
export interface DriverHarness {
  readonly name: string;
  readonly driver: Driver;
  open(
    fixtureUrl: string,
    sink: TelemetrySink,
    opts?: Partial<SessionConfig>,
  ): Promise<Session>;
  close(session: Session): Promise<void>;
}
export function defineDriverContract(makeHarness: () => DriverHarness): void {
  /* describes the spec */
}
```

- **Playwright adapter:** `browser.newPage()` → `page.goto(dataUrl)` → `new PlaywrightDriver().createSession({existingPage:page,...})`; `close=page.close`.
- **Selenium adapter:** headless Chrome (`--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --window-size=1280,800`) → `driver.get(fixtureUrl)` → `new SeleniumDriver().createSession({existingSession:driver,...})`; `close=driver.quit()`. **One WebDriver per file**, reused across tests via `beforeAll`/`afterAll`, re-navigated per test.

**Assertions — ONLY observable contract invariants** (never timing/slice/rank-absolute, per P3 Tradeoff-1 + the contract-honesty must-fix):

1. resolver emits `locator.resolved` **before** the handle is usable (sink empty until `resolve`); `candidates[]` carries matched/missed/skipped.
2. **drift fix:** unsupported kind ⇒ `skipped`; a `skipped` top candidate falling to a supported match ⇒ `degraded:false`; a _supported_ missed-below ⇒ `degraded:true`.
3. **totality:** `waitFor` throws `TimeoutError` on a never-appearing element; `waitForFirstOf` returns the winner, and throws `TimeoutError` carrying `BranchProgress[]` for **all** labels when none reachable; **zero unhandled rejections** (`process.on("unhandledRejection")` probe in `beforeEach`/`afterEach`, mirroring `assertion-firstof.test.ts`).
4. **action:** `typeText`→`read` round-trips; `tap` triggers a DOM effect; `clear` empties; per-action `timeoutMs` honored and **bounded** (requesting `timeoutMs > defaultTimeoutMs` does not extend past `defaultTimeoutMs`).
5. **capability honesty:** `require(advertised)` ok; `require(unadvertised)` throws `CapabilityUnsupportedError`.
6. **schema identity:** a shared `expectLocatorResolvedSchema`/`expectAssertionSchema` asserts the exact key set/types on events from **both** harnesses.

**Fixtures (`fixtures.ts`):** `data:text/html,` + `encodeURIComponent(html)` strings consumed identically by both (verified working under Playwright via `page.goto`; Selenium `driver.get('data:...')` confirmed in research). **Determinism (flake must-fix):** resolve/skip/schema groups use elements **present at load** (zero polling); timing-sensitive cases use wide margins (appears-after-200ms vs timeout 3-5s; never-appears for timeout tests).

**Graceful skip (D7):** Selenium adapter wraps the suite in `const seleniumTest = process.env.SENTINEL_SELENIUM ? defineDriverContract : () => test.skip("selenium suite (set SENTINEL_SELENIUM=1)", () => {})`. The Playwright contract suite always runs (browser already provisioned by the runner).

**Expected runtime:** Playwright suite sub-second/test (shared page). Selenium: ~15s cold (one-time chromedriver fetch), ~2-4s warm session create + sub-second/test, whole file ≈ 10-20s warm. `describe.configure({ mode: "serial", timeout: 60_000 })` on the Selenium describe (covers cold start; defeats the parallel-first-download race).

---

## (7) Auth-flow-on-driver-2 proof

`examples/web-erpnext/tests/auth/log-in.selenium.test.ts` (lint-exempt; gated on `SENTINEL_SELENIUM`). Reuses the **existing** `INVALID_DOM` from `tests/_support/login-dom.ts` (its button text is literally `"Invalid Login. Try again."` ⇒ the `invalid` locator's `text` candidate matches deterministically offline). Supplies a Selenium-backed `createSession`; **`page` arg unused** (proving page-agnosticism):

```ts
const result = await logIn(
  undefined as never,
  { username: "u", password: "bad" },
  {
    sink,
    createSession: async (_page, s, sessionId) => {
      const driver = await buildHeadlessChrome();
      await driver.get("data:text/html," + encodeURIComponent(INVALID_DOM));
      return new SeleniumDriver().createSession(
        { existingSession: driver, defaultTimeoutMs: 3000, sessionId },
        s,
      );
    },
  },
);
expect(result.kind).toBe("business-failure");
const c = classify(sink.events);
expect(c.outcome).toBe("business-failure");
expect(c.verdicts.some((v) => v.kind === "business-outcome")).toBe(true);
// submit (role skipped → css matched) contributes NO false drift:
const submitResolve = sink.events.find(
  (e) => e.type === "locator.resolved" && e.logicalName === "auth.login.submit",
);
expect((submitResolve as LocatorResolvedEvent).degraded).toBe(false);
// teardown
```

The flow logic, `LogInForm`, `loginLocators` are **untouched** — same `typeText`/`tap`/`waitForFirstOf` drive Selenium. A second success-path variant using `LOGIN_DOM` asserts `result.kind === "ok"` + `healthy`. The example flow's `defaultCreateSession` keeps `existingPage` (Playwright path unchanged).

---

## (8) Testing strategy + acceptance criteria

**TDD / commit order = §10.** Run `npm run test:unit` (Playwright runner over `packages/**/tests/**`), `npm run typecheck` (`tsc -b`), `npm run lint`.

Acceptance (numbered, runnable):

1. `npm run test:unit` green: **all pre-existing tests pass unchanged** except `package-wiring.test.ts` (asserts `peerDependencies`) and `action.test.ts` (ctor arg) — both intentional infra edits.
2. New `rules.test.ts` css-only regression: skipped-top ⇒ no `selector-drift`, `degraded:false`, `healthy`; `didDegrade:true`-alone ⇒ no drift verdict; a `role missed@0 + css matched@6` case still flags `selector-drift`.
3. `SENTINEL_SELENIUM=1 npm run test:unit`: Selenium compiler tests (browserless), resolver/action/assertion behavioral tests, and **`defineDriverContract` green for BOTH harnesses** with identical assertions; schema-identity helper passes on both.
4. The Selenium example proof: `logIn` ⇒ deterministic `business-failure` (and `ok` variant) with `page` unused; `classify()` agrees; `submit.degraded === false`.
5. `npm run typecheck` green (new path mappings + references).
6. `npm run lint --max-warnings=0` green: `selenium-webdriver` importable only under `packages/driver-selenium/**` + test dirs; `@sentinel/ai/src` imports no driver.
7. Per-action `timeoutMs` honored + clamped on both drivers (conformance group 4).
8. Zero unhandled rejections on both drivers (conformance group 3 probe).
9. New `.github/workflows/ci.yml` runs `typecheck`/`lint`/`test:unit` always, and a **separate opt-in job** sets `SENTINEL_SELENIUM=1`, pins chromedriver to the runner's Chrome major, and is **not** required to merge (isolates the unverified-CI risk).

---

## (9) Residual risks + explicitly deferred

**Residual (mitigated):**

- **Chromedriver provisioning** — cold ~15s network fetch; mitigated by serial describe + 60s timeout + cache (`~/.cache/selenium`) + CI pin. Gated, so a no-browser machine **skips** (D7), never red.
- **Zombie processes** — teardown in `try/finally` per adapter + `afterAll`; CI job has a process-cleanup step.
- **Selenium WebDriver round-trip cost** of per-call element re-resolution — bounded by offline `data:` fixtures (no network in the hot path) and one session per file.
- **label-miss "drift" on username/password** in the Selenium example — _correct_ behavior, documented and asserted as expected (not a false positive); the no-false-drift guarantee is scoped to the `skipped` case.

**Explicitly deferred:**

- Appium / third driver — but the seam is Appium-ready: `existingSession` is page-shape-free (D4); `role`/`accessibilityTree` skip semantics already covered; the conformance suite supplies fixtures **per-harness** so css/DOM is never assumed universal. No css/navigation is baked into the refined `Action`/`Assertion`/drift design.
- Selenium `role` support (would need an a11y-tree shim) — honestly omitted.
- Real ERPNext server runs on Selenium — offline fixtures only this slice.
- `relative` strategy on Selenium.

---

## (10) Ordered implementation sub-steps (each with its acceptance gate)

- **C1** `refactor(contracts): Action timeoutMs + ActionOptions + within optional + existingSession` — diffs §3a/b/d. Wire `PlaywrightAction(resolver, defaultTimeoutMs)` + clamp; update `session.ts`; update `action.test.ts` ctor; update `capability-locator.test.ts` (guard `child.within?.(parent)?.logicalName` + add a `within`-less literal that satisfies `Locator`). **Gate:** `test:unit` + `typecheck` green.
- **C2** `refactor(examples): drop defineLocator` — plain literals §3. **Gate:** `locators.test.ts` + example tests green.
- **C3** `chore(driver-playwright): @playwright/test peerDependency` + update `package-wiring.test.ts` to assert `peerDependencies`. **Gate:** `test:unit` + a clean `npm install` (peer satisfied at root).
- **C4** `fix(resolver,ai): drift = missed-below-winner; analyzer reads candidates[].outcome` — §4.1-4.3 + new regression tests §4.5. **Gate:** all locked `rules`/`resolver`/`e2e` tests green + new regressions green.
- **C5** `feat(driver-selenium): scaffold + strategy-compiler` — package, tsconfig/eslint/base wiring §2; pure compiler unit tests (kind→`{using,value}`, exact/substring, xpath quote-escaping, unsupported throws), **no browser**. **Gate:** `test:unit` + `typecheck` + `lint` green (boundary holds).
- **C6** `feat(driver-selenium): resolver + element + actionability` — §5.3-5.4; behavioral tests on warm headless Chrome incl. skipped-top ⇒ `degraded:false`. **Gate:** `SENTINEL_SELENIUM=1 test:unit` green.
- **C7** `feat(driver-selenium): action + assertion (interleaved waitForFirstOf)` — §5.5; port the four firstof behaviors + unhandled-rejection probe. **Gate:** Selenium firstof tests green, zero unhandled rejections.
- **C8** `test(conformance): shared cross-driver suite` — §6 factory + both adapters + graceful skip. **Gate:** suite green for Playwright always, and for Selenium under `SENTINEL_SELENIUM=1`; schema-identity helper passes on both.
- **C9** `test(examples): auth flow on Selenium offline via createSession` — §7. **Gate:** `business-failure` + `ok` variants green; `classify()` agrees; `submit.degraded===false`.
- **C10** `ci: add workflow with always-on (typecheck/lint/test:unit) + opt-in Selenium job (pinned chromedriver, non-required)` — §8.9. **Gate:** workflow runs; default job green; Selenium job isolated/non-blocking.

---

Files touched (absolute): **New** — `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/driver-selenium/**`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/contracts/tests/conformance/{harness,fixtures,driver-contract,playwright.contract.test,selenium.contract.test}.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/examples/web-erpnext/tests/auth/log-in.selenium.test.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/.github/workflows/ci.yml`. **Edited** — `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/contracts/src/{action,locator,session}.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/contracts/tests/capability-locator.test.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/core/src/telemetry/signals.ts` (JSDoc only); `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/driver-playwright/src/{resolver,action,session}.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/driver-playwright/package.json`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/driver-playwright/tests/{package-wiring,action}.test.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/src/classify/rules.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/packages/ai/tests/rules.test.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/examples/web-erpnext/src/domain/auth/locators.ts`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/examples/web-erpnext/tsconfig.json`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/eslint.config.cjs`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.base.json`; `/Users/zeeshan.amjad/Documents/sentinel-e2e/tsconfig.json`.

Key repo-verified corrections over P1/P2/P3: (1) **`package-wiring.test.ts` asserts `@playwright/test` in `dependencies`** — refinement (c) breaks it; it must change to `peerDependencies` (no prior design caught this). (2) **`action.test.ts` builds `new PlaywrightAction(resolver)` one-arg** — adding `defaultTimeoutMs` requires editing it. (3) **Dynamic `import()` of bare specifiers is documented-broken** in this TS-source loader (`package-wiring.test.ts` comment) — kills WebdriverIO-ESM; Selenium (CJS) chosen. (4) **No `.github/workflows` exists** — CI is added as opt-in, not assumed. (5) Rejected P3's `baselineRank` (breaks the `locatorResolved` test factory typecheck, zero analyzer benefit). (6) Used **`existingSession`** (additive) over `existingPage` duck-typing for Appium-readiness. (7) Confirmed **zero `.within(` call sites** so the optionality + `defineLocator` drop is safe; (8) the example's `login-dom.ts` `INVALID_DOM`/`LOGIN_DOM` fixtures are directly reusable for the offline Selenium proof.

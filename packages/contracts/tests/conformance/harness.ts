// packages/contracts/tests/conformance/harness.ts
//
// The shared cross-driver conformance suite (spec §6, sub-step C8).
//
// This file imports the test runner (@playwright/test) and the CONTRACTS/CORE
// types ONLY — never a driver SDK. The per-driver adapter files
// (playwright.contract.test.ts / selenium.contract.test.ts) own the SDK imports
// and supply a `DriverHarness`; this factory asserts the OBSERVABLE contract +
// telemetry invariants that BOTH drivers must satisfy identically.
//
// Assertions are restricted to observable contract invariants — never timing,
// poll-slice internals, or absolute ranks. Where a value would differ by driver
// (e.g. accessibilityTree is Playwright-only) the suite uses a capability/kind
// that is in/out of BOTH advertised sets so the SAME assertion holds on each.

import { test, expect } from "@playwright/test";
import type { Locator, Session, SessionConfig } from "@sentinele2e/contracts";
import type { TelemetrySink } from "@sentinele2e/core";
import {
  InMemorySink,
  TimeoutError,
  CapabilityUnsupportedError,
} from "@sentinele2e/core";

/** A per-driver adapter. `open` navigates to the fixture and returns a wired Session. */
export interface DriverHarness {
  readonly name: string;
  /** A bare Driver instance, so the suite can read advertised capabilities/strategies. */
  readonly driver: {
    readonly capabilities: ReadonlySet<string>;
    readonly strategies: ReadonlySet<string>;
  };
  open(
    fixtureUrl: string,
    sink: TelemetrySink,
    opts?: Partial<SessionConfig>,
  ): Promise<Session>;
  close(session: Session): Promise<void>;
}

// ----------------------------------------------------------------------------
// Shared schema-identity helpers (§6 group 6) — asserted on events from BOTH
// harnesses, so a single key set/type contract is enforced once for the project.
// ----------------------------------------------------------------------------

type AnyEvent = Record<string, unknown>;

/** Every telemetry envelope carries these stamped fields (StampingSink owns them). */
const ENVELOPE_KEYS = [
  "schemaVersion",
  "eventId",
  "type",
  "traceId",
  "spanId",
  "sequence",
  "name",
  "timing",
] as const;

function expectEnvelope(ev: AnyEvent): void {
  for (const k of ENVELOPE_KEYS) expect(ev).toHaveProperty(k);
  expect(typeof ev["schemaVersion"]).toBe("string");
  expect(ev["schemaVersion"]).toBe("1.0.0");
  expect(typeof ev["eventId"]).toBe("string");
  expect(typeof ev["type"]).toBe("string");
  expect(typeof ev["traceId"]).toBe("string");
  expect(typeof ev["spanId"]).toBe("string");
  expect(typeof ev["sequence"]).toBe("number");
  expect(typeof ev["name"]).toBe("string");
  expect(typeof ev["timing"]).toBe("object");
}

/** The exact key set + types of a `locator.resolved` event, identical on both drivers. */
export function expectLocatorResolvedSchema(ev: AnyEvent): void {
  expect(ev["type"]).toBe("locator.resolved");
  expectEnvelope(ev);
  expect(typeof ev["logicalName"]).toBe("string");
  expect(typeof ev["resolvedKind"]).toBe("string");
  expect(typeof ev["resolvedRank"]).toBe("number");
  expect(typeof ev["degraded"]).toBe("boolean");
  expect(typeof ev["score"]).toBe("number");
  expect(typeof ev["resolveDurationMs"]).toBe("number");
  expect(Array.isArray(ev["candidates"])).toBe(true);
  for (const c of ev["candidates"] as AnyEvent[]) {
    expect(typeof c["kind"]).toBe("string");
    expect(typeof c["rank"]).toBe("number");
    expect(["matched", "missed", "skipped"]).toContain(c["outcome"]);
  }
}

/** The exact key set + types of an `assertion` event, identical on both drivers. */
export function expectAssertionSchema(ev: AnyEvent): void {
  expect(ev["type"]).toBe("assertion");
  expectEnvelope(ev);
  expect(typeof ev["state"]).toBe("string");
  expect(typeof ev["matched"]).toBe("boolean");
  expect(typeof ev["locatorRank"]).toBe("number");
  if (ev["branchProgress"] !== undefined) {
    expect(Array.isArray(ev["branchProgress"])).toBe(true);
    for (const b of ev["branchProgress"] as AnyEvent[]) {
      expect(typeof b["label"]).toBe("string");
      expect(typeof b["reachedState"]).toBe("string");
      // resolvedRank is `number | null`.
      const r = b["resolvedRank"];
      expect(r === null || typeof r === "number").toBe(true);
    }
  }
}

function resolvedEvents(sink: InMemorySink): AnyEvent[] {
  return sink.events.filter(
    (e) => (e as AnyEvent)["type"] === "locator.resolved",
  ) as unknown as AnyEvent[];
}

function findResolved(sink: InMemorySink, logicalName: string): AnyEvent {
  const ev = resolvedEvents(sink).find((e) => e["logicalName"] === logicalName);
  expect(ev, `expected a locator.resolved for "${logicalName}"`).toBeDefined();
  return ev as AnyEvent;
}

// ----------------------------------------------------------------------------
// Shared locators (kinds chosen to behave IDENTICALLY on both drivers).
// ----------------------------------------------------------------------------

const READY: Locator = {
  logicalName: "conf.appShell.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

// Top candidate `image` is advertised by NEITHER driver -> skipped on both;
// css(6) matches. Proves: unsupported -> skipped AND degraded:false (the
// no-false-drift §4 guarantee), identically on both harnesses.
const SKIP_TOP: Locator = {
  logicalName: "conf.skipTop",
  candidates: [
    { kind: "image", value: "logo.png" },
    { kind: "css", value: "button.btn-login" },
  ],
} as Locator;

// Top candidate `text` is advertised by BOTH but the value is absent -> missed;
// css(6) matches below it. Proves: supported missed-below-winner -> degraded:true.
const MISS_BELOW: Locator = {
  logicalName: "conf.missBelow",
  candidates: [
    { kind: "text", value: "No Such Label Anywhere", options: { exact: true } },
    { kind: "css", value: "button.btn-login" },
  ],
} as Locator;

// A never-appearing element (absent from every fixture) for timeout/totality.
const NEVER: Locator = {
  logicalName: "conf.never",
  candidates: [{ kind: "css", value: "#this-element-never-exists" }],
} as Locator;

const FIELD: Locator = {
  logicalName: "conf.field",
  candidates: [{ kind: "css", value: "#login_email" }],
} as Locator;

const SUBMIT: Locator = {
  logicalName: "conf.submit",
  candidates: [{ kind: "css", value: "button.btn-login" }],
} as Locator;

const AFTER_SUBMIT: Locator = {
  logicalName: "conf.afterSubmit",
  candidates: [{ kind: "css", value: "#after-submit" }],
} as Locator;

const DISABLED: Locator = {
  logicalName: "conf.disabled",
  candidates: [{ kind: "css", value: "#disabled-btn" }],
} as Locator;

// Capabilities chosen to be in/out of BOTH advertised sets (intersection):
//  - "dom" is advertised by playwright AND selenium  -> require() ok on both.
//  - "gestures" is advertised by NEITHER             -> require() throws on both.
const ADVERTISED_ON_BOTH = "dom";
const UNADVERTISED_ON_BOTH = "gestures";

// Fixtures are imported by the adapters and passed here as already-encoded URLs
// to keep this factory free of any encoding assumption. The adapter passes both.
export interface ConformanceFixtures {
  readonly loginUrl: string;
  readonly invalidUrl: string;
}

/**
 * Registers the full conformance describe. The adapter supplies `makeHarness`
 * (which owns the driver SDK) and the two fixture URLs.
 */
export function defineDriverContract(
  makeHarness: () => DriverHarness,
  fixtures: ConformanceFixtures,
): void {
  const harness = makeHarness();

  test.describe(`conformance: ${harness.name}`, () => {
    // ---- group 3 probe: zero unhandled rejections across every test ----
    let unhandled: unknown[];
    let onUnhandled: (r: unknown) => void;

    test.beforeEach(() => {
      unhandled = [];
      onUnhandled = (r) => {
        unhandled.push(r);
      };
      process.on("unhandledRejection", onUnhandled);
    });

    test.afterEach(async () => {
      // Give any leaked microtask a tick to surface before we assert.
      await new Promise((r) => setTimeout(r, 50));
      process.off("unhandledRejection", onUnhandled);
      expect(unhandled).toHaveLength(0);
    });

    // ---------------------------------------------------------------- group 1
    test("resolver emits locator.resolved BEFORE the handle is usable; candidates carry outcomes", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        const before = resolvedEvents(sink).length;
        // The handle from locate() is only usable after the action path emits.
        await session.action.read(FIELD);
        const after = resolvedEvents(sink);
        expect(after.length).toBeGreaterThan(before);
        const ev = findResolved(sink, "conf.field");
        const kinds = (ev["candidates"] as AnyEvent[]).map((c) => c["kind"]);
        expect(kinds).toContain("css");
      } finally {
        await harness.close(session);
      }
    });

    // ---------------------------------------------------------------- group 2
    test("drift fix: unsupported kind => skipped, and a skipped top candidate => degraded:false", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        await session.action.read(SKIP_TOP);
        const ev = findResolved(sink, "conf.skipTop");
        const cands = ev["candidates"] as AnyEvent[];
        expect(cands.find((c) => c["kind"] === "image")?.["outcome"]).toBe(
          "skipped",
        );
        expect(cands.find((c) => c["kind"] === "css")?.["outcome"]).toBe(
          "matched",
        );
        expect(ev["degraded"]).toBe(false); // skipped top != drift
        expect(ev["resolvedKind"]).toBe("css");
      } finally {
        await harness.close(session);
      }
    });

    test("drift fix: a supported candidate missed BELOW the winner => degraded:true", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        await session.action.read(MISS_BELOW);
        const ev = findResolved(sink, "conf.missBelow");
        const cands = ev["candidates"] as AnyEvent[];
        expect(cands.find((c) => c["kind"] === "text")?.["outcome"]).toBe(
          "missed",
        );
        expect(ev["degraded"]).toBe(true);
        expect(ev["resolvedKind"]).toBe("css");
      } finally {
        await harness.close(session);
      }
    });

    // ---------------------------------------------------------------- group 3
    test("totality: waitFor throws TimeoutError on a never-appearing element", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        const err = await session.assert
          .waitFor(NEVER, "visible", { timeoutMs: 300 })
          .then(() => null)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(TimeoutError);
      } finally {
        await harness.close(session);
      }
    });

    test("totality: waitForFirstOf returns the reachable winner", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        const winner = await session.assert.waitForFirstOf(
          [
            { label: "NEVER", target: NEVER, state: "visible" },
            { label: "READY", target: READY, state: "visible" },
          ],
          { timeoutMs: 2000 },
        );
        expect(winner).toBe("READY");
      } finally {
        await harness.close(session);
      }
    });

    test("totality: waitForFirstOf with no winner throws TimeoutError carrying BranchProgress[] for ALL labels", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        const err = await session.assert
          .waitForFirstOf(
            [
              { label: "NEVER_A", target: NEVER, state: "visible" },
              { label: "NEVER_B", target: NEVER, state: "visible" },
            ],
            { timeoutMs: 300 },
          )
          .then(() => null)
          .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(TimeoutError);
        const te = err as TimeoutError;
        const labels = (te.context.branchProgress ?? [])
          .map((b) => b.label)
          .sort();
        expect(labels).toEqual(["NEVER_A", "NEVER_B"]);
        for (const bp of te.context.branchProgress ?? []) {
          expect(bp.reachedState).toBeDefined();
        }
      } finally {
        await harness.close(session);
      }
    });

    // ---------------------------------------------------------------- group 4
    test("action: typeText -> read round-trips; clear empties", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        expect(await session.action.read(FIELD)).toBe("seed-user");
        await session.action.clear(FIELD);
        expect(await session.action.read(FIELD)).toBe("");
        await session.action.typeText(FIELD, "round-trip");
        expect(await session.action.read(FIELD)).toBe("round-trip");
      } finally {
        await harness.close(session);
      }
    });

    test("action: tap triggers a DOM effect", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        expect(await session.action.read(AFTER_SUBMIT)).toBe("");
        await session.action.tap(SUBMIT);
        expect(await session.action.read(AFTER_SUBMIT)).toBe("submitted");
      } finally {
        await harness.close(session);
      }
    });

    test("action: per-action timeoutMs is honored AND clamped to defaultTimeoutMs (a long request does not extend past it)", async () => {
      const sink = new InMemorySink();
      // defaultTimeoutMs=300; tapping a never-actionable (disabled) element with a
      // 10s request must still fail fast — the clamp bounds it to ~300ms.
      const session = await harness.open(fixtures.loginUrl, sink, {
        defaultTimeoutMs: 300,
      });
      try {
        const t0 = Date.now();
        const err = await session.action
          .tap(DISABLED, { timeoutMs: 10_000 })
          .then(() => null)
          .catch((e: unknown) => e);
        const elapsed = Date.now() - t0;
        expect(err).not.toBeNull();
        expect(elapsed).toBeLessThan(3000); // clamped, nowhere near 10s
      } finally {
        await harness.close(session);
      }
    });

    // ---------------------------------------------------------------- group 5
    test("capability honesty: require(advertised) ok; require(unadvertised) throws CapabilityUnsupportedError", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        // Sanity: the chosen caps really are in/out of THIS driver's advertised set.
        expect(harness.driver.capabilities.has(ADVERTISED_ON_BOTH)).toBe(true);
        expect(harness.driver.capabilities.has(UNADVERTISED_ON_BOTH)).toBe(
          false,
        );
        expect(session.supports(ADVERTISED_ON_BOTH as never)).toBe(true);
        expect(() =>
          session.require(ADVERTISED_ON_BOTH as never),
        ).not.toThrow();
        expect(() => session.require(UNADVERTISED_ON_BOTH as never)).toThrow(
          CapabilityUnsupportedError,
        );
      } finally {
        await harness.close(session);
      }
    });

    // ---------------------------------------------------------------- group 6
    test("schema identity: locator.resolved + assertion events match the exact shared schema", async () => {
      const sink = new InMemorySink();
      const session = await harness.open(fixtures.loginUrl, sink);
      try {
        // Drive both an action (=> locator.resolved) and an assertion (=> assertion).
        await session.action.read(FIELD);
        await session.assert.waitFor(READY, "visible", { timeoutMs: 2000 });

        const resolved = resolvedEvents(sink);
        expect(resolved.length).toBeGreaterThan(0);
        for (const ev of resolved) expectLocatorResolvedSchema(ev);

        const assertions = (sink.events as unknown as AnyEvent[]).filter(
          (e) => e["type"] === "assertion",
        );
        expect(assertions.length).toBeGreaterThan(0);
        for (const ev of assertions) expectAssertionSchema(ev);
      } finally {
        await harness.close(session);
      }
    });
  });
}

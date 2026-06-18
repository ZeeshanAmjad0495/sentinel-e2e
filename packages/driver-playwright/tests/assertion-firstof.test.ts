// packages/driver-playwright/tests/assertion-firstof.test.ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink, TimeoutError } from "@sentinele2e/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAssertion } from "../src/assertion";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const invalid: Locator = {
  logicalName: "auth.login.invalidState",
  candidates: [{ kind: "css", value: ".page-card-body.invalid .btn-login" }],
} as Locator;
const ready: Locator = {
  logicalName: "auth.appShell.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;
// A branch whose CSS matches 2+ elements -> resolver throws SelectorAmbiguousError.
const ambiguous: Locator = {
  logicalName: "auth.ambiguous.banner",
  candidates: [{ kind: "css", value: ".dup-banner" }],
} as Locator;

function makeAssert(page: Page, sink: InMemorySink) {
  return new PlaywrightAssertion(
    page,
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
    sink,
    CTX,
    300,
  );
}

test("returns the winning label when one branch becomes visible", async ({
  page,
}) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const assertion = makeAssert(page, new InMemorySink());

  const winner = await assertion.waitForFirstOf([
    { label: "INVALID", target: invalid, state: "visible" },
    { label: "SUCCESS", target: ready, state: "visible" },
  ]);

  expect(winner).toBe("SUCCESS");
});

test("THROWS TimeoutError with branchProgress when NEITHER branch is reachable, no unhandled rejection", async ({
  page,
}) => {
  // Neither .invalid nor .desktop-wrapper exists -> the old code resolved "SUCCESS" by timeout.
  await page.setContent(`<section class="for-login">login</section>`);
  const assertion = makeAssert(page, new InMemorySink());

  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown): void => {
    unhandled.push(r);
  };
  process.on("unhandledRejection", onUnhandled);

  const err = await assertion
    .waitForFirstOf(
      [
        { label: "INVALID", target: invalid, state: "visible" },
        { label: "SUCCESS", target: ready, state: "visible" },
      ],
      { timeoutMs: 150 },
    )
    .then(() => null)
    .catch((e: unknown) => e);

  // Give microtasks/late rejections a tick to surface.
  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnhandled);

  expect(err).toBeInstanceOf(TimeoutError);
  const te = err as TimeoutError;
  const labels = (te.context.branchProgress ?? []).map((b) => b.label).sort();
  expect(labels).toEqual(["INVALID", "SUCCESS"]);
  for (const bp of te.context.branchProgress ?? []) {
    expect(bp.reachedState).toBeDefined(); // "none" since neither attached
  }
  expect(unhandled).toHaveLength(0); // loser-cancellation: zero unhandled rejections
});

test("RESOLVES the unambiguous winner when a NON-winning branch is AMBIGUOUS, no unhandled rejection", async ({
  page,
}) => {
  // Two .dup-banner elements -> the AMBIGUOUS branch's resolver throws.
  // The other branch (.desktop-wrapper) is visible and must still win.
  await page.setContent(
    `<div class="dup-banner">a</div><div class="dup-banner">b</div><div class="desktop-wrapper">home</div>`,
  );
  const assertion = makeAssert(page, new InMemorySink());

  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown): void => {
    unhandled.push(r);
  };
  process.on("unhandledRejection", onUnhandled);

  const winner = await assertion.waitForFirstOf(
    [
      { label: "AMBIGUOUS", target: ambiguous, state: "visible" },
      { label: "SUCCESS", target: ready, state: "visible" },
    ],
    { timeoutMs: 300 },
  );

  // Give any detached sibling rejection a tick to surface.
  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnhandled);

  expect(winner).toBe("SUCCESS");
  expect(unhandled).toHaveLength(0);
});

test("THROWS TimeoutError (not SelectorAmbiguousError) when the AMBIGUOUS branch is not the target and no branch is reachable, no unhandled rejection", async ({
  page,
}) => {
  // .dup-banner matches 2 elements (ambiguous, not the win target);
  // .desktop-wrapper never appears -> neither branch reaches its state.
  await page.setContent(
    `<div class="dup-banner">a</div><div class="dup-banner">b</div><section class="for-login">login</section>`,
  );
  const assertion = makeAssert(page, new InMemorySink());

  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown): void => {
    unhandled.push(r);
  };
  process.on("unhandledRejection", onUnhandled);

  const err = await assertion
    .waitForFirstOf(
      [
        { label: "AMBIGUOUS", target: ambiguous, state: "visible" },
        { label: "SUCCESS", target: ready, state: "visible" },
      ],
      { timeoutMs: 150 },
    )
    .then(() => null)
    .catch((e: unknown) => e);

  // Give microtasks/late rejections a tick to surface.
  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnhandled);

  expect(err).toBeInstanceOf(TimeoutError);
  const te = err as TimeoutError;
  const labels = (te.context.branchProgress ?? []).map((b) => b.label).sort();
  expect(labels).toEqual(["AMBIGUOUS", "SUCCESS"]);
  expect(unhandled).toHaveLength(0);
});

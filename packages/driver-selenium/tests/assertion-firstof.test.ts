// packages/driver-selenium/tests/assertion-firstof.test.ts
// Browser-backed: GATED on SENTINEL_SELENIUM. Serial + 60s; teardown in
// try/finally. Mirrors driver-playwright/tests/assertion-firstof.test.ts incl.
// the process.on("unhandledRejection") probe (zero unhandled rejections BY
// CONSTRUCTION — the single interleaved poll loop has no second promise).
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink, TimeoutError } from "@sentinele2e/core";
import { Builder, Browser, type WebDriver } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { SeleniumResolver } from "../src/resolver";
import { SeleniumAssertion } from "../src/assertion";

const RUN = Boolean(process.env.SENTINEL_SELENIUM);

test.describe.configure({ mode: "serial", timeout: 60_000 });

const STRATEGIES = new Set([
  "css",
  "xpath",
  "testid",
  "text",
  "label",
  "placeholder",
  "altText",
  "title",
]);
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

async function buildHeadlessChrome(): Promise<WebDriver> {
  const opts = new Options().addArguments(
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
  );
  return new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(opts)
    .build();
}

async function load(driver: WebDriver, html: string): Promise<void> {
  await driver.get("data:text/html," + encodeURIComponent(html));
}

function makeAssert(driver: WebDriver, sink: InMemorySink): SeleniumAssertion {
  return new SeleniumAssertion(
    driver,
    new SeleniumResolver(driver, STRATEGIES, sink, CTX),
    sink,
    CTX,
    300,
  );
}

test.describe("SeleniumAssertion waitForFirstOf (browser-backed)", () => {
  test.skip(!RUN, "selenium browser suite (set SENTINEL_SELENIUM=1)");

  let driver: WebDriver;

  test.beforeAll(async () => {
    driver = await buildHeadlessChrome();
  });

  test.afterAll(async () => {
    try {
      if (driver) await driver.quit();
    } catch {
      /* best-effort teardown */
    }
  });

  test("waitFor throws TimeoutError on a never-appearing element", async () => {
    await load(driver, `<section class="for-login">login</section>`);
    const assertion = makeAssert(driver, new InMemorySink());

    const err = await assertion
      .waitFor(ready, "visible", { timeoutMs: 200 })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeoutError);
  });

  test("waitForFirstOf returns the reachable branch", async () => {
    await load(driver, `<div class="desktop-wrapper">home</div>`);
    const assertion = makeAssert(driver, new InMemorySink());

    const winner = await assertion.waitForFirstOf([
      { label: "INVALID", target: invalid, state: "visible" },
      { label: "SUCCESS", target: ready, state: "visible" },
    ]);

    expect(winner).toBe("SUCCESS");
  });

  test("no winner => TimeoutError + BranchProgress[] for ALL labels, zero unhandled rejections", async () => {
    await load(driver, `<section class="for-login">login</section>`);
    const assertion = makeAssert(driver, new InMemorySink());

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
        { timeoutMs: 200 },
      )
      .then(() => null)
      .catch((e: unknown) => e);

    await new Promise((r) => setTimeout(r, 50));
    process.off("unhandledRejection", onUnhandled);

    expect(err).toBeInstanceOf(TimeoutError);
    const te = err as TimeoutError;
    const labels = (te.context.branchProgress ?? []).map((b) => b.label).sort();
    expect(labels).toEqual(["INVALID", "SUCCESS"]);
    for (const bp of te.context.branchProgress ?? []) {
      expect(bp.reachedState).toBeDefined();
    }
    expect(unhandled).toHaveLength(0);
  });

  test("an AMBIGUOUS non-winning branch never rejects the loop; the unambiguous branch wins", async () => {
    await load(
      driver,
      `<div class="dup-banner">a</div><div class="dup-banner">b</div><div class="desktop-wrapper">home</div>`,
    );
    const assertion = makeAssert(driver, new InMemorySink());

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

    await new Promise((r) => setTimeout(r, 50));
    process.off("unhandledRejection", onUnhandled);

    expect(winner).toBe("SUCCESS");
    expect(unhandled).toHaveLength(0);
  });
});

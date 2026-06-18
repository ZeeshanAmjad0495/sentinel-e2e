// packages/driver-selenium/tests/action.test.ts
// Browser-backed: GATED on SENTINEL_SELENIUM. Serial + 60s; try/finally teardown.
// Action verbs round-trip on a data: fixture, and per-action timeoutMs is clamped.
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink } from "@sentinele2e/core";
import { Builder, Browser, type WebDriver } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { SeleniumResolver } from "../src/resolver";
import { SeleniumAction } from "../src/action";

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

const field: Locator = {
  logicalName: "form.field",
  candidates: [{ kind: "css", value: "#field" }],
} as Locator;
const btn: Locator = {
  logicalName: "form.btn",
  candidates: [{ kind: "css", value: "#btn" }],
} as Locator;
const out: Locator = {
  logicalName: "form.out",
  candidates: [{ kind: "css", value: "#out" }],
} as Locator;
// Present in the DOM but DISABLED -> resolves fine, but never becomes
// actionable (requireEnabled), so waitActionable polls to the clamped deadline.
const disabled: Locator = {
  logicalName: "form.disabled",
  candidates: [{ kind: "css", value: "#disabled-btn" }],
} as Locator;

const FIXTURE = `
  <input id="field" value="seed" />
  <button id="btn" onclick="document.getElementById('out').textContent='tapped'">go</button>
  <button id="disabled-btn" disabled>nope</button>
  <div id="out"></div>
`;

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

function makeAction(
  driver: WebDriver,
  sink: InMemorySink,
  defaultTimeoutMs = 5000,
): SeleniumAction {
  return new SeleniumAction(
    driver,
    new SeleniumResolver(driver, STRATEGIES, sink, CTX),
    CTX,
    defaultTimeoutMs,
  );
}

test.describe("SeleniumAction (browser-backed)", () => {
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

  test("clear empties; typeText then read round-trips", async () => {
    await load(driver, FIXTURE);
    const action = makeAction(driver, new InMemorySink());

    expect(await action.read(field)).toBe("seed");
    await action.clear(field);
    expect(await action.read(field)).toBe("");
    await action.typeText(field, "hello");
    expect(await action.read(field)).toBe("hello");
  });

  test("tap triggers a DOM effect", async () => {
    await load(driver, FIXTURE);
    const action = makeAction(driver, new InMemorySink());

    expect(await action.read(out)).toBe("");
    await action.tap(btn);
    expect(await action.read(out)).toBe("tapped");
  });

  test("per-action timeoutMs is bounded by defaultTimeoutMs (clamp): a long request still fails fast", async () => {
    await load(driver, FIXTURE);
    // defaultTimeoutMs=300; requesting 10_000 must NOT extend past 300.
    const action = makeAction(driver, new InMemorySink(), 300);

    const t0 = Date.now();
    const err = await action
      .tap(disabled, { timeoutMs: 10_000 })
      .then(() => null)
      .catch((e: unknown) => e);
    const elapsed = Date.now() - t0;

    expect(err).not.toBeNull(); // never enabled -> waitActionable threw
    expect(elapsed).toBeLessThan(3000); // clamped to ~300ms, nowhere near 10s
  });
});

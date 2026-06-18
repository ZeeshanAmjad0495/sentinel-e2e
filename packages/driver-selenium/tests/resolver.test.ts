// packages/driver-selenium/tests/resolver.test.ts
// Browser-backed: GATED on SENTINEL_SELENIUM (Selenium Manager provisions
// chromedriver on first run). Serial + long timeout; teardown in try/finally.
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink } from "@sentinele2e/core";
import { SelectorAmbiguousError } from "@sentinele2e/core";
import { Builder, Browser, type WebDriver } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { SeleniumResolver } from "../src/resolver";

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
const CTX = { correlationId: "corr-1", flowName: "test.flow", startedAt: 0 };

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

const HTML = `
  <button class="go" type="submit">Login</button>
  <span class="dup">a</span><span class="dup">b</span>
`;

test.describe("SeleniumResolver (browser-backed)", () => {
  // Skips the whole describe (incl. beforeAll) cleanly without the env var.
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

  test("emits locator.resolved BEFORE the handle is usable", async () => {
    await load(driver, HTML);
    const sink = new InMemorySink();
    const resolver = new SeleniumResolver(driver, STRATEGIES, sink, CTX);

    const locator: Locator = {
      logicalName: "auth.login.submit",
      candidates: [{ kind: "css", value: "button.go" }],
    } as Locator;

    expect(sink.events).toHaveLength(0); // empty until resolve()
    const resolution = await resolver.resolve(locator);
    const resolved = sink.events.find((e) => e.type === "locator.resolved");
    expect(resolved).toBeDefined();
    // Handle is usable AFTER (proves emit-before-return ordering).
    await expect(resolution.handle.isVisible()).resolves.toBe(true);
  });

  test("unadvertised kind is skipped; supported fallback matches", async () => {
    await load(driver, HTML);
    const sink = new InMemorySink();
    const resolver = new SeleniumResolver(driver, STRATEGIES, sink, CTX);

    const locator: Locator = {
      logicalName: "auth.login.submit",
      candidates: [
        { kind: "image", value: "x" }, // not advertised -> skipped
        { kind: "css", value: "button.go" }, // matched
      ],
    } as Locator;

    await resolver.resolve(locator);
    const ev = sink.events.find(
      (e) => e.type === "locator.resolved",
    ) as unknown as { candidates: { kind: string; outcome: string }[] };
    expect(ev.candidates.find((c) => c.kind === "image")?.outcome).toBe(
      "skipped",
    );
    expect(ev.candidates.find((c) => c.kind === "css")?.outcome).toBe(
      "matched",
    );
  });

  test("skipped TOP candidate falling to a supported match => degraded:false (the §4 guarantee)", async () => {
    await load(driver, HTML);
    const sink = new InMemorySink();
    const resolver = new SeleniumResolver(driver, STRATEGIES, sink, CTX);

    // role (rank 0) is unadvertised -> skipped, NOT missed. css (rank 6) matches.
    const locator: Locator = {
      logicalName: "auth.login.submit",
      candidates: [
        { kind: "role", value: "button", options: { name: "Login" } },
        { kind: "css", value: "button.go" },
      ],
    } as Locator;

    const resolution = await resolver.resolve(locator);
    expect(resolution.degraded).toBe(false); // skipped != degraded
    expect(resolution.resolvedKind).toBe("css");

    const ev = sink.events.find(
      (e) => e.type === "locator.resolved",
    ) as unknown as {
      degraded: boolean;
      candidates: { kind: string; outcome: string }[];
    };
    expect(ev.degraded).toBe(false);
    expect(ev.candidates.find((c) => c.kind === "role")?.outcome).toBe(
      "skipped",
    );
  });

  test("supported missed-below-winner => degraded:true", async () => {
    await load(driver, HTML);
    const sink = new InMemorySink();
    const resolver = new SeleniumResolver(driver, STRATEGIES, sink, CTX);

    // text (rank 2, SUPPORTED) for "Absent" misses; css (rank 6) matches.
    const locator: Locator = {
      logicalName: "auth.login.submit",
      candidates: [
        { kind: "text", value: "Absent label", options: { exact: true } },
        { kind: "css", value: "button.go" },
      ],
    } as Locator;

    const resolution = await resolver.resolve(locator);
    expect(resolution.degraded).toBe(true);
    expect(resolution.resolvedKind).toBe("css");

    const ev = sink.events.find(
      (e) => e.type === "locator.resolved",
    ) as unknown as {
      degraded: boolean;
      candidates: { kind: string; outcome: string }[];
    };
    expect(ev.degraded).toBe(true);
    expect(ev.candidates.find((c) => c.kind === "text")?.outcome).toBe(
      "missed",
    );
  });

  test("throws SelectorAmbiguousError on >1 match", async () => {
    await load(driver, HTML);
    const sink = new InMemorySink();
    const resolver = new SeleniumResolver(driver, STRATEGIES, sink, CTX);

    const locator: Locator = {
      logicalName: "auth.dup",
      candidates: [{ kind: "css", value: "span.dup" }],
    } as Locator;

    await expect(resolver.resolve(locator)).rejects.toBeInstanceOf(
      SelectorAmbiguousError,
    );
  });
});

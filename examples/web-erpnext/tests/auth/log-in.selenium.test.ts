// examples/web-erpnext/tests/auth/log-in.selenium.test.ts
//
// Auth-flow-on-driver-2 proof (spec §7, sub-step C9). Drives the UNCHANGED
// `logIn` flow over a Selenium-backed session — proving "tool-agnostic" is real:
// the same flow/LogInForm/loginLocators/waitForFirstOf run on a maximally-
// different second web driver with NO flow edits.
//
// GATED on SENTINEL_SELENIUM (Selenium Manager provisions chromedriver on first
// run); serialized + 60s so the cold-start fetch cannot race or flake. This file
// (under tests/) is lint-exempt, so it may import the driver SDK + selenium SDK.
//
// Page-agnosticism: `logIn`'s first arg (a Playwright Page in production) is
// passed `undefined as never` and the injected createSession IGNORES it — the
// Selenium WebDriver is the real handle, adopted via `existingSession`.
import { test, expect } from "@playwright/test";
import { InMemorySink } from "@sentinel/core";
import type { LocatorResolvedEvent } from "@sentinel/core";
import { classify } from "@sentinel/ai";
import { Builder, Browser, type WebDriver } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { SeleniumDriver } from "@sentinel/driver-selenium";
import { logIn } from "../../src/flows";
import { INVALID_DOM, LOGIN_DOM } from "../_support/login-dom";

const RUN = Boolean(process.env.SENTINEL_SELENIUM);

// Cold chromedriver fetch + warm session create: serial + 60s (spec §7 / D7).
test.describe.configure({ mode: "serial", timeout: 60_000 });

async function buildHeadlessChrome(): Promise<WebDriver> {
  const opts: Options = new Options();
  opts.addArguments(
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,800",
  );
  return new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(opts)
    .build();
}

(RUN ? test : test.skip)(
  "auth flow on selenium (offline): invalid fixture => business-failure; classify agrees; submit not falsely drifted",
  async () => {
    const sink = new InMemorySink();
    let driver: WebDriver | undefined;

    try {
      // `_page` is UNUSED — the createSession builds + adopts a Selenium WebDriver.
      const result = await logIn(
        undefined as never,
        { username: "u", password: "bad" },
        {
          sink,
          createSession: async (_page, s, sessionId) => {
            driver = await buildHeadlessChrome();
            await driver.get(
              "data:text/html," + encodeURIComponent(INVALID_DOM),
            );
            return new SeleniumDriver().createSession(
              { existingSession: driver, defaultTimeoutMs: 3000, sessionId },
              s,
            );
          },
        },
      );

      // The rich LoginResult is a business-failure (the invalid fixture is the
      // structural invalid state; the `invalid` locator's text candidate matches).
      expect(result.status).toBe("business-failure");
      expect((result as { reason: string }).reason).toBe("INVALID_CREDENTIALS");

      // classify() agrees, reading the same emitted telemetry.
      const c = classify(sink.events);
      expect(c.outcome).toBe("business-failure");
      expect(c.verdicts.some((v) => v.kind === "business-outcome")).toBe(true);

      // submit (role SKIPPED on selenium -> css matched) contributes NO false
      // drift: role is unadvertised, so it is skipped (never missed) => degraded:false.
      const submitResolve = sink.events.find(
        (e) =>
          (e as { type: string }).type === "locator.resolved" &&
          (e as { logicalName?: string }).logicalName === "auth.login.submit",
      ) as unknown as LocatorResolvedEvent | undefined;
      expect(submitResolve).toBeDefined();
      expect((submitResolve as LocatorResolvedEvent).degraded).toBe(false);
    } finally {
      if (driver) await driver.quit();
    }
  },
);

(RUN ? test : test.skip)(
  "auth flow on selenium (offline): success fixture => success result + healthy verdict",
  async () => {
    const sink = new InMemorySink();
    let driver: WebDriver | undefined;

    try {
      const result = await logIn(
        undefined as never,
        { username: "valid-user", password: "valid-pass" },
        {
          sink,
          createSession: async (_page, s, sessionId) => {
            driver = await buildHeadlessChrome();
            await driver.get("data:text/html," + encodeURIComponent(LOGIN_DOM));
            return new SeleniumDriver().createSession(
              { existingSession: driver, defaultTimeoutMs: 3000, sessionId },
              s,
            );
          },
        },
      );

      expect(result.status).toBe("success");
      expect((result as { data: { username: string } }).data.username).toBe(
        "valid-user",
      );

      const c = classify(sink.events);
      expect(c.outcome).toBe("success");
      expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(true);
    } finally {
      if (driver) await driver.quit();
    }
  },
);

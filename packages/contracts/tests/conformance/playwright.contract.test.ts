// packages/contracts/tests/conformance/playwright.contract.test.ts
//
// Playwright adapter for the shared conformance suite (spec §6). ALWAYS runs —
// the runner already provisions a browser. This file (under packages/**/tests/**)
// is lint-exempt, so it may import @playwright/test AND the driver SDK; the
// factory (harness.ts) imports neither a driver SDK nor a browser.
import { test, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import type { Session, SessionConfig } from "@sentinele2e/contracts";
import type { TelemetrySink } from "@sentinele2e/core";
import { PlaywrightDriver } from "@sentinele2e/driver-playwright";
import { defineDriverContract, type DriverHarness } from "./harness";
import { LOGIN_DOM, INVALID_DOM, toDataUrl } from "./fixtures";

// One browser for the whole file; one fresh page per open() (re-navigated).
// A WeakMap keys the owning Page off each Session so close() is deterministic
// even when the runner executes tests in parallel.
let browser: Browser;
const sessionPages = new WeakMap<Session, Page>();

test.beforeAll(async () => {
  browser = await chromium.launch();
});

test.afterAll(async () => {
  try {
    if (browser) await browser.close();
  } catch {
    /* best-effort teardown */
  }
});

function makeHarness(): DriverHarness {
  const driver = new PlaywrightDriver();
  return {
    name: "playwright",
    driver,
    async open(
      fixtureUrl: string,
      sink: TelemetrySink,
      opts?: Partial<SessionConfig>,
    ): Promise<Session> {
      const page = await browser.newPage();
      await page.goto(fixtureUrl);
      const session = await driver.createSession(
        { existingPage: page, defaultTimeoutMs: 5000, ...opts },
        sink,
      );
      sessionPages.set(session, page);
      return session;
    },
    async close(session: Session): Promise<void> {
      // The page lifecycle is owned here (Session.end() is a no-op page-wrap).
      const page = sessionPages.get(session);
      if (page !== undefined) {
        sessionPages.delete(session);
        await page.close();
      }
    },
  };
}

defineDriverContract(makeHarness, {
  loginUrl: toDataUrl(LOGIN_DOM),
  invalidUrl: toDataUrl(INVALID_DOM),
});

// packages/contracts/tests/conformance/selenium.contract.test.ts
//
// Selenium adapter for the shared conformance suite (spec §6). GATED on
// SENTINEL_SELENIUM (Selenium Manager provisions chromedriver on first run);
// serialized + long timeout so the cold-start fetch can't race or flake.
// One WebDriver per file, reused via beforeAll/afterAll and re-navigated per
// open(). This file (packages/**/tests/**) is lint-exempt -> it may import the
// driver SDK and selenium-webdriver; the factory (harness.ts) imports neither.
import { test, expect } from "@playwright/test";
import type { Locator, Session, SessionConfig } from "@sentinel/contracts";
import { InMemorySink } from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { Builder, Browser, type WebDriver } from "selenium-webdriver";
import { Options } from "selenium-webdriver/chrome";
import { SeleniumDriver } from "@sentinel/driver-selenium";
import { defineDriverContract, type DriverHarness } from "./harness";
import { LOGIN_DOM, INVALID_DOM, toDataUrl } from "./fixtures";

const RUN = Boolean(process.env.SENTINEL_SELENIUM);

// Cold chromedriver fetch + warm sessions: serial + 60s (spec §6 / D7).
test.describe.configure({ mode: "serial", timeout: 60_000 });

const LOGIN_URL = toDataUrl(LOGIN_DOM);
const INVALID_URL = toDataUrl(INVALID_DOM);

let driver: WebDriver;

async function buildHeadlessChrome(): Promise<WebDriver> {
  const opts = new Options().addArguments(
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

function makeHarness(): DriverHarness {
  const sd = new SeleniumDriver();
  return {
    name: "selenium",
    driver: sd,
    async open(
      fixtureUrl: string,
      sink: TelemetrySink,
      opts?: Partial<SessionConfig>,
    ): Promise<Session> {
      // Re-navigate the single shared WebDriver per open (serial => no race).
      await driver.get(fixtureUrl);
      return sd.createSession(
        { existingSession: driver, defaultTimeoutMs: 5000, ...opts },
        sink,
      );
    },
    async close(_session: Session): Promise<void> {
      // WebDriver lifecycle is owned by afterAll (one per file).
    },
  };
}

if (RUN) {
  // beforeAll/afterAll for the shared WebDriver live INSIDE the factory's
  // describe via a thin wrapper describe so teardown is guaranteed.
  test.describe("selenium conformance (browser-backed)", () => {
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

    defineDriverContract(makeHarness, {
      loginUrl: LOGIN_URL,
      invalidUrl: INVALID_URL,
    });

    // Selenium-specific no-false-drift guarantee (spec §6 NOTE): a role-first +
    // css-fallback locator resolves via css with degraded:false — role is SKIPPED
    // (unadvertised on selenium), never MISSED, so it must not count as drift.
    test("role-first + css-fallback resolves via css with degraded:false (role skipped, not missed)", async () => {
      const sink = new InMemorySink();
      const session = await makeHarness().open(INVALID_URL, sink);
      const roleFirst: Locator = {
        logicalName: "conf.roleFirst.submit",
        candidates: [
          { kind: "role", value: "button", options: { name: "Login" } },
          { kind: "css", value: "button.btn-login" },
        ],
      } as Locator;
      await session.action.read(roleFirst);
      const ev = sink.events.find(
        (e) => (e as { type: string }).type === "locator.resolved",
      ) as unknown as {
        degraded: boolean;
        resolvedKind: string;
        candidates: { kind: string; outcome: string }[];
      };
      expect(ev.candidates.find((c) => c.kind === "role")?.outcome).toBe(
        "skipped",
      );
      expect(ev.resolvedKind).toBe("css");
      expect(ev.degraded).toBe(false);
    });
  });
} else {
  // Graceful skip (D7): the whole Selenium suite reports as skipped offline.
  test.skip("selenium conformance suite (set SENTINEL_SELENIUM=1)", () => {});
}

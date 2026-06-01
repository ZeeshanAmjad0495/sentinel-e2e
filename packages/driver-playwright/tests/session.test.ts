// packages/driver-playwright/tests/session.test.ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, CapabilityUnsupportedError } from "@sentinel/core";
import { PlaywrightSession } from "../src/session";

const ready: Locator = {
  logicalName: "x.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

function makeSession(page: Page) {
  return new PlaywrightSession(page, new InMemorySink(), {
    defaultTimeoutMs: 300,
    strategies: new Set(["role", "label", "text", "testid", "css", "xpath"]),
    capabilities: new Set([
      "navigation",
      "dom",
      "accessibilityTree",
      "screenshot",
    ]),
  });
}

test("id is a uuid and capabilities are declared", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  expect(session.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(session.driver).toBe("playwright");
  expect(session.supports("navigation")).toBe(true);
  expect(session.supports("gestures")).toBe(false);
});

test("require() throws CapabilityUnsupportedError for an absent capability", async ({
  page,
}) => {
  await page.setContent(`<div></div>`);
  const session = makeSession(page);
  expect(() => session.require("gestures")).toThrow(CapabilityUnsupportedError);
});

test("locate returns a re-resolving handle", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  const handle = session.locate(ready);
  expect(await handle.isVisible()).toBe(true);
});

test("gated navigation methods are present and currentUrl reads the page", async ({
  page,
}) => {
  await page.goto("data:text/html,<div class='desktop-wrapper'>x</div>");
  const session = makeSession(page);
  expect(typeof session.navigate).toBe("function");
  expect(typeof session.back).toBe("function");
  expect(await session.currentUrl?.()).toContain("data:text/html");
});

test("screenshot returns a Buffer", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  const shot = await session.screenshot?.();
  expect(Buffer.isBuffer(shot)).toBe(true);
});

// packages/driver-playwright/tests/driver.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink, DriverSessionError } from "@sentinele2e/core";
import { PlaywrightDriver } from "../src/driver";

const ready: Locator = {
  logicalName: "x.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

test("driver advertises name, capabilities, strategies", () => {
  const d = new PlaywrightDriver();
  expect(d.name).toBe("playwright");
  expect([...d.capabilities].sort()).toEqual(
    ["accessibilityTree", "dom", "navigation", "screenshot"].sort(),
  );
  expect([...d.strategies].sort()).toEqual(
    ["css", "label", "role", "testid", "text", "xpath"].sort(),
  );
});

test("createSession wraps an existing Page into a working Session", async ({
  page,
}) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const d = new PlaywrightDriver();
  const session = await d.createSession(
    { existingPage: page, defaultTimeoutMs: 300 },
    new InMemorySink(),
  );
  expect(session.driver).toBe("playwright");
  await expect(session.locate(ready).isVisible()).resolves.toBe(true);
});

test("createSession throws DriverSessionError on a non-Page existingPage", async () => {
  const d = new PlaywrightDriver();
  const err = await d
    .createSession(
      { existingPage: { not: "a page" }, defaultTimeoutMs: 300 },
      new InMemorySink(),
    )
    .then(() => null)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DriverSessionError);
});

test("createSession throws DriverSessionError when existingPage is absent", async () => {
  const d = new PlaywrightDriver();
  const err = await d
    .createSession({ defaultTimeoutMs: 300 }, new InMemorySink())
    .then(() => null)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DriverSessionError);
});

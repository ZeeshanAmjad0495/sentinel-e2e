// packages/driver-playwright/tests/resolver.test.ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Locator } from "@sentinele2e/contracts";
import { InMemorySink } from "@sentinele2e/core";
import {
  SelectorNotFoundError,
  SelectorAmbiguousError,
} from "@sentinele2e/core";
import { PlaywrightResolver } from "../src/resolver";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);

const HTML = `
  <button class="go" type="submit">Login</button>
  <span class="dup">a</span><span class="dup">b</span>
`;

function makeResolver(page: Page, sink: InMemorySink) {
  return new PlaywrightResolver(page, STRATEGIES, sink, {
    correlationId: "corr-1",
    flowName: "test.flow",
    startedAt: Date.now(),
  });
}

test("emits locator.resolved BEFORE the handle is usable, degraded when primary missing", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Absent" } }, // rank 0, misses
      { kind: "css", value: "button.go" }, // rank 6 fallback, matches
    ],
  } as Locator;

  // Sink is empty until resolve() emits.
  expect(sink.events).toHaveLength(0);

  const resolution = await resolver.resolve(locator);

  // The emit happened, and it happened before we ever touched the handle.
  const resolved = sink.events.find((e) => e.type === "locator.resolved");
  expect(resolved).toBeDefined();
  expect(resolution.degraded).toBe(true);
  expect(resolution.resolvedKind).toBe("css");
  expect(resolution.resolvedRank).toBeGreaterThan(0);

  // candidates[] records the primary as missed, fallback as matched.
  const ev = resolved as unknown as {
    candidates: { kind: string; outcome: string }[];
  };
  expect(ev.candidates.find((c) => c.kind === "role")?.outcome).toBe("missed");
  expect(ev.candidates.find((c) => c.kind === "css")?.outcome).toBe("matched");

  // Handle is usable AFTER (proves emit-before-return ordering).
  await expect(resolution.handle.isVisible()).resolves.toBe(true);
});

test("skips kinds the driver does not advertise", async ({ page }) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "image", value: "x" }, // not in STRATEGIES -> skipped
      { kind: "css", value: "button.go" },
    ],
  } as Locator;

  await resolver.resolve(locator);
  const ev = sink.events.find(
    (e) => e.type === "locator.resolved",
  ) as unknown as {
    candidates: { kind: string; outcome: string }[];
  };
  expect(ev.candidates.find((c) => c.kind === "image")?.outcome).toBe(
    "skipped",
  );
});

test("throws SelectorNotFoundError with attempted[] when all supported miss", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.ghost",
    candidates: [{ kind: "css", value: "button.does-not-exist" }],
  } as Locator;

  await expect(resolver.resolve(locator)).rejects.toBeInstanceOf(
    SelectorNotFoundError,
  );
  try {
    await resolver.resolve(locator);
  } catch (err) {
    const e = err as SelectorNotFoundError;
    expect(e.context.logicalName).toBe("auth.login.ghost");
    expect(e.context.attempted?.[0]?.matched).toBe(false);
  }
});

test("throws SelectorAmbiguousError on >1 match", async ({ page }) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.dup",
    candidates: [{ kind: "css", value: "span.dup" }],
  } as Locator;

  await expect(resolver.resolve(locator)).rejects.toBeInstanceOf(
    SelectorAmbiguousError,
  );
});

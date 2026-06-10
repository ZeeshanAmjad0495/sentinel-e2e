// packages/driver-playwright/tests/assertion-waitfor.test.ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, TimeoutError } from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAssertion } from "../src/assertion";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const HTML = `<button class="go">Login</button>`;

const present: Locator = {
  logicalName: "x.present",
  candidates: [{ kind: "css", value: "button.go" }],
} as Locator;
const absent: Locator = {
  logicalName: "x.absent",
  candidates: [{ kind: "css", value: "button.missing" }],
} as Locator;

function makeAssert(page: Page, sink: InMemorySink) {
  return new PlaywrightAssertion(
    page,
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
    sink,
    CTX,
    200,
  );
}

test("waitFor resolves on a visible element and emits assertion", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const assertion = makeAssert(page, sink);

  await assertion.waitFor(present, "visible");

  const ev = sink.events.find((e) => e.type === "assertion") as unknown as {
    matched: boolean;
  };
  expect(ev.matched).toBe(true);
});

test("waitFor throws TimeoutError (not a bare Error) on a missing element", async ({
  page,
}) => {
  await page.setContent(HTML);
  const assertion = makeAssert(page, new InMemorySink());

  const err = await assertion
    .waitFor(absent, "visible", { timeoutMs: 150 })
    .then(() => null)
    .catch((e: unknown) => e);

  expect(err).toBeInstanceOf(TimeoutError);
  expect((err as TimeoutError).context.flowName).toBe("f");
});

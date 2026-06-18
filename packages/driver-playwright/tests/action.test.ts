// packages/driver-playwright/tests/action.test.ts
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink } from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAction } from "../src/action";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const HTML = `
  <input id="user" />
  <button class="go" type="submit">Login</button>
  <span class="msg">ready</span>
`;

const user: Locator = {
  logicalName: "x.user",
  candidates: [{ kind: "css", value: "#user" }],
} as Locator;
const submit: Locator = {
  logicalName: "x.submit",
  candidates: [{ kind: "css", value: "button.go" }],
} as Locator;
const msg: Locator = {
  logicalName: "x.msg",
  candidates: [{ kind: "css", value: "span.msg" }],
} as Locator;

function makeAction(page: Page, sink: InMemorySink) {
  return new PlaywrightAction(
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
    5000,
  );
}

test("typeText then read round-trips and emits a resolve per call", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const action = makeAction(page, sink);

  await action.typeText(user, "alice");
  expect(await action.read(user)).toBe("alice");

  const resolves = sink.events.filter((e) => e.type === "locator.resolved");
  expect(resolves.length).toBeGreaterThanOrEqual(2);
});

test("clear empties an input", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  await action.typeText(user, "bob");
  await action.clear(user);
  expect(await action.read(user)).toBe("");
});

test("tap clicks the resolved element", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  await page.evaluate(() =>
    document.querySelector("button.go")?.addEventListener("click", () => {
      document.querySelector("span.msg")!.textContent = "clicked";
    }),
  );
  await action.tap(submit);
  await expect(page.locator("span.msg")).toHaveText("clicked");
});

test("read returns text content of a non-input element", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  expect(await action.read(msg)).toBe("ready");
});

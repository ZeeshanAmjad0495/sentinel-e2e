// packages/driver-playwright/tests/strategy-compiler.test.ts
import { test, expect } from "@playwright/test";
import type { LocatorStrategy } from "@sentinel/contracts";
import { compileStrategy } from "../src/strategy-compiler";

const HTML = `
  <label for="email">Email</label><input id="email" />
  <span data-testid="greeting">hello</span>
  <p class="note">plain text</p>
  <button type="submit" class="go">Login</button>
`;

test("compiles role with name+exact", async ({ page }) => {
  await page.setContent(HTML);
  const s: LocatorStrategy = {
    kind: "role",
    value: "button",
    options: { name: "Login", exact: true },
  };
  await expect(compileStrategy(page, s)).toHaveText("Login");
});

test("compiles label, text, testid", async ({ page }) => {
  await page.setContent(HTML);
  await expect(
    compileStrategy(page, { kind: "label", value: "Email" }),
  ).toHaveAttribute("id", "email");
  await expect(
    compileStrategy(page, { kind: "text", value: "plain text" }),
  ).toHaveClass("note");
  await expect(
    compileStrategy(page, { kind: "testid", value: "greeting" }),
  ).toHaveText("hello");
});

test("compiles css and xpath via page.locator", async ({ page }) => {
  await page.setContent(HTML);
  await expect(
    compileStrategy(page, { kind: "css", value: "button.go" }),
  ).toHaveText("Login");
  await expect(
    compileStrategy(page, { kind: "xpath", value: "//button[@class='go']" }),
  ).toHaveText("Login");
});

test("throws on a kind it cannot compile", async ({ page }) => {
  await page.setContent(HTML);
  expect(() => compileStrategy(page, { kind: "image", value: "x" })).toThrow(
    /unsupported strategy kind/i,
  );
});

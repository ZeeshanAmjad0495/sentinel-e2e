// packages/driver-selenium/tests/strategy-compiler.test.ts
// PURE unit tests — NO browser. Asserts the {using,value} descriptor per kind.
import { test, expect } from "@playwright/test";
import type { LocatorStrategy } from "@sentinel/contracts";
import { compileStrategy } from "../src/strategy-compiler";

const CSS = "css selector";
const XPATH = "xpath";

test("css passthrough", () => {
  expect(compileStrategy({ kind: "css", value: "button.go" })).toEqual({
    using: CSS,
    value: "button.go",
  });
});

test("xpath passthrough", () => {
  expect(compileStrategy({ kind: "xpath", value: "//button[1]" })).toEqual({
    using: XPATH,
    value: "//button[1]",
  });
});

test("testid is always an exact data-testid attribute selector", () => {
  expect(compileStrategy({ kind: "testid", value: "submit-btn" })).toEqual({
    using: CSS,
    value: '[data-testid="submit-btn"]',
  });
});

test("placeholder defaults to substring, exact via options", () => {
  expect(compileStrategy({ kind: "placeholder", value: "Email" })).toEqual({
    using: CSS,
    value: '[placeholder*="Email"]',
  });
  expect(
    compileStrategy({
      kind: "placeholder",
      value: "Email",
      options: { exact: true },
    }),
  ).toEqual({ using: CSS, value: '[placeholder="Email"]' });
});

test("title defaults to substring, exact via options", () => {
  expect(compileStrategy({ kind: "title", value: "Close" })).toEqual({
    using: CSS,
    value: '[title*="Close"]',
  });
  expect(
    compileStrategy({
      kind: "title",
      value: "Close",
      options: { exact: true },
    }),
  ).toEqual({ using: CSS, value: '[title="Close"]' });
});

test("altText defaults to substring, exact via options", () => {
  expect(compileStrategy({ kind: "altText", value: "Logo" })).toEqual({
    using: CSS,
    value: '[alt*="Logo"]',
  });
  expect(
    compileStrategy({
      kind: "altText",
      value: "Logo",
      options: { exact: true },
    }),
  ).toEqual({ using: CSS, value: '[alt="Logo"]' });
});

test("text -> xpath normalize-space substring by default, exact via options", () => {
  expect(compileStrategy({ kind: "text", value: "Login" })).toEqual({
    using: XPATH,
    value: ".//*[contains(normalize-space(.),'Login')]",
  });
  expect(
    compileStrategy({ kind: "text", value: "Login", options: { exact: true } }),
  ).toEqual({ using: XPATH, value: ".//*[normalize-space(.)='Login']" });
});

test("label -> the §5.2 xpath union (substring default)", () => {
  const out = compileStrategy({ kind: "label", value: "Email" });
  expect(out.using).toBe(XPATH);
  // for/id mapping, wrapping, aria-label, aria-labelledby — single-token spot checks.
  expect(out.value).toContain(
    "//input[@id=//label[contains(normalize-space(.),'Email')]/@for]",
  );
  expect(out.value).toContain(
    "//label[contains(normalize-space(.),'Email')]//input",
  );
  expect(out.value).toContain("//*[@aria-label='Email']");
  expect(out.value).toContain(
    "//*[@aria-labelledby=//*[contains(normalize-space(.),'Email')]/@id]",
  );
});

test("label exact uses normalize-space equality", () => {
  const out = compileStrategy({
    kind: "label",
    value: "Email",
    options: { exact: true },
  });
  expect(out.value).toContain("//label[normalize-space(.)='Email']//input");
});

test("text value with only a single quote uses a double-quoted xpath literal", () => {
  const out = compileStrategy({ kind: "text", value: "it's here" });
  expect(out).toEqual({
    using: XPATH,
    value: './/*[contains(normalize-space(.),"it\'s here")]',
  });
});

test("text value with BOTH quote kinds escapes via concat()", () => {
  // `a'b"c` has both ' and " -> neither simple literal works -> concat().
  const out = compileStrategy({ kind: "text", value: `a'b"c` });
  expect(out.using).toBe(XPATH);
  // split on ' -> ["a", `b"c`]; rejoined as 'a' + "'" + 'b"c'.
  expect(out.value).toBe(
    ".//*[contains(normalize-space(.),concat('a', \"'\", 'b\"c'))]",
  );
});

test("embedded double quote in a css attr value escapes the quote", () => {
  const out = compileStrategy({ kind: "placeholder", value: 'a"b' });
  expect(out).toEqual({ using: CSS, value: '[placeholder*="a\\"b"]' });
});

test("role throws (no a11y-tree on Selenium)", () => {
  expect(() =>
    compileStrategy({ kind: "role", value: "button" } as LocatorStrategy),
  ).toThrow(/unsupported strategy kind/);
});

test("unknown kind throws", () => {
  expect(() =>
    compileStrategy({ kind: "relative", value: "x" } as LocatorStrategy),
  ).toThrow(/unsupported strategy kind/);
});

// packages/ai/tests/redact-text.test.ts
import { test, expect } from "@playwright/test";
import { redactText } from "@sentinele2e/ai";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

test("redactText scrubs a JWT to [redacted]", () => {
  const out = redactText(`auth header was ${JWT}`);
  expect(out).not.toContain("eyJ");
  expect(out).toContain("[redacted]");
});

test("redactText scrubs a Bearer token, preserving surrounding prose", () => {
  const out = redactText("request failed: Bearer abc123.def-456_GHI=");
  expect(out).not.toContain("abc123.def-456_GHI");
  expect(out).toContain("[redacted]");
  expect(out).toContain("request failed:");
});

test("redactText scrubs an sk- API key prefix", () => {
  const out = redactText("key=sk-abcdefghijklmnop0123");
  expect(out).not.toContain("sk-abcdefghijklmnop0123");
  expect(out).toContain("[redacted]");
});

test("redactText PRESERVES a UUID (no false-positive on ids)", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  expect(redactText(uuid)).toBe(uuid);
});

test("redactText PRESERVES a plain CSS selector", () => {
  const selector = "div.app-shell > button[data-testid='submit']";
  expect(redactText(selector)).toBe(selector);
});

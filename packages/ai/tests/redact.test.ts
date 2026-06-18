// packages/ai/tests/redact.test.ts
import { test, expect } from "@playwright/test";
import { redactEvents } from "@sentinele2e/ai";
import type { TelemetryEvent } from "@sentinele2e/ai";

const baseEvent = (
  attributes: Readonly<Record<string, string | number | boolean>>,
): TelemetryEvent =>
  ({
    schemaVersion: "1.0.0",
    eventId: "e-1",
    type: "component.action",
    traceId: "run-1",
    spanId: "s",
    sequence: 0,
    name: "loginForm.submit",
    timing: { startWallClockMs: 1, startMonotonicNs: "1" },
    attributes,
  }) as unknown as TelemetryEvent;

test("redactEvents replaces a secret-keyed value with [redacted]", () => {
  const events = [baseEvent({ password: "hunter2", username: "alice" })];
  const redacted = redactEvents(events);

  const attrs = redacted[0]?.attributes as Record<string, unknown>;
  expect(attrs.password).toBe("[redacted]");
  // non-secret field untouched
  expect(attrs.username).toBe("alice");
});

test("redactEvents matches the full secret key set, case-insensitively", () => {
  const events = [
    baseEvent({
      Authorization: "Bearer abc",
      apiKey: "k",
      "api-key": "k2",
      sessionToken: "t",
      Cookie: "c",
      credential: "x",
      secretValue: "s",
      okField: 42,
    }),
  ];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;

  expect(attrs.Authorization).toBe("[redacted]");
  expect(attrs.apiKey).toBe("[redacted]");
  expect(attrs["api-key"]).toBe("[redacted]");
  expect(attrs.sessionToken).toBe("[redacted]");
  expect(attrs.Cookie).toBe("[redacted]");
  expect(attrs.credential).toBe("[redacted]");
  expect(attrs.secretValue).toBe("[redacted]");
  // ordinary field preserved with its original type
  expect(attrs.okField).toBe(42);
});

test("redactEvents deep-clones — the input is not mutated", () => {
  const events = [baseEvent({ password: "hunter2" })];
  const redacted = redactEvents(events);

  const originalAttrs = events[0]?.attributes as Record<string, unknown>;
  const redactedAttrs = redacted[0]?.attributes as Record<string, unknown>;
  expect(originalAttrs.password).toBe("hunter2"); // source untouched
  expect(redactedAttrs.password).toBe("[redacted]");
  expect(redacted[0]).not.toBe(events[0]); // new object
});

// --- value-based redaction (spec §7) ---

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

test("redactEvents scrubs a JWT value under a NON-secret key (attributes.note)", () => {
  const events = [baseEvent({ note: `auth header was ${JWT}` })];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;
  expect(attrs.note).not.toContain("eyJ");
  expect(attrs.note).toContain("[redacted]");
});

test("redactEvents scrubs a Bearer token inside a message-like string", () => {
  const events = [
    baseEvent({ message: "request failed: Bearer abc123.def-456_GHI=" }),
  ];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;
  expect(attrs.message).not.toContain("abc123.def-456_GHI");
  expect(attrs.message).toContain("[redacted]");
  // the surrounding non-secret text survives
  expect(attrs.message).toContain("request failed:");
});

test("redactEvents PRESERVES a UUID value (traceId-shaped) — no false-positive on ids", () => {
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const events = [baseEvent({ note: uuid })];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;
  expect(attrs.note).toBe(uuid);
});

test("redactEvents preserves a plain CSS selector and an ordinary sentence", () => {
  const selector = "div.app-shell > button[data-testid='submit']";
  const sentence = "The login form never reached the visible state.";
  const events = [baseEvent({ selector, sentence, count: 12345 })];
  const attrs = redactEvents(events)[0]?.attributes as Record<string, unknown>;
  expect(attrs.selector).toBe(selector);
  expect(attrs.sentence).toBe(sentence);
  expect(attrs.count).toBe(12345);
});

test("redactEvents value-based redaction does not mutate the input", () => {
  const events = [baseEvent({ note: `token ${JWT}` })];
  redactEvents(events);
  const originalAttrs = events[0]?.attributes as Record<string, unknown>;
  expect(originalAttrs.note).toBe(`token ${JWT}`);
});

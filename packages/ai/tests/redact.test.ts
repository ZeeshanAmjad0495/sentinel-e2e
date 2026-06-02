// packages/ai/tests/redact.test.ts
import { test, expect } from "@playwright/test";
import { redactEvents } from "@sentinel/ai";
import type { TelemetryEvent } from "@sentinel/ai";

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

// packages/core/tests/error-kinds.test.ts
import { test, expect } from "@playwright/test";
import {
  TimeoutError,
  SelectorNotFoundError,
  SelectorAmbiguousError,
  DriverSessionError,
  AssertionInfrastructureError,
  CapabilityUnsupportedError,
  isSystemFailure,
  SystemFailureError,
  type SystemFailureContext,
} from "@sentinele2e/core";

const ctx: SystemFailureContext = {
  correlationId: "run-1",
  flowName: "auth.login",
  startedAt: 1000,
  durationMs: 5,
};

test("each subclass has the specified kind, retryable and name", () => {
  const cases = [
    {
      e: new TimeoutError("t", ctx),
      kind: "timeout",
      retryable: true,
      name: "TimeoutError",
    },
    {
      e: new SelectorNotFoundError("s", ctx),
      kind: "selector-not-found",
      retryable: false,
      name: "SelectorNotFoundError",
    },
    {
      e: new SelectorAmbiguousError("s", ctx),
      kind: "selector-ambiguous",
      retryable: false,
      name: "SelectorAmbiguousError",
    },
    {
      e: new DriverSessionError("d", ctx),
      kind: "driver-session",
      retryable: true,
      name: "DriverSessionError",
    },
    {
      e: new AssertionInfrastructureError("a", ctx),
      kind: "assertion-infrastructure",
      retryable: false,
      name: "AssertionInfrastructureError",
    },
    {
      e: new CapabilityUnsupportedError("c", ctx),
      kind: "capability-unsupported",
      retryable: false,
      name: "CapabilityUnsupportedError",
    },
  ] as const;
  for (const c of cases) {
    expect(c.e.kind).toBe(c.kind);
    expect(c.e.retryable).toBe(c.retryable);
    expect(c.e.name).toBe(c.name);
    expect(c.e).toBeInstanceOf(SystemFailureError);
  }
});

test("isSystemFailure narrows SystemFailureError and rejects plain errors", () => {
  expect(isSystemFailure(new TimeoutError("t", ctx))).toBe(true);
  expect(isSystemFailure(new Error("plain"))).toBe(false);
  expect(isSystemFailure("nope")).toBe(false);
});

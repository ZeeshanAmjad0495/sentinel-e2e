// packages/core/tests/system-failure-error.test.ts
import { test, expect } from "@playwright/test";
import {
  SystemFailureError,
  type SystemFailureContext,
  type SystemFailureKind,
  type Artifact,
} from "@sentinel/core";

class FakeError extends SystemFailureError {
  readonly kind: SystemFailureKind = "timeout";
  readonly retryable = true;
}

const ctx: SystemFailureContext = {
  correlationId: "run-1",
  flowName: "auth.login",
  startedAt: 1000,
  durationMs: 5,
};

test("base wires name, message, context, kind and retryable", () => {
  const e = new FakeError("boom", ctx);
  expect(e).toBeInstanceOf(Error);
  expect(e).toBeInstanceOf(SystemFailureError);
  expect(e.message).toBe("boom");
  expect(e.name).toBe("FakeError");
  expect(e.kind).toBe("timeout");
  expect(e.retryable).toBe(true);
  expect(e.context.correlationId).toBe("run-1");
});

test("captureStackTrace produces a stack omitting the constructor frame", () => {
  const e = new FakeError("boom", ctx);
  expect(typeof e.stack).toBe("string");
  expect(e.stack).not.toContain("at new FakeError");
});

test("cause is attached only when present in context", () => {
  const raw = new Error("driver exploded");
  const withCause = new FakeError("boom", { ...ctx, cause: raw });
  expect((withCause as { cause?: unknown }).cause).toBe(raw);
  const noCause = new FakeError("boom", ctx);
  expect((noCause as { cause?: unknown }).cause).toBeUndefined();
});

test("Artifact shape is satisfiable", () => {
  const a: Artifact = { kind: "dom-snapshot", ref: "test-results/x.html" };
  expect(a.kind).toBe("dom-snapshot");
});

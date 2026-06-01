// packages/core/tests/result.test.ts
import { test, expect } from "@playwright/test";
import {
  ok,
  businessFailure,
  isSuccess,
  assertNever,
  type Result,
  type ResultMeta,
} from "@sentinel/core";

const meta: ResultMeta = {
  correlationId: "run-1",
  flowName: "auth.login",
  startedAt: 1000,
  durationMs: 42,
};

test("ok() builds a Success and isSuccess narrows to data", () => {
  const r = ok({ username: "admin" }, meta);
  expect(r.status).toBe("success");
  expect(isSuccess(r)).toBe(true);
  if (isSuccess(r)) expect(r.data.username).toBe("admin");
});

test("businessFailure() carries reason/message/details and narrows", () => {
  const r = businessFailure<"INVALID_CREDENTIALS", { username: string }>(
    "INVALID_CREDENTIALS",
    meta,
    { message: "Invalid Login. Try again.", details: { username: "admin" } },
  );
  expect(r.status).toBe("business-failure");
  expect(isSuccess(r)).toBe(false);
  if (!isSuccess(r)) {
    expect(r.reason).toBe("INVALID_CREDENTIALS");
    expect(r.message).toBe("Invalid Login. Try again.");
    expect(r.details?.username).toBe("admin");
  }
});

test("businessFailure() omits optional fields when opts not given", () => {
  const r = businessFailure("INVALID_CREDENTIALS", meta);
  expect(r.message).toBeUndefined();
  expect(r.details).toBeUndefined();
});

test("assertNever throws on a non-never value at runtime", () => {
  const r = ok(1, meta) as Result<number>;
  const run = () => {
    switch (r.status) {
      case "success":
        return r.data;
      case "business-failure":
        return -1;
      default:
        return assertNever(r);
    }
  };
  expect(run()).toBe(1);
  expect(() => assertNever({ status: "ghost" } as never)).toThrow(
    /Unhandled Result variant/,
  );
});

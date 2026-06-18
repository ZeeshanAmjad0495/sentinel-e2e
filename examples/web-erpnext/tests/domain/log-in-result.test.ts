// examples/web-erpnext/tests/domain/log-in-result.test.ts
import { test, expect } from "@playwright/test";
import type {
  LoginResult,
  LoginSuccessData,
  LoginReason,
  LoginFailureDetails,
} from "../../src/domain/auth/log-in-result";
import type { ResultMeta } from "@sentinele2e/core";

const meta: ResultMeta = {
  correlationId: "c-1",
  flowName: "auth.login",
  startedAt: 0,
  durationMs: 1,
};

test("LoginResult success variant conforms to the rich Result", () => {
  const data: LoginSuccessData = { username: "admin", finalUrl: "/app" };
  const success: LoginResult = { status: "success", data, meta };
  expect(success.status).toBe("success");
  if (success.status === "success") {
    expect(success.data.username).toBe("admin");
  }
});

test("LoginResult business-failure variant carries stable reason", () => {
  const reason: LoginReason = "INVALID_CREDENTIALS";
  const details: LoginFailureDetails = { username: "admin" };
  const failure: LoginResult = {
    status: "business-failure",
    reason,
    message: "Invalid Login. Try again.",
    details,
    meta,
  };
  expect(failure.status).toBe("business-failure");
  if (failure.status === "business-failure") {
    expect(failure.reason).toBe("INVALID_CREDENTIALS");
  }
});

// examples/web-erpnext/tests/domain/auth-barrel.test.ts
import { test, expect } from "@playwright/test";
import type { Credentials, LoginResult } from "../../src/domain/auth";

test("auth barrel re-exports Credentials and LoginResult as types", () => {
  const creds: Credentials = { username: "u", password: "p" };
  const result: LoginResult = {
    status: "success",
    data: { username: "u" },
    meta: {
      correlationId: "c",
      flowName: "auth.login",
      startedAt: 0,
      durationMs: 0,
    },
  };
  expect(creds.username).toBe("u");
  expect(result.status).toBe("success");
});

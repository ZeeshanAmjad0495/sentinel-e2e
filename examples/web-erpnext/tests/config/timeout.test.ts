// examples/web-erpnext/tests/config/timeout.test.ts
import { test, expect } from "@playwright/test";
import { defaultTimeoutMs } from "../../src/config/timeout";

test("defaultTimeoutMs is the single 10s timeout source of truth", () => {
  expect(defaultTimeoutMs).toBe(10_000);
  expect(typeof defaultTimeoutMs).toBe("number");
});

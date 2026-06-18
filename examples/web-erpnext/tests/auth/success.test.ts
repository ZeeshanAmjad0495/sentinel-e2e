// examples/web-erpnext/tests/auth/success.test.ts
// Offline (.test.ts so it runs under `npm run test:unit`, which needs no BASE_URL env).
// Drives the REAL logIn flow against a success page whose submit swaps in the app shell.
import { test, expect } from "@playwright/test";
import { InMemorySink } from "@sentinele2e/core";
import { logIn } from "../../src/flows";
import { SUCCESS_DOM } from "../_support/login-dom";

test("successful login returns success and emits flow.finished outcome:success (no business.failure)", async ({
  page,
}) => {
  await page.setContent(SUCCESS_DOM);
  const sink = new InMemorySink();

  const result = await logIn(
    page,
    { username: "valid-user", password: "valid-pass" },
    { sink },
  );

  expect(result.status).toBe("success");
  expect((result as { data: { username: string } }).data.username).toBe(
    "valid-user",
  );

  const types = sink.events.map((e) => e.type);
  expect(types).not.toContain("business.failure");

  const finished = sink.events.find((e) => e.type === "flow.finished");
  expect(finished).toBeDefined();
  expect((finished as { outcome: string }).outcome).toBe("success");
});

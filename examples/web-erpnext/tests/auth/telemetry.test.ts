// examples/web-erpnext/tests/auth/telemetry.test.ts
// Offline (.test.ts so it runs under `npm run test:unit`, which needs no BASE_URL env).
import { test, expect } from "@playwright/test";
import { InMemorySink } from "@sentinele2e/core";
import { logIn } from "../../src/flows";
import { INVALID_DOM } from "../_support/login-dom";

test("invalid login emits locator.resolved, assertion, flow.finished, business.failure", async ({
  page,
}) => {
  await page.setContent(INVALID_DOM);
  const sink = new InMemorySink();

  const result = await logIn(
    page,
    { username: "wrong", password: "wrong" },
    { sink },
  );

  expect(result.status).toBe("business-failure");

  const types = sink.events.map((e) => e.type);
  expect(types).toContain("locator.resolved");
  expect(types).toContain("assertion");
  expect(types).toContain("flow.finished");
  expect(types).toContain("business.failure");

  const resolved = sink.events.find((e) => e.type === "locator.resolved");
  expect(resolved).toBeDefined();
  expect(typeof (resolved as { resolvedRank: number }).resolvedRank).toBe(
    "number",
  );
  expect(
    Array.isArray(
      (resolved as unknown as { candidates: unknown[] }).candidates,
    ),
  ).toBe(true);

  const businessFailure = sink.events.find(
    (e) => e.type === "business.failure",
  );
  expect((businessFailure as { domainReason: string }).domainReason).toBe(
    "INVALID_CREDENTIALS",
  );
});

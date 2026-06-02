// examples/web-erpnext/tests/auth/jsonl-telemetry.test.ts
// Offline (.test.ts so it runs under `npm run test:unit`, which needs no BASE_URL env).
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logIn } from "../../src/flows";
import { INVALID_DOM } from "../_support/login-dom";

test("JsonlSink writes <runId>.jsonl whose lines parse and bigint timings round-trip", async ({
  page,
}) => {
  await page.setContent(INVALID_DOM);

  const result = await logIn(page, { username: "wrong", password: "wrong" });
  expect(result.status).toBe("business-failure");

  const runId = result.meta.correlationId;
  const filePath = join("test-results", "telemetry", `${runId}.jsonl`);
  expect(existsSync(filePath)).toBe(true);

  const lines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);

  let sawBigintField = false;
  for (const line of lines) {
    const obj = JSON.parse(line) as {
      timing?: { startMonotonicNs?: string; endMonotonicNs?: string };
    };
    expect(typeof obj).toBe("object");
    const start = obj.timing?.startMonotonicNs;
    if (start !== undefined) {
      sawBigintField = true;
      // serialized as a numeric string; must re-parse to a bigint without throwing.
      expect(typeof start).toBe("string");
      expect(BigInt(start)).toBeGreaterThan(0n);
    }
    const end = obj.timing?.endMonotonicNs;
    if (end !== undefined) {
      expect(BigInt(end)).toBeGreaterThanOrEqual(BigInt(start ?? "0"));
    }
  }
  expect(sawBigintField).toBe(true);
});

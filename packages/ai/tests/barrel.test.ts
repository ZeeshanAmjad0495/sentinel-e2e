// packages/ai/tests/barrel.test.ts
import { test, expect } from "@playwright/test";
import * as ai from "../src/index";

test("barrel exports the deterministic public surface", () => {
  const surface = ai as Record<string, unknown>;
  expect(typeof surface.analyzeRun).toBe("function");
  expect(typeof surface.classify).toBe("function");
  expect(typeof surface.toJson).toBe("function");
  expect(typeof surface.toText).toBe("function");
  expect(typeof surface.redactEvents).toBe("function");
  expect(typeof surface.loadEvents).toBe("function");
  expect(typeof surface.FakeLlmProvider).toBe("function");
  expect(surface.ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
});

test("barrel exports the run-report contract (slice F: buildReport + redactText)", () => {
  const surface = ai as Record<string, unknown>;
  expect(typeof surface.buildReport).toBe("function");
  expect(typeof surface.redactText).toBe("function");
  expect(surface.REPORT_SCHEMA_VERSION).toBe("1.0.0");
});

test("barrel does NOT re-export ClaudeProvider (keeps the SDK lazy)", () => {
  const surface = ai as Record<string, unknown>;
  expect(surface.ClaudeProvider).toBeUndefined();
});

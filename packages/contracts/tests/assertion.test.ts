// packages/contracts/tests/assertion.test.ts
import { test, expect } from "@playwright/test";
import type {
  ElementState,
  BranchProgress,
  Assertion,
  Locator,
} from "@sentinel/contracts";

const loc: Locator = { logicalName: "x", candidates: [], within: (p) => p };

test("ElementState union members are usable", () => {
  const states: ElementState[] = [
    "attached",
    "detached",
    "visible",
    "hidden",
    "enabled",
  ];
  expect(states).toContain("visible");
});

test("BranchProgress carries label, reachedState and resolvedRank (nullable)", () => {
  const progress: BranchProgress<"SUCCESS" | "INVALID"> = {
    label: "INVALID",
    reachedState: "none",
    resolvedRank: null,
  };
  expect(progress.label).toBe("INVALID");
  expect(progress.resolvedRank).toBeNull();
});

test("Assertion.waitForFirstOf returns the winning label", async () => {
  const assertion: Assertion = {
    waitFor: async () => {},
    waitForFirstOf: async (conditions) => conditions[0]!.label,
  };
  const winner = await assertion.waitForFirstOf([
    { label: "INVALID", target: loc, state: "visible" },
    { label: "SUCCESS", target: loc, state: "visible" },
  ]);
  expect(winner).toBe("INVALID");
});

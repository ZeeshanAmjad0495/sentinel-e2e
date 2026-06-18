// packages/core/tests/engine.test.ts
import { test, expect } from "@playwright/test";
import { StrategyRegistry } from "@sentinele2e/core";
import type { LocatorResolution, LocatorResolver } from "@sentinele2e/core";
import type { ElementHandle, Locator } from "@sentinele2e/contracts";

const loc: Locator = {
  logicalName: "auth.login.submit",
  candidates: [{ kind: "css", value: "button" }],
  within: (p) => p,
};
const handle: ElementHandle = {
  locator: loc,
  exists: async () => true,
  isVisible: async () => true,
  isEnabled: async () => true,
  text: async () => "Login",
  attribute: async () => null,
};

test("LocatorResolution carries handle, resolvedKind/Rank, degraded and score", () => {
  const resolution: LocatorResolution = {
    handle,
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    score: 1,
  };
  expect(resolution.degraded).toBe(true);
  expect(resolution.resolvedRank).toBe(6);
});

test("LocatorResolver is satisfiable and resolves to a LocatorResolution", async () => {
  const resolver: LocatorResolver = {
    resolve: async (l) => ({
      handle: { ...handle, locator: l },
      resolvedKind: "css",
      resolvedRank: 6,
      degraded: true,
      score: 1,
    }),
  };
  const res = await resolver.resolve(loc);
  expect(res.handle.locator.logicalName).toBe("auth.login.submit");
  expect(new StrategyRegistry().rankOf(res.resolvedKind)).toBe(6);
});

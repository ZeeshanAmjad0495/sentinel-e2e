// packages/contracts/tests/session-driver.test.ts
import { test, expect } from "@playwright/test";
import type {
  Session,
  SessionConfig,
  Driver,
  Capability,
  StrategyKind,
  ElementHandle,
  Action,
  Assertion,
} from "@sentinele2e/contracts";

const noopAction: Action = {
  tap: async () => {},
  typeText: async () => {},
  clear: async () => {},
  read: async () => "",
};
const noopAssert: Assertion = {
  waitFor: async () => {},
  waitForFirstOf: async (c) => c[0]!.label,
};
const noopHandle: ElementHandle = {
  locator: { logicalName: "x", candidates: [], within: (p) => p },
  exists: async () => false,
  isVisible: async () => false,
  isEnabled: async () => false,
  text: async () => "",
  attribute: async () => null,
};

test("Session is satisfiable with the universal surface (gated methods omitted)", () => {
  const caps: ReadonlySet<Capability> = new Set<Capability>(["dom"]);
  const session: Session = {
    id: "run-1",
    driver: "playwright",
    capabilities: caps,
    telemetry: { emit: () => {}, child: () => session.telemetry },
    supports: (c) => caps.has(c),
    require: () => {},
    locate: () => noopHandle,
    action: noopAction,
    assert: noopAssert,
    end: async () => {},
  };
  expect(session.supports("dom")).toBe(true);
  expect(session.navigate).toBeUndefined();
});

test("Driver advertises capabilities + strategies and createSession", async () => {
  const strategies: ReadonlySet<StrategyKind> = new Set(["css", "role"]);
  const config: SessionConfig = { defaultTimeoutMs: 10_000 };
  const driver: Driver = {
    name: "playwright",
    capabilities: new Set<Capability>(["dom", "navigation"]),
    strategies,
    createSession: async () => ({}) as unknown as Session,
  };
  expect(driver.strategies.has("css")).toBe(true);
  expect(config.defaultTimeoutMs).toBe(10_000);
  expect(typeof driver.createSession).toBe("function");
});

// packages/contracts/tests/capability-locator.test.ts
import { test, expect } from "@playwright/test";
import type {
  Capability,
  CapabilityProbe,
  StrategyKind,
  LocatorStrategy,
  Locator,
  ElementHandle,
} from "@sentinel/contracts";

test("Capability values are the documented union members", () => {
  const caps: Capability[] = [
    "navigation",
    "dom",
    "accessibilityTree",
    "gestures",
    "contexts",
    "screenshot",
    "networkInspection",
  ];
  expect(caps).toHaveLength(7);
});

test("CapabilityProbe shape is satisfiable", () => {
  const probe: CapabilityProbe = {
    supports: (cap: Capability) => cap === "dom",
    require: () => {},
  };
  expect(probe.supports("dom")).toBe(true);
  expect(probe.supports("gestures")).toBe(false);
});

test("StrategyKind is an open string and LocatorStrategy carries kind/value/options", () => {
  const kind: StrategyKind = "-ios predicate string";
  const strat: LocatorStrategy = {
    kind,
    value: "type == 'XCUIElementTypeButton'",
    options: { exact: true },
  };
  expect(strat.kind).toBe("-ios predicate string");
  expect(strat.options?.exact).toBe(true);
});

test("Locator carries logicalName, ordered candidates and within()", () => {
  const child: Locator = {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Login" } },
      { kind: "css", value: "button.btn-login[type='submit']" },
    ],
    within(parent: Locator): Locator {
      return {
        ...this,
        logicalName: `${parent.logicalName}>${this.logicalName}`,
      };
    },
  };
  const parent: Locator = {
    logicalName: "auth.card",
    candidates: [],
    within: child.within,
  };
  expect(child.candidates[0]?.kind).toBe("role");
  // within is OPTIONAL now: guard the call.
  expect(child.within?.(parent)?.logicalName).toBe(
    "auth.card>auth.login.submit",
  );
});

test("Locator without within still satisfies the contract", () => {
  const plain: Locator = {
    logicalName: "auth.login.username",
    candidates: [{ kind: "css", value: "input#login_email" }],
  };
  expect(plain.candidates[0]?.value).toBe("input#login_email");
  expect(plain.within).toBeUndefined();
});

test("ElementHandle is satisfiable", async () => {
  const handle: ElementHandle = {
    locator: { logicalName: "x", candidates: [], within: (p) => p },
    exists: async () => true,
    isVisible: async () => true,
    isEnabled: async () => false,
    text: async () => "hi",
    attribute: async () => null,
  };
  expect(await handle.exists()).toBe(true);
  expect(await handle.attribute("id")).toBeNull();
});

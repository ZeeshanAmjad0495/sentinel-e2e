// packages/contracts/tests/action.test.ts
import { test, expect } from "@playwright/test";
import type { GestureTarget, Action, Locator } from "@sentinele2e/contracts";

const loc: Locator = { logicalName: "x", candidates: [], within: (p) => p };

test("GestureTarget has element / point / percent variants", () => {
  const targets: GestureTarget[] = [
    { kind: "element", locator: loc },
    { kind: "point", x: 10, y: 20 },
    { kind: "percent", xPct: 0.5, yPct: 0.5 },
  ];
  const el = targets[0];
  expect(el?.kind).toBe("element");
  if (el?.kind === "element") expect(el.locator.logicalName).toBe("x");
});

test("Action is satisfiable with universal verbs only (gestures optional)", async () => {
  const calls: string[] = [];
  const action: Action = {
    tap: async () => void calls.push("tap"),
    typeText: async () => void calls.push("typeText"),
    clear: async () => void calls.push("clear"),
    read: async () => "value",
  };
  await action.tap(loc);
  await action.typeText(loc, "hi");
  expect(await action.read(loc)).toBe("value");
  expect(action.swipe).toBeUndefined();
  expect(calls).toEqual(["tap", "typeText"]);
});

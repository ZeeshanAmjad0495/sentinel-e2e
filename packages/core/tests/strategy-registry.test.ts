// packages/core/tests/strategy-registry.test.ts
import { test, expect } from "@playwright/test";
import { StrategyRegistry } from "@sentinele2e/core";

test("default ranks follow the §7 durability table", () => {
  const reg = new StrategyRegistry();
  expect(reg.rankOf("role")).toBe(0);
  expect(reg.rankOf("label")).toBe(1);
  expect(reg.rankOf("text")).toBe(2);
  expect(reg.rankOf("placeholder")).toBe(3);
  expect(reg.rankOf("altText")).toBe(3);
  expect(reg.rankOf("title")).toBe(3);
  expect(reg.rankOf("testid")).toBe(4);
  expect(reg.rankOf("relative")).toBe(5);
  expect(reg.rankOf("css")).toBe(6);
  expect(reg.rankOf("xpath")).toBe(6);
});

test("unknown open kinds default to the migration bottom rung (6)", () => {
  const reg = new StrategyRegistry();
  expect(reg.rankOf("-ios predicate string")).toBe(6);
  expect(reg.rankOf("accessibility id")).toBe(6);
});

test("register overrides an existing rank and adds new kinds", () => {
  const reg = new StrategyRegistry();
  reg.register("accessibility id", { rank: 1 });
  expect(reg.rankOf("accessibility id")).toBe(1);
  reg.register("css", { rank: 9 });
  expect(reg.rankOf("css")).toBe(9);
});

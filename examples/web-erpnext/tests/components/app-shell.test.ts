// examples/web-erpnext/tests/components/app-shell.test.ts
import { test, expect } from "@playwright/test";
import { AppShell } from "../../src/components/auth/app-shell";
import { appShellLocators } from "../../src/domain/auth/locators";
import type { Locator, ElementState } from "@sentinele2e/contracts";

type WaitForCall = { target: Locator; state: ElementState; timeoutMs?: number };

function fakeSession(behavior: (call: WaitForCall) => Promise<void>) {
  const calls: WaitForCall[] = [];
  const assert = {
    async waitFor(
      target: Locator,
      state: ElementState,
      opts?: { timeoutMs?: number },
    ) {
      const call = { target, state, timeoutMs: opts?.timeoutMs };
      calls.push(call);
      await behavior(call);
    },
    async waitForFirstOf() {
      throw new Error("not used");
    },
  };
  return { session: { assert } as never, calls };
}

test("waitForReady delegates to assert.waitFor(ready, visible) (D1: no captured URL)", async () => {
  const { session, calls } = fakeSession(async () => {});
  await new AppShell(session).waitForReady(500);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.target).toBe(appShellLocators.ready);
  expect(calls[0]?.state).toBe("visible");
  expect(calls[0]?.timeoutMs).toBe(500);
});

test("waitForReady propagates a timeout throw (D2: does not resolve on timeout)", async () => {
  const { session } = fakeSession(async () => {
    throw new Error("TimeoutError");
  });
  await expect(new AppShell(session).waitForReady(10)).rejects.toThrow(
    "TimeoutError",
  );
});

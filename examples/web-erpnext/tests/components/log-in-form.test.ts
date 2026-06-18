// examples/web-erpnext/tests/components/log-in-form.test.ts
import { test, expect } from "@playwright/test";
import { LogInForm } from "../../src/components/auth/log-in-form";
import { loginLocators } from "../../src/domain/auth/locators";
import type { Locator } from "@sentinele2e/contracts";

function fakeSession() {
  const typed: Array<{ target: Locator; text: string }> = [];
  const tapped: Locator[] = [];
  const action = {
    async typeText(target: Locator, text: string) {
      typed.push({ target, text });
    },
    async tap(target: Locator) {
      tapped.push(target);
    },
    async clear() {},
    async read(_target: Locator) {
      return "Invalid Login. Try again.";
    },
  };
  return { session: { action } as never, typed, tapped };
}

test("fill types username then password via action.typeText", async () => {
  const { session, typed } = fakeSession();
  await new LogInForm(session).fill({ username: "admin", password: "secret" });
  expect(typed).toHaveLength(2);
  expect(typed[0]?.target).toBe(loginLocators.username);
  expect(typed[0]?.text).toBe("admin");
  expect(typed[1]?.target).toBe(loginLocators.password);
  expect(typed[1]?.text).toBe("secret");
});

test("submit taps the submit locator", async () => {
  const { session, tapped } = fakeSession();
  await new LogInForm(session).submit();
  expect(tapped).toEqual([loginLocators.submit]);
});

test("readMessage reads the invalid message via action.read", async () => {
  const { session } = fakeSession();
  const msg = await new LogInForm(session).readMessage();
  expect(msg).toBe("Invalid Login. Try again.");
});

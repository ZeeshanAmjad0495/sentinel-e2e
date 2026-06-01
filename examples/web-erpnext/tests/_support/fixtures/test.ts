// tests/_support/fixtures/test.ts
import { test as base, expect } from "@playwright/test";
import type { Credentials } from "../../../src/domain/auth";
import { authFixtures } from "./auth";

type Fixtures = Readonly<{
  adminCredentials: Credentials;
  loginAsAdmin: () => Promise<void>;
}>;

export const test = base.extend<Fixtures>({
  adminCredentials: async ({}, use) => {
    await use(authFixtures.adminCredentials);
  },

  loginAsAdmin: async ({ page }, use) => {
    await use(async () => {
      await authFixtures.loginAsAdmin(page);
    });
  },
});

export { expect };

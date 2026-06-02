// tests/_support/fixtures/auth.ts
import type { Page } from "@playwright/test";
import type { Credentials } from "../../../src/domain/auth";
import { env } from "../../../src/config/env";
import { logIn } from "../../../src/flows";

export type AuthFixtures = Readonly<{
  adminCredentials: Credentials;
  loginAsAdmin: (page: Page) => Promise<void>;
}>;

export const authFixtures: Readonly<{
  adminCredentials: AuthFixtures["adminCredentials"];
  loginAsAdmin: AuthFixtures["loginAsAdmin"];
}> = {
  adminCredentials: {
    username: env.adminUser,
    password: env.adminPassword,
  },
  async loginAsAdmin(page: Page): Promise<void> {
    await page.goto("/login");

    const result = await logIn(page, {
      username: env.adminUser,
      password: env.adminPassword,
    });

    if (result.status !== "success") {
      throw new Error(`Admin login failed: ${result.message ?? result.reason}`);
    }
  },
};

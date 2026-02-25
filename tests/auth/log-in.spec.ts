import { test, expect } from "../_support/fixtures/test";
import { logIn } from "../../src/flows";

test.describe("auth: logIn", () => {
  test("invalid credentials returns structured failure", async ({
    page,
    adminCredentials,
  }) => {
    await page.goto("/login");

    const result = await logIn(page, {
      username: `${adminCredentials.username}.invalid`,
      password: `${adminCredentials.password}.invalid`,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBeTruthy();
  });

  test("loginAsAdmin fixture logs in successfully", async ({
    page,
    loginAsAdmin,
  }) => {
    await loginAsAdmin();
    expect(page.url()).not.toContain("/login");
  });
});

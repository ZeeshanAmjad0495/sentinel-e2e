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

    expect(result.status).toBe("business-failure");
    if (result.status === "business-failure") {
      expect(result.reason).toBe("INVALID_CREDENTIALS");
      expect(result.message).toBeTruthy(); // localized text still surfaced for humans
    }
  });

  test("loginAsAdmin fixture logs in successfully", async ({
    page,
    loginAsAdmin,
  }) => {
    await loginAsAdmin();
    expect(page.url()).not.toContain("/login");
  });
});

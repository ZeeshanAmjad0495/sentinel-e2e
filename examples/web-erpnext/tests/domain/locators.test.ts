// examples/web-erpnext/tests/domain/locators.test.ts
import { test, expect } from "@playwright/test";
import {
  loginLocators,
  appShellLocators,
} from "../../src/domain/auth/locators";

test("login locators expose stable logical names", () => {
  expect(loginLocators.username.logicalName).toBe("auth.login.username");
  expect(loginLocators.password.logicalName).toBe("auth.login.password");
  expect(loginLocators.submit.logicalName).toBe("auth.login.submit");
  expect(loginLocators.invalid.logicalName).toBe("auth.login.invalidState");
});

test("css fallbacks stay byte-identical to migrated selectors", () => {
  const usernameCss = loginLocators.username.candidates.find(
    (c) => c.kind === "css",
  );
  const passwordCss = loginLocators.password.candidates.find(
    (c) => c.kind === "css",
  );
  expect(usernameCss?.value).toBe("input#login_email[autocomplete='username']");
  expect(passwordCss?.value).toBe(
    "input#login_password[autocomplete='current-password']",
  );
});

test("invalid locator leads with structural .invalid candidate, invalid-message text second (D-3)", () => {
  const [first, second] = loginLocators.invalid.candidates;
  expect(first?.kind).toBe("css");
  expect(first?.value).toBe(
    ".page-card-body.invalid .btn-login[type='submit']",
  );
  // Candidate 2 must signal the invalid STATE, not the always-present bare submit
  // button (the bare-button match made INVALID win a successful login's race).
  expect(second?.kind).toBe("text");
  expect(second?.value).toBe("Invalid Login. Try again.");
});

test("appShell.ready is the driver-neutral success signal", () => {
  expect(appShellLocators.ready.logicalName).toBe("auth.appShell.ready");
  const css = appShellLocators.ready.candidates.find((c) => c.kind === "css");
  expect(css?.value).toBe("div.desktop-wrapper");
});

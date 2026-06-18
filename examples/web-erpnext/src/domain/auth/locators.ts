// examples/web-erpnext/src/domain/auth/locators.ts
import type { Locator } from "@sentinele2e/contracts";

export const loginLocators = {
  username: {
    logicalName: "auth.login.username",
    candidates: [
      { kind: "label", value: "Email" },
      { kind: "css", value: "input#login_email[autocomplete='username']" }, // migrated rank-6 fallback
    ],
  },
  password: {
    logicalName: "auth.login.password",
    candidates: [
      { kind: "label", value: "Password" },
      {
        kind: "css",
        value: "input#login_password[autocomplete='current-password']",
      },
    ],
  },
  submit: {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Login" } },
      { kind: "css", value: "button.btn-login[type='submit']" },
    ],
  },
  // INVALID detection (D-3): structural .invalid candidate FIRST, invalid-message TEXT fallback SECOND.
  invalid: {
    logicalName: "auth.login.invalidState",
    candidates: [
      // structural (enum INVALID_STATE)
      {
        kind: "css",
        value: ".page-card-body.invalid .btn-login[type='submit']",
      },
      // Candidate 2 MUST match the invalid STATE, not the always-present submit button.
      // A text match on the invalid message only resolves when the app actually surfaces
      // the failure, so it never fires on a successful login.
      { kind: "text", value: "Invalid Login. Try again." },
    ],
  },
} satisfies Record<string, Locator>;

export const appShellLocators = {
  // DRIVER-NEUTRAL success signal — an app-shell Locator, NOT a URL. URL is reinforcement only.
  ready: {
    logicalName: "auth.appShell.ready",
    candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
  },
} satisfies Record<string, Locator>;

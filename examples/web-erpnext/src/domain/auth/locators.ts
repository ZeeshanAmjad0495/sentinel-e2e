// examples/web-erpnext/src/domain/auth/locators.ts
import type { Locator, LocatorStrategy } from "@sentinel/contracts";

/**
 * Attach the standard `within` scoping/chaining to a plain locator literal so the
 * authored data (logicalName + ordered candidates) satisfies the `Locator` contract
 * without repeating the boilerplate per entry. Scoping prefixes the parent's logical
 * name (the drift anchor), matching the contract's canonical chaining shape.
 */
function defineLocator(
  logicalName: string,
  candidates: readonly LocatorStrategy[],
): Locator {
  return {
    logicalName,
    candidates,
    within(parent: Locator): Locator {
      return defineLocator(`${parent.logicalName}>${logicalName}`, candidates);
    },
  };
}

export const loginLocators = {
  username: defineLocator("auth.login.username", [
    { kind: "label", value: "Email" },
    { kind: "css", value: "input#login_email[autocomplete='username']" }, // migrated rank-6 fallback
  ]),
  password: defineLocator("auth.login.password", [
    { kind: "label", value: "Password" },
    {
      kind: "css",
      value: "input#login_password[autocomplete='current-password']",
    },
  ]),
  submit: defineLocator("auth.login.submit", [
    { kind: "role", value: "button", options: { name: "Login" } },
    { kind: "css", value: "button.btn-login[type='submit']" },
  ]),
  // INVALID detection (D-3): structural .invalid candidate FIRST, button-text source SECOND.
  invalid: defineLocator("auth.login.invalidState", [
    { kind: "css", value: ".page-card-body.invalid .btn-login[type='submit']" }, // structural (enum INVALID_STATE)
    { kind: "css", value: "button.btn-login[type='submit']" }, // today's text source, retained
  ]),
} satisfies Record<string, Locator>;

export const appShellLocators = {
  // DRIVER-NEUTRAL success signal — an app-shell Locator, NOT a URL. URL is reinforcement only.
  ready: defineLocator("auth.appShell.ready", [
    { kind: "css", value: "div.desktop-wrapper" }, // AppShellSelectors.ROOT
  ]),
} satisfies Record<string, Locator>;

// examples/web-erpnext/tests/_support/login-dom.test.ts
import { test, expect } from "@playwright/test";
import { LOGIN_DOM, INVALID_DOM } from "./login-dom";

test("login DOM exposes the css-fallback + success-shell selectors", () => {
  // The S4 css fallbacks key on these ids/classes; assert the load-bearing elements exist.
  expect(LOGIN_DOM).toContain('id="login_email"');
  expect(LOGIN_DOM).toContain('id="login_password"');
  expect(LOGIN_DOM).toContain('class="btn-login"');
  expect(LOGIN_DOM).toContain('class="desktop-wrapper"');
});

test("invalid DOM exposes the structural .page-card-body.invalid signal", () => {
  expect(INVALID_DOM).toContain("page-card-body invalid");
  expect(INVALID_DOM).toContain("Invalid Login. Try again.");
});

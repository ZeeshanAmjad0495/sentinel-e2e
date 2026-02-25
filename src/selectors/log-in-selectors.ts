const enum LoginSelectors {
  ROOT = "section.for-login",

  USERNAME_INPUT = "input#login_email[autocomplete='username']",
  PASSWORD_INPUT = "input#login_password[autocomplete='current-password']",

  LOGIN_BUTTON = "button.btn-login[type='submit']",

  // Failure state: form is marked invalid (stable, language-independent).
  INVALID_STATE = ".page-card-body.invalid",

  // Optional: presence of login-with-email-link block confirms we're still on login UI.
  LOGIN_WITH_EMAIL_LINK = "a.btn-login-with-email-link",

  // Optional: to read the failure text, reuse LOGIN_BUTTON textContent.
  // (No separate selector needed; included here for clarity of intent.)
  ERROR_TEXT_SOURCE = "button.btn-login[type='submit']",
}

export default LoginSelectors;

// packages/contracts/tests/conformance/fixtures.ts
//
// Shared, driver-agnostic HTML fixtures for the cross-driver conformance suite
// (spec §6). Each constant is a plain HTML string consumed IDENTICALLY by both
// harnesses as `data:text/html,` + encodeURIComponent(html) — verified working
// under Playwright `page.goto` and Selenium `driver.get`.
//
// Determinism (flake must-fix, §6): every element these fixtures advertise is
// present AT LOAD (zero polling). Timing-sensitive conformance cases use a
// never-appearing locator against a wide timeout instead of racing the DOM.
//
// `<label for>` associations are real so the `label` strategy compiles AND
// resolves on Selenium (it has no auto-`role`; the css fallback also exists).

/** The data: URL a harness navigates to. Encoded identically for both drivers. */
export function toDataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

/**
 * A login-like form, fully present at load:
 *  - a `div.desktop-wrapper` shell (the app-ready locator)
 *  - `<label for>` -> input associations (so `label` is a real, supported match)
 *  - a submit button reachable by role (Playwright) AND css (both)
 *  - a seeded text input for typeText/read/clear round-trips
 *  - a button with a DOM side effect for tap
 *  - a disabled control that resolves but never becomes actionable (clamp test)
 */
export const LOGIN_DOM = `
  <div class="desktop-wrapper">
    <form class="page-card-body">
      <label for="login_email">Email</label>
      <input id="login_email" autocomplete="username" value="seed-user" />

      <label for="login_password">Password</label>
      <input id="login_password" type="password" autocomplete="current-password" />

      <button class="btn-login" type="submit"
              onclick="document.getElementById('after-submit').textContent='submitted';return false;">Login</button>

      <button id="disabled-btn" type="button" disabled>Disabled</button>
      <div id="after-submit"></div>
    </form>
  </div>
`;

/**
 * The invalid-credentials variant: same shell, but the card carries `.invalid`
 * and shows the stable failure text. Used by the drift-fix + state groups.
 */
export const INVALID_DOM = `
  <div class="desktop-wrapper">
    <form class="page-card-body invalid">
      <label for="login_email">Email</label>
      <input id="login_email" autocomplete="username" value="seed-user" />

      <button class="btn-login" type="submit">Login</button>
      <span class="error-banner">Invalid Login. Try again.</span>
    </form>
  </div>
`;

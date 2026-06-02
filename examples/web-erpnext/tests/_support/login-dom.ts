// examples/web-erpnext/tests/_support/login-dom.ts

/** Minimal login page whose submit reveals the success shell (div.desktop-wrapper). */
export const LOGIN_DOM = `<!doctype html><html><body>
  <div class="page-card-body">
    <form>
      <input id="login_email" type="text" autocomplete="username" />
      <input id="login_password" type="password" autocomplete="current-password" />
      <button class="btn-login" type="submit">Login</button>
    </form>
  </div>
  <div class="desktop-wrapper" style="display:none">app shell</div>
  <script>
    document.querySelector('button.btn-login').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelector('div.desktop-wrapper').style.display = 'block';
    });
  </script>
</body></html>`;

/**
 * Minimal login page whose submit simulates Frappe's post-login navigation: on
 * click the handler REPLACES the whole page body with the app shell
 * (`div.desktop-wrapper`), removing the login form/button entirely.
 *
 * The swap is deferred by one short tick to model the real AJAX/redirect window:
 * during that window the login form/button is still on screen. This is exactly the
 * window in which the original (buggy) INVALID locator — whose 2nd candidate was the
 * BARE submit button — would resolve "visible" and make INVALID win the race for a
 * VALID login. With the fixed locator neither INVALID candidate can match here
 * (the card never gets `.invalid`, and the button text is a normal "Login" label,
 * never the invalid message), so SUCCESS deterministically wins once the shell shows.
 */
export const SUCCESS_DOM = `<!doctype html><html><body>
  <div class="page-card-body">
    <form>
      <input id="login_email" type="text" autocomplete="username" />
      <input id="login_password" type="password" autocomplete="current-password" />
      <button class="btn-login" type="submit">Login</button>
    </form>
  </div>
  <script>
    document.querySelector('button.btn-login').addEventListener('click', function (e) {
      e.preventDefault();
      // Post-login redirect window: form/button stays visible briefly, THEN the
      // app shell replaces the page body (mirrors Frappe's post-login navigation).
      setTimeout(function () {
        document.body.innerHTML = '<div class="desktop-wrapper">Home</div>';
      }, 50);
    });
  </script>
</body></html>`;

/**
 * Minimal login page already in the structural invalid state: the card carries
 * `.page-card-body.invalid` (the D-3 structural signal the resolver keys on) and the
 * localized message text `read()` surfaces. Submitting reinforces the message visibility.
 */
export const INVALID_DOM = `<!doctype html><html><body>
  <div class="page-card-body invalid">
    <form>
      <input id="login_email" type="text" autocomplete="username" />
      <input id="login_password" type="password" autocomplete="current-password" />
      <button class="btn-login" type="submit">Invalid Login. Try again.</button>
      <div class="login-message" style="display:none">Invalid Login. Try again.</div>
    </form>
  </div>
  <script>
    document.querySelector('button.btn-login').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelector('div.page-card-body').classList.add('invalid');
      var m = document.querySelector('.login-message');
      m.style.display = 'block';
    });
  </script>
</body></html>`;

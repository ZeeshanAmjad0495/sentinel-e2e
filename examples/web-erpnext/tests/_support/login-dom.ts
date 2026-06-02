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

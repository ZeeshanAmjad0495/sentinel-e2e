import type { Page, Locator } from "@playwright/test";
import { LoginSelectors } from "src/selectors";
import type { Credentials } from "src/domain/auth";

const INVALID_LOGIN_MESSAGE = "Invalid Login. Try again.";

class LogInForm {
  private readonly root: Locator;
  private readonly usernameInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly invalidState: Locator;

  constructor(private readonly page: Page) {
    this.root = this.page.locator(LoginSelectors.ROOT);
    this.usernameInput = this.page.locator(LoginSelectors.USERNAME_INPUT);
    this.passwordInput = this.page.locator(LoginSelectors.PASSWORD_INPUT);
    this.submitButton = this.page.locator(LoginSelectors.LOGIN_BUTTON);
    this.invalidState = this.submitButton;
  }

  async isVisible(): Promise<boolean> {
    return (
      (await this.root.isVisible()) && (await this.usernameInput.isVisible())
    );
  }

  async fillUsername(username: string): Promise<void> {
    await this.usernameInput.fill(username);
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async fill(credentials: Credentials): Promise<void> {
    await this.fillUsername(credentials.username);
    await this.fillPassword(credentials.password);
  }

  async clear(): Promise<void> {
    await this.usernameInput.fill("");
    await this.passwordInput.fill("");
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async waitForInvalid(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? 10_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const text = (await this.submitButton.textContent())?.trim();
      if (text === INVALID_LOGIN_MESSAGE) {
        return;
      }
      await this.page.waitForTimeout(100);
    }

    throw new Error("Invalid login message did not appear within timeout");
  }

  async isInvalid(): Promise<boolean> {
    return this.invalidState.isVisible();
  }

  async getErrorMessage(): Promise<string | undefined> {
    const invalid = await this.isInvalid();
    if (!invalid) return undefined;
    const text = await this.submitButton.textContent();
    const msg = text?.trim();
    return msg && msg.length > 0 ? msg : undefined;
  }
}

export default LogInForm;

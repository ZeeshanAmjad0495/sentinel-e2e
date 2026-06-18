// examples/web-erpnext/src/components/auth/log-in-form.ts
import type { Session } from "@sentinele2e/contracts";
import type { Credentials } from "../../domain/auth";
import { loginLocators } from "../../domain/auth/locators";

/**
 * Login form on the Session contract (spec §8).
 * D4 fixed: the manual `while`+`waitForTimeout` poll is gone; the INVALID wait is owned by
 * the flow's driver `waitForFirstOf`. D5 fixed: invalidity is no longer keyed off an English
 * string — the structural `invalid` locator drives detection; `readMessage` only surfaces
 * display text for humans, never the verdict.
 */
export class LogInForm {
  constructor(private readonly session: Session) {}

  async fill(credentials: Credentials): Promise<void> {
    await this.session.action.typeText(
      loginLocators.username,
      credentials.username,
    );
    await this.session.action.typeText(
      loginLocators.password,
      credentials.password,
    );
  }

  async submit(): Promise<void> {
    await this.session.action.tap(loginLocators.submit);
  }

  /** Display-only message read from the invalid-state element; never keyed on for the reason. */
  async readMessage(): Promise<string> {
    return this.session.action.read(loginLocators.invalid);
  }
}

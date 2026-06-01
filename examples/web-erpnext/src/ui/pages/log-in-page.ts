import type { Page } from "@playwright/test";
import type { Credentials, LoginResult } from "../../domain/auth";
import { LogInForm } from "../components/log-in-form";
import { AppShell } from "../components/app-shell";

class LogInPage {
  private readonly form: LogInForm;
  private readonly appShell: AppShell;

  constructor(private readonly page: Page) {
    this.form = new LogInForm(this.page);
    this.appShell = new AppShell(this.page);
  }

  async isVisible(): Promise<boolean> {
    return this.form.isVisible();
  }

  async login(
    credentials: Credentials,
    options?: { timeoutMs?: number },
  ): Promise<LoginResult> {
    const startedAt = Date.now();

    await this.form.fill(credentials);
    await this.form.submit();

    const timeoutMs = options?.timeoutMs ?? 10_000;

    try {
      const outcome = await Promise.race([
        this.form.waitForInvalid(timeoutMs).then(() => "INVALID" as const),
        this.appShell.waitForReady(timeoutMs).then(() => "SUCCESS" as const),
      ]);

      const durationMs = Date.now() - startedAt;
      const finalUrl = this.page.url();
      const timestamp = Date.now();

      if (outcome === "INVALID") {
        const errorMessage = await this.form.getErrorMessage();
        return {
          success: false,
          username: credentials.username,
          errorMessage,
          durationMs,
          finalUrl,
          timestamp,
        };
      }

      return {
        success: true,
        username: credentials.username,
        durationMs,
        finalUrl,
        timestamp,
      };
    } catch (err) {
      // System-level failure (timeout, selector drift, broken UI)
      // Business failures should not reach here because INVALID_STATE is our primary failure signal.
      throw err;
    }
  }

  private async waitForSuccessSignal(timeoutMs: number): Promise<void> {
    // TODO: replace with a real dashboard anchor selector once you confirm it.
    // For now, this is intentionally a hard fail so you don't get false positives.
    // You should implement AppShell component later and call appShell.waitForReady().
    await this.page.waitForFunction(
      () => window.location.pathname !== "/login",
      undefined,
      { timeout: timeoutMs },
    );
  }
}

export default LogInPage;

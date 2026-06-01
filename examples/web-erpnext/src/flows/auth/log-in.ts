import type { Page } from "@playwright/test";
import type { Credentials, LoginResult } from "src/domain/auth";
import { LogInPage } from "src/ui";

async function logIn(
  page: Page,
  credentials: Credentials,
  options?: { timeoutMs?: number },
): Promise<LoginResult> {
  const logInPage = new LogInPage(page);
  return logInPage.login(credentials, options);
}

export default logIn;

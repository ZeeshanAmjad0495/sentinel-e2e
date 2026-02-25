import type { Locator, Page } from "@playwright/test";
import { AppShellSelectors } from "src/selectors";

class AppShell {
  private readonly root: Locator;
  private readonly avatarDivision: Locator;
  private readonly userMenu: Locator;

  constructor(private readonly page: Page) {
    this.root = this.page.locator(AppShellSelectors.ROOT);
    this.avatarDivision = this.page.locator(AppShellSelectors.AVATAR_DIVISION);
    this.userMenu = this.page.locator(AppShellSelectors.USER_MENU);
  }

  async isVisible(): Promise<boolean> {
    return (
      (await this.root.isVisible()) &&
      (await this.userMenu.isVisible()) &&
      (await this.avatarDivision.isVisible())
    );
  }

  async waitForReady(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? 10_000;
    const start = Date.now();
    const pageUrl = this.page.url();

    while (Date.now() - start < timeout) {
      if ((await this.isVisible()) && !pageUrl.includes("login")) {
        return;
      }
      await this.page.waitForTimeout(100);
    }
  }
}

export default AppShell;

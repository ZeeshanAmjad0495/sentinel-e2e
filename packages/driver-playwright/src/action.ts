// packages/driver-playwright/src/action.ts
import type { Locator as PwLocator } from "@playwright/test";
import type { Action, Locator } from "@sentinel/contracts";
import type { LocatorResolver } from "@sentinel/core";
import type { PlaywrightElementHandle } from "./element";

export class PlaywrightAction implements Action {
  constructor(private readonly resolver: LocatorResolver) {}

  private async pwLocator(target: Locator): Promise<PwLocator> {
    const resolution = await this.resolver.resolve(target);
    const handle = resolution.handle as PlaywrightElementHandle;
    return handle.compileWinner();
  }

  async tap(target: Locator): Promise<void> {
    await (await this.pwLocator(target)).click();
  }

  async typeText(target: Locator, text: string): Promise<void> {
    await (await this.pwLocator(target)).fill(text);
  }

  async clear(target: Locator): Promise<void> {
    await (await this.pwLocator(target)).fill("");
  }

  async read(target: Locator): Promise<string> {
    const locator = await this.pwLocator(target);
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return locator.inputValue();
    }
    return (await locator.textContent()) ?? "";
  }
}

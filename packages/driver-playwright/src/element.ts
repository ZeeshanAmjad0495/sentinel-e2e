// packages/driver-playwright/src/element.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type {
  ElementHandle,
  Locator,
  LocatorStrategy,
} from "@sentinel/contracts";
import { compileStrategy } from "./strategy-compiler";

/** Re-resolves the winning candidate per call — no cached live handle (spec §3.3). */
export class PlaywrightElementHandle implements ElementHandle {
  constructor(
    private readonly page: Page,
    readonly locator: Locator,
    private readonly winner: LocatorStrategy,
  ) {}

  private compile(): PwLocator {
    return compileStrategy(this.page, this.winner);
  }

  async exists(): Promise<boolean> {
    return (await this.compile().count()) > 0;
  }

  async isVisible(): Promise<boolean> {
    return this.compile().isVisible();
  }

  async isEnabled(): Promise<boolean> {
    return this.compile().isEnabled();
  }

  async text(): Promise<string> {
    return (await this.compile().textContent()) ?? "";
  }

  async attribute(name: string): Promise<string | null> {
    return this.compile().getAttribute(name);
  }
}

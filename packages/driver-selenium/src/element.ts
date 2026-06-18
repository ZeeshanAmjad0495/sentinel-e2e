// packages/driver-selenium/src/element.ts
import type { By, WebDriver } from "selenium-webdriver";
import type {
  ElementHandle,
  Locator,
  LocatorStrategy,
} from "@sentinele2e/contracts";
import { compileStrategy, toBy } from "./strategy-compiler";

/** Re-resolves the winning candidate per call — dodges stale-element references. */
export class SeleniumElementHandle implements ElementHandle {
  constructor(
    private readonly driver: WebDriver,
    readonly locator: Locator,
    private readonly winner: LocatorStrategy,
  ) {}

  private by(): By {
    return toBy(compileStrategy(this.winner));
  }

  /** The winning candidate compiled into a fresh Selenium `By` (re-resolved per use). */
  winnerBy(): By {
    return this.by();
  }

  async exists(): Promise<boolean> {
    return (await this.driver.findElements(this.by())).length > 0;
  }

  async isVisible(): Promise<boolean> {
    const els = await this.driver.findElements(this.by());
    if (els.length === 0) return false;
    return els[0]!.isDisplayed();
  }

  async isEnabled(): Promise<boolean> {
    const els = await this.driver.findElements(this.by());
    if (els.length === 0) return false;
    return els[0]!.isEnabled();
  }

  async text(): Promise<string> {
    const els = await this.driver.findElements(this.by());
    if (els.length === 0) return "";
    return els[0]!.getText();
  }

  async attribute(name: string): Promise<string | null> {
    const els = await this.driver.findElements(this.by());
    if (els.length === 0) return null;
    return els[0]!.getAttribute(name);
  }
}

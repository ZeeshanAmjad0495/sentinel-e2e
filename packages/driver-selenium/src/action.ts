// packages/driver-selenium/src/action.ts
import type { By, WebDriver, WebElement } from "selenium-webdriver";
import type { Action, ActionOptions, Locator } from "@sentinele2e/contracts";
import type { LocatorResolver } from "@sentinele2e/core";
import type { SeleniumElementHandle } from "./element";
import { waitActionable } from "./actionability";

interface ActionContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

export class SeleniumAction implements Action {
  constructor(
    private readonly driver: WebDriver,
    private readonly resolver: LocatorResolver,
    private readonly ctx: ActionContext,
    private readonly defaultTimeoutMs: number,
  ) {}

  /** Effective timeout: a caller may only TIGHTEN, never exceed, the session bound (D2). */
  private clamp(opts?: ActionOptions): number {
    return Math.min(
      opts?.timeoutMs ?? this.defaultTimeoutMs,
      this.defaultTimeoutMs,
    );
  }

  /** Resolve (emits locator.resolved) then poll to actionable, returning the element + By. */
  private async target(
    target: Locator,
    requireEnabled: boolean,
    opts?: ActionOptions,
  ): Promise<{ el: WebElement; by: By }> {
    const resolution = await this.resolver.resolve(target);
    const by = (resolution.handle as SeleniumElementHandle).winnerBy();
    const deadline = Date.now() + this.clamp(opts);
    const el = await waitActionable(
      this.driver,
      by,
      { requireEnabled, deadline },
      this.ctx,
    );
    return { el, by };
  }

  async tap(target: Locator, opts?: ActionOptions): Promise<void> {
    const { el } = await this.target(target, true, opts);
    await el.click();
  }

  async typeText(
    target: Locator,
    text: string,
    opts?: ActionOptions,
  ): Promise<void> {
    const { el } = await this.target(target, true, opts);
    await el.sendKeys(text);
  }

  async clear(target: Locator, opts?: ActionOptions): Promise<void> {
    const { el } = await this.target(target, true, opts);
    await el.clear();
  }

  async read(target: Locator, opts?: ActionOptions): Promise<string> {
    // read = attached-only (D2): no displayed/enabled gate.
    const { el } = await this.target(target, false, opts);
    const tag = (await el.getTagName()).toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return (await el.getAttribute("value")) ?? "";
    }
    return el.getText();
  }
}

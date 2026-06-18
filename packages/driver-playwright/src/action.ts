// packages/driver-playwright/src/action.ts
import type { Locator as PwLocator } from "@playwright/test";
import type { Action, ActionOptions, Locator } from "@sentinel/contracts";
import type { LocatorResolver } from "@sentinel/core";
import type { PlaywrightElementHandle } from "./element";

export class PlaywrightAction implements Action {
  constructor(
    private readonly resolver: LocatorResolver,
    private readonly defaultTimeoutMs: number,
  ) {}

  /** Effective timeout: a caller may only TIGHTEN, never exceed, the session bound (D2). */
  private clamp(opts?: ActionOptions): number {
    return Math.min(
      opts?.timeoutMs ?? this.defaultTimeoutMs,
      this.defaultTimeoutMs,
    );
  }

  private async pwLocator(target: Locator): Promise<PwLocator> {
    const resolution = await this.resolver.resolve(target);
    const handle = resolution.handle as PlaywrightElementHandle;
    return handle.compileWinner();
  }

  async tap(target: Locator, opts?: ActionOptions): Promise<void> {
    await (await this.pwLocator(target)).click({ timeout: this.clamp(opts) });
  }

  async typeText(
    target: Locator,
    text: string,
    opts?: ActionOptions,
  ): Promise<void> {
    await (
      await this.pwLocator(target)
    ).fill(text, { timeout: this.clamp(opts) });
  }

  async clear(target: Locator, opts?: ActionOptions): Promise<void> {
    await (
      await this.pwLocator(target)
    ).fill("", { timeout: this.clamp(opts) });
  }

  async read(target: Locator, _opts?: ActionOptions): Promise<string> {
    // read = attached-only (D2): inputValue/textContent, no visible/enabled gate.
    const locator = await this.pwLocator(target);
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return locator.inputValue();
    }
    return (await locator.textContent()) ?? "";
  }
}

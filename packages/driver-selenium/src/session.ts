// packages/driver-selenium/src/session.ts
import type { WebDriver } from "selenium-webdriver";
import type {
  Action,
  Assertion,
  Capability,
  ElementHandle,
  Locator,
  Session,
  StrategyKind,
} from "@sentinel/contracts";
import {
  CapabilityUnsupportedError,
  SpanContext,
  StampingSink,
} from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { SeleniumResolver } from "./resolver";
import { SeleniumAction } from "./action";
import { SeleniumAssertion } from "./assertion";
import { SeleniumElementHandle } from "./element";

export interface SeleniumSessionOptions {
  readonly defaultTimeoutMs: number;
  readonly strategies: ReadonlySet<StrategyKind>;
  readonly capabilities: ReadonlySet<Capability>;
  readonly flowName?: string;
  /** Adopt this as Session.id (from SessionConfig.sessionId). Default: a fresh uuid. */
  readonly id?: string;
}

export class SeleniumSession implements Session {
  readonly id: string;
  readonly driver = "selenium";
  readonly capabilities: ReadonlySet<Capability>;
  readonly telemetry: TelemetrySink;
  readonly action: Action;
  readonly assert: Assertion;

  private readonly wd: WebDriver;
  private readonly resolver: SeleniumResolver;

  constructor(
    wd: WebDriver,
    telemetry: TelemetrySink,
    opts: SeleniumSessionOptions,
  ) {
    this.wd = wd;
    this.id = opts.id ?? globalThis.crypto.randomUUID();
    // Single per-run SpanContext keyed on the session id: traceId == correlationId ==
    // Session.id (spec §5.6). Identical wiring to PlaywrightSession.
    this.telemetry = new StampingSink(new SpanContext(this.id), telemetry);
    this.capabilities = opts.capabilities;

    const ctx = {
      correlationId: this.id,
      flowName: opts.flowName ?? "session",
      startedAt: Date.now(),
    };

    this.resolver = new SeleniumResolver(
      wd,
      opts.strategies,
      this.telemetry,
      ctx,
    );
    this.action = new SeleniumAction(
      wd,
      this.resolver,
      ctx,
      opts.defaultTimeoutMs,
    );
    this.assert = new SeleniumAssertion(
      wd,
      this.resolver,
      this.telemetry,
      ctx,
      opts.defaultTimeoutMs,
    );
  }

  supports(cap: Capability): boolean {
    return this.capabilities.has(cap);
  }

  require(cap: Capability): void {
    if (!this.capabilities.has(cap)) {
      throw new CapabilityUnsupportedError(
        `Driver "selenium" does not support capability "${cap}"`,
        {
          correlationId: this.id,
          flowName: "session",
          startedAt: Date.now(),
          durationMs: 0,
          capability: cap,
        },
      );
    }
  }

  locate(locator: Locator): ElementHandle {
    const primary = locator.candidates[0];
    if (primary === undefined) {
      throw new Error(`Locator "${locator.logicalName}" has no candidates`);
    }
    return new SeleniumElementHandle(this.wd, locator, primary);
  }

  async navigate(url: string): Promise<void> {
    this.require("navigation");
    await this.wd.get(url);
  }

  async currentUrl(): Promise<string> {
    this.require("navigation");
    return this.wd.getCurrentUrl();
  }

  async back(): Promise<void> {
    this.require("navigation");
    await this.wd.navigate().back();
  }

  async screenshot(): Promise<Buffer> {
    this.require("screenshot");
    const b64 = await this.wd.takeScreenshot();
    return Buffer.from(b64, "base64");
  }

  async end(): Promise<void> {
    // WebDriver lifecycle is owned by the test (it calls driver.quit()).
  }
}

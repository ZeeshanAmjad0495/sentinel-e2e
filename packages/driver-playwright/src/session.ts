// packages/driver-playwright/src/session.ts
import type { Page } from "@playwright/test";
import type {
  Action,
  Assertion,
  Capability,
  ElementHandle,
  Locator,
  Session,
  StrategyKind,
} from "@sentinele2e/contracts";
import {
  CapabilityUnsupportedError,
  SpanContext,
  StampingSink,
} from "@sentinele2e/core";
import type { TelemetrySink } from "@sentinele2e/core";
import { PlaywrightResolver } from "./resolver";
import { PlaywrightAction } from "./action";
import { PlaywrightAssertion } from "./assertion";
import { PlaywrightElementHandle } from "./element";

export interface PlaywrightSessionOptions {
  readonly defaultTimeoutMs: number;
  readonly strategies: ReadonlySet<StrategyKind>;
  readonly capabilities: ReadonlySet<Capability>;
  readonly flowName?: string;
  /** Adopt this as Session.id (from SessionConfig.sessionId). Default: a fresh uuid. */
  readonly id?: string;
}

export class PlaywrightSession implements Session {
  readonly id: string;
  readonly driver = "playwright";
  readonly capabilities: ReadonlySet<Capability>;
  readonly telemetry: TelemetrySink;
  readonly action: Action;
  readonly assert: Assertion;

  private readonly page: Page;
  private readonly resolver: PlaywrightResolver;

  constructor(
    page: Page,
    telemetry: TelemetrySink,
    opts: PlaywrightSessionOptions,
  ) {
    this.page = page;
    this.id = opts.id ?? globalThis.crypto.randomUUID();
    // Single per-run SpanContext keyed on the session id, so traceId == correlationId ==
    // Session.id (spec §6). It is the ONE owner of sequence/spanId; the supplied sink
    // (e.g. CompositeSink([InMemorySink, JsonlSink])) is a pure output behind the stamper.
    this.telemetry = new StampingSink(new SpanContext(this.id), telemetry);
    this.capabilities = opts.capabilities;

    const ctx = {
      correlationId: this.id,
      flowName: opts.flowName ?? "session",
      startedAt: Date.now(),
    };

    this.resolver = new PlaywrightResolver(
      page,
      opts.strategies,
      this.telemetry,
      ctx,
    );
    this.action = new PlaywrightAction(this.resolver, opts.defaultTimeoutMs);
    this.assert = new PlaywrightAssertion(
      page,
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
        `Driver "playwright" does not support capability "${cap}"`,
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
    // A re-resolving handle: the first candidate is the eager winner; every call
    // recompiles. The resolver still owns the emit on action/assert paths.
    const primary = locator.candidates[0];
    if (primary === undefined) {
      throw new Error(`Locator "${locator.logicalName}" has no candidates`);
    }
    return new PlaywrightElementHandle(this.page, locator, primary);
  }

  async navigate(url: string): Promise<void> {
    this.require("navigation");
    await this.page.goto(url);
  }

  async currentUrl(): Promise<string> {
    this.require("navigation");
    return this.page.url();
  }

  async back(): Promise<void> {
    this.require("navigation");
    await this.page.goBack();
  }

  async screenshot(): Promise<Buffer> {
    this.require("screenshot");
    return this.page.screenshot();
  }

  async end(): Promise<void> {
    // Page lifecycle is owned by the test (page-wrap path); nothing to tear down.
  }
}

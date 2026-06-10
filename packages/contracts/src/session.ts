// packages/contracts/src/session.ts
import type { Capability, CapabilityProbe } from "./capability";
import type { ElementHandle } from "./element";
import type { Locator } from "./locator";
import type { Action } from "./action";
import type { Assertion } from "./assertion";

/** Structural minimum of a telemetry sink, declared here to keep @sentinel/contracts
 *  dependency-free. @sentinel/core's TelemetrySink is structurally assignable to this. */
export interface TelemetrySinkLike {
  emit(event: unknown): void;
  child(name: string): TelemetrySinkLike;
}

export interface Session extends CapabilityProbe {
  readonly id: string; // == telemetry traceId == ResultMeta.correlationId
  readonly driver: string;
  readonly capabilities: ReadonlySet<Capability>;
  readonly telemetry: TelemetrySinkLike;

  locate(locator: Locator): ElementHandle;
  readonly action: Action;
  readonly assert: Assertion;

  // capability "navigation" (web / webview) — async (Appium webview URL is async). NOT on universal surface.
  navigate?(url: string): Promise<void>;
  currentUrl?(): Promise<string>;
  back?(): Promise<void>;

  // capability "contexts" (mobile)
  contexts?(): Promise<readonly string[]>;
  switchContext?(name: string): Promise<void>;

  screenshot?(): Promise<Buffer>; // capability "screenshot"
  end(): Promise<void>;
}

export interface SessionConfig {
  readonly baseUrl?: string; // OPTIONAL: ignored on the page-wrap path (test owns page.goto)
  readonly defaultTimeoutMs: number; // single timeout source of truth (replaces 10_000 literals)
  /** Slice-A only: the driver adopts this as Session.id when provided, so the flow's runId
   *  (the JSONL filename) == Session.id == correlationId == every event's traceId (§3.7/§6). */
  readonly sessionId?: string;
  /** Slice-A only: wrap a pre-navigated Playwright Page so logIn(page,...) stays working. */
  readonly existingPage?: unknown;
}

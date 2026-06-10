// packages/driver-playwright/src/driver.ts
import type { Page } from "@playwright/test";
import type {
  Capability,
  Driver,
  Session,
  SessionConfig,
  StrategyKind,
} from "@sentinel/contracts";
import { DriverSessionError } from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { PlaywrightSession } from "./session";

const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "navigation",
  "dom",
  "accessibilityTree",
  "screenshot",
]);

const STRATEGIES: ReadonlySet<StrategyKind> = new Set<StrategyKind>([
  "role",
  "label",
  "text",
  "testid",
  "css",
  "xpath",
]);

/** Duck-type guard — the ONE place a Playwright Page is narrowed (spec §3.7). */
function isPage(candidate: unknown): candidate is Page {
  if (typeof candidate !== "object" || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  return typeof c["goto"] === "function" && typeof c["locator"] === "function";
}

export class PlaywrightDriver implements Driver {
  readonly name = "playwright";
  readonly capabilities = CAPABILITIES;
  readonly strategies = STRATEGIES;

  async createSession(
    config: SessionConfig,
    telemetry: TelemetrySink,
  ): Promise<Session> {
    if (!isPage(config.existingPage)) {
      throw new DriverSessionError(
        "PlaywrightDriver.createSession requires config.existingPage to be a Playwright Page (missing goto/locator)",
        {
          correlationId: "unassigned",
          flowName: "session",
          startedAt: Date.now(),
          durationMs: 0,
        },
      );
    }

    // The single guarded `as Page` narrowing point (spec §3.7 note).
    const page = config.existingPage;

    return new PlaywrightSession(page, telemetry, {
      defaultTimeoutMs: config.defaultTimeoutMs,
      strategies: this.strategies,
      capabilities: this.capabilities,
      id: config.sessionId,
    });
  }
}

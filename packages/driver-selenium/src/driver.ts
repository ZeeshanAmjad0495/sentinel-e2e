// packages/driver-selenium/src/driver.ts
import type { WebDriver } from "selenium-webdriver";
import type {
  Capability,
  Driver,
  Session,
  SessionConfig,
  StrategyKind,
} from "@sentinel/contracts";
import { DriverSessionError } from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { SeleniumSession } from "./session";

// NOT "role" (needs an a11y-tree shim) / "relative".
const STRATEGIES: ReadonlySet<StrategyKind> = new Set<StrategyKind>([
  "css",
  "xpath",
  "testid",
  "text",
  "label",
  "placeholder",
  "altText",
  "title",
]);

// NOT accessibilityTree / gestures / contexts / networkInspection.
const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "navigation",
  "dom",
  "screenshot",
]);

/** Duck-type guard — the ONE place a Selenium WebDriver is narrowed (spec §5.1). */
function isWebDriver(candidate: unknown): candidate is WebDriver {
  if (typeof candidate !== "object" || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  return (
    typeof c["findElements"] === "function" && typeof c["get"] === "function"
  );
}

export class SeleniumDriver implements Driver {
  readonly name = "selenium";
  readonly capabilities = CAPABILITIES;
  readonly strategies = STRATEGIES;

  async createSession(
    config: SessionConfig,
    telemetry: TelemetrySink,
  ): Promise<Session> {
    // Prefer the dedicated additive seam; fall back to existingPage (D4).
    const adopted = config.existingSession ?? config.existingPage;
    if (!isWebDriver(adopted)) {
      throw new DriverSessionError(
        "SeleniumDriver.createSession requires config.existingSession (or existingPage) to be a Selenium WebDriver (missing findElements/get)",
        {
          correlationId: "unassigned",
          flowName: "session",
          startedAt: Date.now(),
          durationMs: 0,
        },
      );
    }

    return new SeleniumSession(adopted, telemetry, {
      defaultTimeoutMs: config.defaultTimeoutMs,
      strategies: this.strategies,
      capabilities: this.capabilities,
      id: config.sessionId,
    });
  }
}

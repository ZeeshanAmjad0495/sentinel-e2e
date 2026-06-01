// packages/contracts/src/driver.ts
import type { Capability } from "./capability";
import type { StrategyKind } from "./locator";
import type { Session, SessionConfig, TelemetrySinkLike } from "./session";

export interface Driver {
  readonly name: string; // "playwright" | "appium-uiautomator2"
  readonly capabilities: ReadonlySet<Capability>;
  readonly strategies: ReadonlySet<StrategyKind>; // which locator kinds this driver can compile
  createSession(
    config: SessionConfig,
    telemetry: TelemetrySinkLike,
  ): Promise<Session>;
}

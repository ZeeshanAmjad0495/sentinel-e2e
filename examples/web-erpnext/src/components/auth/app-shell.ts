// examples/web-erpnext/src/components/auth/app-shell.ts
import type { Session } from "@sentinele2e/contracts";
import { appShellLocators } from "../../domain/auth/locators";
import { defaultTimeoutMs } from "../../config/timeout";

/**
 * App-shell readiness on the Session contract (spec §8).
 * D1 fixed: no captured-once page.url(); readiness re-resolves the `ready` locator each tick.
 * D2 fixed: assert.waitFor THROWS TimeoutError on timeout — it never resolves by timing out.
 */
export class AppShell {
  constructor(private readonly session: Session) {}

  async waitForReady(timeoutMs: number = defaultTimeoutMs): Promise<void> {
    await this.session.assert.waitFor(appShellLocators.ready, "visible", {
      timeoutMs,
    });
  }
}

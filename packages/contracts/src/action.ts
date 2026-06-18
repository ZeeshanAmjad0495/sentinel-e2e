// packages/contracts/src/action.ts
import type { Locator } from "./locator";

export type GestureTarget =
  | { readonly kind: "element"; readonly locator: Locator }
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "percent"; readonly xPct: number; readonly yPct: number };

/**
 * Per-action bound. `timeoutMs` bounds the time to make the target ACTIONABLE:
 *  - tap / typeText / clear: located + displayed + enabled
 *  - read: located (attached)
 * Effective timeout = min(timeoutMs, SessionConfig.defaultTimeoutMs) — a caller may
 * only TIGHTEN, never exceed, the session bound. Auto-wait drivers (Playwright) satisfy
 * this by passing { timeout } to the SDK call; no-auto-wait drivers (Selenium) satisfy it
 * by polling to that deadline before performing the verb.
 */
export interface ActionOptions {
  readonly timeoutMs?: number;
}

export interface Action {
  // UNIVERSAL surface — genuinely total across web + native. Neutral verb is "tap", not "click".
  tap(target: Locator, opts?: ActionOptions): Promise<void>;
  typeText(target: Locator, text: string, opts?: ActionOptions): Promise<void>;
  clear(target: Locator, opts?: ActionOptions): Promise<void>;
  read(target: Locator, opts?: ActionOptions): Promise<string>;

  // capability "gestures" (mobile-native) — absent => CapabilityUnsupportedError.
  swipe?(
    from: GestureTarget,
    dir: "up" | "down" | "left" | "right",
    opts?: { velocity?: number },
  ): Promise<void>;
  longPress?(target: GestureTarget, ms?: number): Promise<void>;
  scrollTo?(target: Locator): Promise<void>;
}

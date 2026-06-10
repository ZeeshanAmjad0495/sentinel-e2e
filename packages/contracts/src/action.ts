// packages/contracts/src/action.ts
import type { Locator } from "./locator";

export type GestureTarget =
  | { readonly kind: "element"; readonly locator: Locator }
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "percent"; readonly xPct: number; readonly yPct: number };

export interface Action {
  // UNIVERSAL surface — genuinely total across web + native. Neutral verb is "tap", not "click".
  tap(target: Locator): Promise<void>;
  typeText(target: Locator, text: string): Promise<void>;
  clear(target: Locator): Promise<void>;
  read(target: Locator): Promise<string>;

  // capability "gestures" (mobile-native) — absent => CapabilityUnsupportedError.
  swipe?(
    from: GestureTarget,
    dir: "up" | "down" | "left" | "right",
    opts?: { velocity?: number },
  ): Promise<void>;
  longPress?(target: GestureTarget, ms?: number): Promise<void>;
  scrollTo?(target: Locator): Promise<void>;
}

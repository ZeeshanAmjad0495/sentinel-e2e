// packages/contracts/src/capability.ts
export type Capability =
  | "navigation" // URL + back/forward .......... web / mobile-webview
  | "dom" // a document tree ............. web
  | "accessibilityTree" // getByRole semantics ......... web
  | "gestures" // swipe/scroll/pinch/long-press  mobile-native
  | "contexts" // NATIVE_APP <-> WEBVIEW ....... mobile
  | "screenshot"
  | "networkInspection";

export interface CapabilityProbe {
  supports(cap: Capability): boolean;
  /** Loud, typed gate. Throws CapabilityUnsupportedError (a SystemFailureError) if absent. */
  require(cap: Capability): void;
}

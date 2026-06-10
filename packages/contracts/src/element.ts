// packages/contracts/src/element.ts
import type { Locator } from "./locator";

export interface ElementHandle {
  readonly locator: Locator;
  exists(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  text(): Promise<string>;
  /** NB: attribute namespaces are driver-specific (HTML attrs vs resource-id/content-desc). */
  attribute(name: string): Promise<string | null>;
}

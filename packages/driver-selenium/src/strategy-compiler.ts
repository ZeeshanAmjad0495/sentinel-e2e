// packages/driver-selenium/src/strategy-compiler.ts
import type { LocatorStrategy } from "@sentinele2e/contracts";
import { By } from "selenium-webdriver";

/**
 * A pure, browser-free descriptor structurally identical to Selenium's `By`
 * locator payload ({ using, value }). `toBy()` wraps it into a real `By`.
 */
export interface ByDescriptor {
  readonly using: string;
  readonly value: string;
}

const CSS = "css selector";
const XPATH = "xpath";

/** A caller may opt into EXACT matching; default is substring (Playwright parity). */
function isExact(options: LocatorStrategy["options"]): boolean {
  return options?.["exact"] === true;
}

/** Escape a CSS attribute-selector value: backslash and double-quote. */
function cssEsc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Produce an XPath string literal for an arbitrary value, handling embedded
 * quotes via concat() (XPath 1.0 has no escape mechanism inside literals).
 *  - no single quote  -> '...'
 *  - no double quote   -> "..."
 *  - both              -> concat('a', "'", 'b', ...)
 */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  // Split on single quotes; rejoin with explicit "'" segments via concat().
  const parts = value.split("'");
  const pieces: string[] = [];
  parts.forEach((part, i) => {
    if (part.length > 0) pieces.push(`'${part}'`);
    if (i < parts.length - 1) pieces.push(`"'"`);
  });
  return `concat(${pieces.join(", ")})`;
}

/** CSS attribute selector: exact (`[a="v"]`) or substring (`[a*="v"]`). */
function attrSelector(attr: string, value: string, exact: boolean): string {
  const op = exact ? "=" : "*=";
  return `[${attr}${op}"${cssEsc(value)}"]`;
}

/** The §5.2 label union, parameterized by the exact/substring match predicate `$m`. */
function labelXpath(value: string, exact: boolean): string {
  const lit = xpathLiteral(value);
  const m = exact
    ? `normalize-space(.)=${lit}`
    : `contains(normalize-space(.),${lit})`;
  return [
    `//input[@id=//label[${m}]/@for]`,
    `//textarea[@id=//label[${m}]/@for]`,
    `//select[@id=//label[${m}]/@for]`,
    `//label[${m}]//input`,
    `//label[${m}]//textarea`,
    `//label[${m}]//select`,
    `//*[@aria-label=${lit}]`,
    `//*[@aria-labelledby=//*[${m}]/@id]`,
  ].join(" | ");
}

/** PURE: compile a contract LocatorStrategy into a Selenium `By` descriptor. */
export function compileStrategy(strategy: LocatorStrategy): ByDescriptor {
  const { kind, value } = strategy;
  const exact = isExact(strategy.options);

  switch (kind) {
    case "css":
      return { using: CSS, value };
    case "xpath":
      return { using: XPATH, value };
    case "testid":
      // testid is always an exact attribute match.
      return { using: CSS, value: `[data-testid="${cssEsc(value)}"]` };
    case "placeholder":
      return { using: CSS, value: attrSelector("placeholder", value, exact) };
    case "title":
      return { using: CSS, value: attrSelector("title", value, exact) };
    case "altText":
      return { using: CSS, value: attrSelector("alt", value, exact) };
    case "text": {
      const lit = xpathLiteral(value);
      const xp = exact
        ? `.//*[normalize-space(.)=${lit}]`
        : `.//*[contains(normalize-space(.),${lit})]`;
      return { using: XPATH, value: xp };
    }
    case "label":
      return { using: XPATH, value: labelXpath(value, exact) };
    default:
      // role / relative / unknown kinds are not compilable by Selenium.
      throw new Error(
        `unsupported strategy kind: "${kind}" (selenium compiler only handles css|xpath|testid|placeholder|title|altText|text|label)`,
      );
  }
}

/** Wrap a pure descriptor into a real Selenium `By`. */
export function toBy(desc: ByDescriptor): By {
  return new By(desc.using, desc.value);
}

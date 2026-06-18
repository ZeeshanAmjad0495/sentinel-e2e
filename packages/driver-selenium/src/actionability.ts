// packages/driver-selenium/src/actionability.ts
import type { By, WebDriver, WebElement } from "selenium-webdriver";
import { TimeoutError } from "@sentinel/core";

const SLICE_MS = 50;

export interface ActionableOptions {
  /** tap/typeText/clear require displayed+enabled; read requires only attached. */
  readonly requireEnabled: boolean;
  /** Absolute deadline (Date.now() + clamped timeout). */
  readonly deadline: number;
}

interface ErrorContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

/**
 * Selenium has no auto-wait. Poll findElements (which returns [] rather than
 * throwing) in 50ms slices until the element is actionable or the deadline
 * passes. Absence/not-ready is never an exception — only the deadline throws.
 *
 *  - requireEnabled:true  -> located + displayed + enabled (tap/typeText/clear)
 *  - requireEnabled:false -> located/attached only (read)
 *
 * Returns the actionable WebElement so the verb can act on it without a second
 * (race-prone) findElement round-trip.
 */
export async function waitActionable(
  driver: WebDriver,
  by: By,
  opts: ActionableOptions,
  ctx: ErrorContext,
): Promise<WebElement> {
  // Probe at least once even if the deadline has already passed.
  for (;;) {
    const candidate = await probe(driver, by, opts.requireEnabled);
    if (candidate !== null) return candidate;
    if (Date.now() >= opts.deadline) break;
    await sleep(Math.min(SLICE_MS, Math.max(0, opts.deadline - Date.now())));
  }

  throw new TimeoutError(
    `element did not become actionable within the deadline (requireEnabled=${opts.requireEnabled})`,
    {
      correlationId: ctx.correlationId,
      flowName: ctx.flowName,
      startedAt: ctx.startedAt,
      durationMs: 0,
    },
  );
}

async function probe(
  driver: WebDriver,
  by: By,
  requireEnabled: boolean,
): Promise<WebElement | null> {
  const els = await driver.findElements(by);
  const el = els[0];
  if (el === undefined) return null;
  if (!requireEnabled) return el; // attached is enough (read)
  // Per-element checks may throw on a stale element mid-poll; treat as not-ready.
  try {
    if (!(await el.isDisplayed())) return null;
    if (!(await el.isEnabled())) return null;
    return el;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

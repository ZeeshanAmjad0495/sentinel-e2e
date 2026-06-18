// packages/ai/src/redact.ts
import type { TelemetryEvent } from "@sentinele2e/core";

const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
const REDACTED = "[redacted]";

/**
 * Unambiguous secret SHAPES to scrub from freeform string VALUES. These are
 * deliberately narrow so that UUID ids (traceId/spanId/eventId), CSS selectors,
 * plain prose and numbers are never matched. Generic high-entropy detection is
 * intentionally NOT done (it would nuke UUIDs).
 *  - JWTs (three base64url segments)
 *  - `Bearer <token>` authorization values
 *  - common API-key prefixes: OpenAI `sk-`, GitHub `ghp_`, Slack `xox[baprs]-`,
 *    AWS access key `AKIA...`
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
];

/** Replace any secret-shaped substring within a freeform string value. */
function redactSecretShapes(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Public, single-string secret scrubber: scrubs unambiguous secret SHAPES
 * (JWT / Bearer / sk- / ghp_ / xox*- / AKIA...) from a freeform string,
 * preserving UUIDs, selectors and prose. A thin wrapper over the private
 * `redactSecretShapes` so consumers (e.g. the slice-F dashboard) can scrub
 * evidence/explanation free-text before embedding. Same narrow, value-shape
 * limitation as `redactEvents`.
 */
export function redactText(value: string): string {
  return redactSecretShapes(value);
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecretShapes(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Defense-in-depth secret stripping before any event is sent to the LLM (spec §7).
 *
 * Deep-clones each event and (a) replaces any value whose KEY matches the secret
 * pattern with `"[redacted]"`, and (b) scrubs any string VALUE that matches an
 * unambiguous secret shape (JWT / Bearer / sk- / ghp_ / xox*- / AKIA...). UUID
 * ids, selectors, prose and numbers are deliberately preserved. The telemetry is
 * already credential-free (verified in slice A); this is belt-and-suspenders. The
 * input array is never mutated.
 */
export function redactEvents(
  events: readonly TelemetryEvent[],
): TelemetryEvent[] {
  return events.map((event) => redactValue(event) as TelemetryEvent);
}

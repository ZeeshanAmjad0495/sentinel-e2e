// packages/ai/src/redact.ts
import type { TelemetryEvent } from "@sentinel/core";

const SECRET_KEY =
  /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
const REDACTED = "[redacted]";

function redactValue(value: unknown): unknown {
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
 * Deep-clones each event and replaces any value whose KEY matches the secret
 * pattern with `"[redacted]"`. The telemetry is already credential-free (verified
 * in slice A); this is belt-and-suspenders. The input array is never mutated.
 */
export function redactEvents(
  events: readonly TelemetryEvent[],
): TelemetryEvent[] {
  return events.map((event) => redactValue(event) as TelemetryEvent);
}

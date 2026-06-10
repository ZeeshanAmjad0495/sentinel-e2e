// packages/ai/src/load.ts
import { readFileSync } from "node:fs";
import type { TelemetryEvent } from "@sentinel/core";

/** Loosely-typed parse of a JSONL line: timing ns fields stay as strings. */
interface RawEvent {
  readonly schemaVersion?: unknown;
  readonly name?: unknown;
  readonly timing?: unknown;
}

const SCHEMA_MAJOR = "1";

const majorOf = (version: string): string => version.split(".")[0] ?? "";

/**
 * Load an ordered run as `TelemetryEvent[]`.
 *
 * - `string` input is treated as a JSONL file path: each non-empty line is parsed
 *   as JSON; malformed lines are skipped with a `console.warn`; zero valid events throws.
 * - An in-memory `TelemetryEvent[]` is returned as a defensive shallow copy.
 *
 * Per spec §13 Q3 the `timing.startMonotonicNs`/`endMonotonicNs` fields are KEPT in
 * their JSONL decimal-string form (no bigint revive) — the analyzer needs no ns math.
 * The parsed records are returned as `TelemetryEvent[]` via a single boundary cast.
 */
export function loadEvents(
  input: string | readonly TelemetryEvent[],
): TelemetryEvent[] {
  if (typeof input !== "string") {
    return [...input];
  }

  const raw = readFileSync(input, "utf8");
  const events: RawEvent[] = [];
  let warnedUnknownMajor = false;

  for (const rawLine of raw.split("\n")) {
    const lineText = rawLine.trim();
    if (lineText === "") continue;

    let parsed: RawEvent;
    try {
      parsed = JSON.parse(lineText) as RawEvent;
    } catch {
      console.warn(`loadEvents: skipping malformed JSONL line: ${lineText}`);
      continue;
    }

    if (
      !warnedUnknownMajor &&
      typeof parsed.schemaVersion === "string" &&
      majorOf(parsed.schemaVersion) !== SCHEMA_MAJOR
    ) {
      warnedUnknownMajor = true;
      console.warn(
        `loadEvents: unknown telemetry schemaVersion major "${parsed.schemaVersion}"; continuing best-effort`,
      );
    }

    events.push(parsed);
  }

  if (events.length === 0) {
    throw new Error(
      `loadEvents: no valid telemetry events found in "${input}"`,
    );
  }

  // Boundary cast: ns timing fields remain strings; the analyzer performs no ns math.
  return events as unknown as TelemetryEvent[];
}

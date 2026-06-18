// packages/dashboard/src/model.ts
//
// The dashboard input model. `buildDashboardModel` is the ONLY part of the
// dashboard that may touch the filesystem (it loads telemetry to build per-run
// detail). The render path (render.ts) is pure over this model — no fs, no net.
//
// CRITICAL data rules (spec §3):
//  - Two layers never mixed: `report.totals.<kind>` is RUN-level (omits
//    `indeterminate`); per-run `RunSummary.verdictCounts` is verdict-level
//    (includes `indeterminate`). The render layer keeps them separate.
//  - The on-disk `*Ns` timing fields are STRINGS; never do arithmetic on them.
//    The timeline axis uses only the numeric `startWallClockMs` / `durationMs`.
//  - `StrategyKind` is a bare string; unknown event types render generically.
//  - Rules-only is network-free: `buildReport` / `buildDashboardModel` here use
//    `provider:null` (via buildReport) and never call the LLM.
import * as path from "node:path";
import type { TelemetryEvent } from "@sentinele2e/core";
import {
  analyzeRun,
  buildReport,
  classify,
  loadEvents,
  redactEvents,
  redactText,
  type RunReport,
  type RunSummary,
  type Verdict,
} from "@sentinele2e/ai";

/** Default per-run timeline cap before a `truncated` flag is raised. */
export const DEFAULT_MAX_EVENTS = 500;

export interface BuildDashboardModelOptions {
  /** Build per-run timelines/verdicts. Default true. */
  readonly detail?: boolean;
  /** Per-run timeline event cap. Default DEFAULT_MAX_EVENTS (500). */
  readonly maxEvents?: number;
  /** Stable "generatedAt" stamp (injectable for deterministic tests/snapshots). */
  readonly generatedAt?: string;
  /**
   * Opt-in LLM prose per run (redacted before embedding). Default false:
   * rules-only, NO provider, network-free. When true, `analyzeRun(file)` is
   * called per run (auto-resolves a ClaudeProvider IFF ANTHROPIC_API_KEY is set,
   * else stays rules-only); any returned explanation is passed through
   * `redactText` before it lands in the model.
   */
  readonly explain?: boolean;
}

/**
 * A single timeline row: the redacted telemetry event plus the only two numeric
 * axis fields we are allowed to use. The raw event is carried for type-specific
 * rendering; its `*Ns` string fields are never used for arithmetic.
 */
export interface TimelineEntry {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly name: string;
  /** numeric wall-clock start (ms); the ONLY time axis. */
  readonly startWallClockMs: number;
  /** numeric duration (ms) when present; never derived from `*Ns`. */
  readonly durationMs?: number;
  /** the redacted event, for type-specific field rendering. */
  readonly event: TelemetryEvent;
}

/** Per-run drill-down model, built from REDACTED events. */
export interface RunDetail {
  readonly runId: string;
  readonly file: string;
  /** Derived: min(startWallClockMs) across events. Not in the contract. */
  readonly startedAt: number;
  /** sequence-ordered, capped timeline rows (from redacted events). */
  readonly timeline: readonly TimelineEntry[];
  /** verdicts rebuilt from classify(redacted) — evidence is already scrubbed. */
  readonly verdicts: readonly Verdict[];
  /** plain-language explanation (only when --explain + usedLlm; never F2–F6). */
  readonly explanation?: string;
  /** total events seen before the maxEvents cap was applied. */
  readonly totalEvents: number;
  /** true iff the timeline was capped at maxEvents. */
  readonly truncated: boolean;
}

export interface DashboardModel {
  readonly report: RunReport;
  /** per-run detail, time-ordered by derived `startedAt` (NOT filename). */
  readonly runs: readonly RunDetail[];
  readonly generatedAt: string;
  /** true iff any run's timeline was truncated. */
  readonly anyTruncated: boolean;
}

/** Stable numeric extraction guard: only accept real numbers (never `*Ns`). */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

interface RawTiming {
  readonly startWallClockMs?: unknown;
  readonly durationMs?: unknown;
}

function timingOf(event: TelemetryEvent): RawTiming {
  const t = (event as { timing?: unknown }).timing;
  return (t && typeof t === "object" ? t : {}) as RawTiming;
}

/**
 * Build a single run's drill-down detail from a JSONL file.
 *  1. loadEvents (raw, unredacted, `*Ns` are strings)
 *  2. redactEvents (scrub by key + value-shape)
 *  3. classify(redacted) -> verdicts/evidence rebuilt from SCRUBBED strings
 *  4. timeline = redacted events sorted by `sequence`, capped at maxEvents
 *  5. startedAt = min(startWallClockMs)
 */
async function buildRunDetail(
  file: string,
  summary: RunSummary,
  maxEvents: number,
  explain: boolean,
): Promise<RunDetail> {
  const events = loadEvents(file);
  const redacted = redactEvents(events);
  const classification = classify(redacted);

  // Opt-in only. On the default path (explain === false) we NEVER call
  // analyzeRun, so the model build stays rules-only and network-free.
  let explanation: string | undefined;
  if (explain) {
    const analysis = await analyzeRun(file, { explain: true });
    if (analysis.usedLlm && analysis.explanation) {
      // belt-and-suspenders: scrub the prose before it is embedded.
      explanation = redactText(analysis.explanation);
    }
  }

  const sorted = [...redacted].sort((a, b) => a.sequence - b.sequence);
  const totalEvents = sorted.length;
  const truncated = totalEvents > maxEvents;
  const capped = truncated ? sorted.slice(0, maxEvents) : sorted;

  const timeline: TimelineEntry[] = capped.map((event) => {
    const timing = timingOf(event);
    return {
      sequence: event.sequence,
      eventId: event.eventId,
      type: event.type,
      name: event.name,
      // Axis uses ONLY the numeric wall-clock/duration; `*Ns` strings ignored.
      startWallClockMs: numberOrUndefined(timing.startWallClockMs) ?? 0,
      durationMs: numberOrUndefined(timing.durationMs),
      event,
    };
  });

  const startTimes = redacted
    .map((e) => numberOrUndefined(timingOf(e).startWallClockMs))
    .filter((n): n is number => n !== undefined);
  const startedAt = startTimes.length > 0 ? Math.min(...startTimes) : 0;

  return {
    runId: summary.runId,
    file: summary.file,
    startedAt,
    timeline,
    verdicts: classification.verdicts,
    explanation,
    totalEvents,
    truncated,
  };
}

/**
 * Build the dashboard model over a telemetry directory. PURE w.r.t. the network
 * (rules-only via `buildReport`'s `provider:null`); reads the filesystem only to
 * load per-run events for the drill-down. Runs are time-ordered by the derived
 * `startedAt`, not by filename.
 */
export async function buildDashboardModel(
  dir: string,
  opts: BuildDashboardModelOptions = {},
): Promise<DashboardModel> {
  const detail = opts.detail ?? true;
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
  const generatedAt = opts.generatedAt ?? new Date(0).toISOString();
  const explain = opts.explain ?? false;

  const report = await buildReport(dir);

  let runs: RunDetail[] = [];
  if (detail) {
    runs = await Promise.all(
      report.runs.map((summary) =>
        buildRunDetail(
          path.join(dir, summary.file),
          summary,
          maxEvents,
          explain,
        ),
      ),
    );
    // Time-order by derived startedAt (true time order, not filename).
    runs.sort((a, b) => a.startedAt - b.startedAt);
  }

  return {
    report,
    runs,
    generatedAt,
    anyTruncated: runs.some((r) => r.truncated),
  };
}

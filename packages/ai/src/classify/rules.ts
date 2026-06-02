// packages/ai/src/classify/rules.ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
  SystemFailureEvent,
} from "@sentinel/core";
import type { RunClassification, RunOutcome } from "../analysis";
import type { Verdict, Evidence } from "../verdict";

const OUTCOME_MAP: Record<FlowFinishedEvent["outcome"], RunOutcome> = {
  success: "success",
  "business-failure": "business-failure",
  "system-failure": "system-failure",
};

function isType<T extends TelemetryEvent["type"]>(
  e: TelemetryEvent,
  type: T,
): e is Extract<TelemetryEvent, { type: T }> {
  return e.type === type;
}

function driftEvidence(e: LocatorResolvedEvent): Evidence {
  const trail = e.candidates
    .map((c) => `${c.kind}:${c.outcome}@${c.rank}`)
    .join(" -> ");
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.logicalName}' degraded to '${e.resolvedKind}' rank ${e.resolvedRank} (${trail})`,
    fields: {
      logicalName: e.logicalName,
      resolvedKind: e.resolvedKind,
      resolvedRank: e.resolvedRank,
    },
  };
}

const SELECTOR_DRIFT_KINDS: ReadonlySet<SystemFailureEvent["errorKind"]> =
  new Set(["selector-not-found", "selector-ambiguous"]);

function failureEvidence(e: SystemFailureEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}': ${e.errorKind} — ${e.message}`,
    fields: {
      logicalName: e.name,
      errorKind: e.errorKind,
      retryable: e.retryable,
    },
  };
}

/** Pure deterministic classifier. No I/O, no API. Implements spec §4. */
export function classify(events: readonly TelemetryEvent[]): RunClassification {
  const runId = events[0]?.traceId ?? "";
  const flow = [...events]
    .reverse()
    .find((e): e is FlowFinishedEvent => isType(e, "flow.finished"));
  const flowName = flow?.name;
  const outcome: RunOutcome = flow ? OUTCOME_MAP[flow.outcome] : "unknown";

  const degradedResolutions = events.filter(
    (e): e is LocatorResolvedEvent =>
      isType(e, "locator.resolved") && (e.degraded || e.resolvedRank > 0),
  );
  const degraded =
    (flow?.didDegrade ?? false) || degradedResolutions.length > 0;

  const verdicts: Verdict[] = [];
  const indeterminate: Verdict[] = [];

  // §4.2 — selector-drift for each degraded locator.resolved
  for (const r of degradedResolutions) {
    verdicts.push({
      kind: "selector-drift",
      confidence: 0.9,
      summary: `Locator '${r.logicalName}' drifted to a rank-${r.resolvedRank} fallback`,
      evidence: [driftEvidence(r)],
      logicalName: r.logicalName,
      source: "rule",
    });
  }

  // §4.2 — selector-not-found / selector-ambiguous system failures are drift
  for (const e of events) {
    if (!isType(e, "system.failure")) continue;
    if (!SELECTOR_DRIFT_KINDS.has(e.errorKind)) continue;
    verdicts.push({
      kind: "selector-drift",
      confidence: 0.9,
      summary: `Locator '${e.name}' could not be resolved (${e.errorKind})`,
      evidence: [failureEvidence(e)],
      logicalName: e.name,
      source: "rule",
    });
  }

  // §4.6 — healthy: success with no defects (coexists with drift warnings)
  const hasDefect = verdicts.some(
    (v) => v.kind === "real-bug" || v.kind === "business-outcome",
  );
  if (outcome === "success" && !hasDefect) {
    verdicts.push({
      kind: "healthy",
      confidence: 1.0,
      summary: degraded
        ? "Run succeeded but a locator silently drifted"
        : "Run succeeded with no degradation",
      evidence: [],
      source: "rule",
    });
  }

  return { runId, flowName, outcome, degraded, verdicts, indeterminate };
}

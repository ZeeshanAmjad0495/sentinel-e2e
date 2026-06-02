// packages/ai/src/classify/rules.ts
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  FlowFinishedEvent,
  SystemFailureEvent,
  AssertionEvent,
  RetryEvent,
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

const RETRYABLE_FLAKE_KINDS: ReadonlySet<SystemFailureEvent["errorKind"]> =
  new Set(["timeout", "driver-session"]);

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

function retryEvidence(e: RetryEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}' retried (attempt ${e.attempt}/${e.maxAttempts}; previous: ${e.previousOutcome})`,
    fields: {
      attempt: e.attempt,
      maxAttempts: e.maxAttempts,
      previousOutcome: e.previousOutcome,
    },
  };
}

function hasPrecedingRetry(
  events: readonly TelemetryEvent[],
  index: number,
  spanId: string,
): boolean {
  for (let i = 0; i < index; i++) {
    const e = events[i];
    if (e && isType(e, "retry") && e.spanId === spanId) return true;
  }
  return false;
}

function assertionEvidence(e: AssertionEvent): Evidence {
  return {
    eventId: e.eventId,
    type: e.type,
    detail: `'${e.name}' never reached state '${e.state}' (most-durable locator rank 0)`,
    fields: { state: e.state, matched: e.matched, locatorRank: e.locatorRank },
  };
}

/** True when any assertion in the same span shows a success-signal branch
 *  that reached "attached" but never "visible" (the app rendered the node
 *  but never made it visible — an app defect, not a flake). */
function isAttachedNotVisible(
  events: readonly TelemetryEvent[],
  spanId: string,
): boolean {
  return events.some(
    (e) =>
      isType(e, "assertion") &&
      e.spanId === spanId &&
      (e.branchProgress ?? []).some((b) => b.reachedState === "attached"),
  );
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

  // §4.3 — rank-0 assertion mismatch with no preceding retry → real-bug
  events.forEach((e, i) => {
    if (!isType(e, "assertion")) return;
    if (e.matched || e.locatorRank !== 0) return;
    if (hasPrecedingRetry(events, i, e.spanId)) return;
    verdicts.push({
      kind: "real-bug",
      confidence: 0.85,
      summary: `Assertion '${e.name}' failed with a stable rank-0 locator`,
      evidence: [assertionEvidence(e)],
      logicalName: e.name,
      source: "rule",
    });
  });

  // §4.3 — timeout whose branchProgress is attached-not-visible → real-bug
  const attachedNotVisibleTimeouts = new Set<string>();
  for (const e of events) {
    if (!isType(e, "system.failure")) continue;
    if (e.errorKind !== "timeout") continue;
    if (!isAttachedNotVisible(events, e.spanId)) continue;
    attachedNotVisibleTimeouts.add(e.eventId);
    verdicts.push({
      kind: "real-bug",
      confidence: 0.85,
      summary: `Timeout on '${e.name}': success signal attached but never became visible`,
      evidence: [failureEvidence(e)],
      logicalName: e.name,
      source: "rule",
    });
  }

  // §4.4 — retry-then-pass → infra-flake
  if (outcome === "success") {
    for (const e of events) {
      if (!isType(e, "retry")) continue;
      verdicts.push({
        kind: "infra-flake",
        confidence: 0.8,
        summary: `Transient failure on '${e.name}' recovered after retry`,
        evidence: [retryEvidence(e)],
        logicalName: e.name,
        source: "rule",
      });
    }
  }

  // §4.4 — retryable timeout/driver-session that is NOT already a rank-0
  // assertion mismatch nor an attached-not-visible timeout → infra-flake
  const rankZeroMismatchSpans = new Set(
    events
      .filter(
        (e): e is AssertionEvent =>
          isType(e, "assertion") && !e.matched && e.locatorRank === 0,
      )
      .map((e) => e.spanId),
  );
  for (const e of events) {
    if (!isType(e, "system.failure")) continue;
    if (!e.retryable || !RETRYABLE_FLAKE_KINDS.has(e.errorKind)) continue;
    if (attachedNotVisibleTimeouts.has(e.eventId)) continue;
    if (rankZeroMismatchSpans.has(e.spanId)) continue;
    verdicts.push({
      kind: "infra-flake",
      confidence: 0.8,
      summary: `Retryable ${e.errorKind} on '${e.name}'`,
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

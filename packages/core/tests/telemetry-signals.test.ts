// packages/core/tests/telemetry-signals.test.ts
import { test, expect } from "@playwright/test";
import { TELEMETRY_SCHEMA_VERSION } from "@sentinele2e/core";
import type {
  LocatorResolvedEvent,
  AssertionEvent,
  RetryEvent,
  BusinessFailureEvent,
  SystemFailureEvent,
  ArtifactCapturedEvent,
  FlowFinishedEvent,
  TelemetryEvent,
} from "@sentinele2e/core";

const base = {
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: "e",
  traceId: "run-1",
  spanId: "s",
  sequence: 1,
  name: "n",
  timing: { startWallClockMs: 1, startMonotonicNs: 1n },
} as const;

test("LocatorResolvedEvent carries resolvedRank, degraded and candidates", () => {
  const e: LocatorResolvedEvent = {
    ...base,
    type: "locator.resolved",
    logicalName: "auth.login.submit",
    resolvedKind: "role",
    resolvedRank: 0,
    degraded: false,
    candidates: [{ kind: "role", outcome: "matched", rank: 0 }],
    score: 1,
    resolveDurationMs: 4,
  };
  expect(e.degraded).toBe(false);
  expect(e.candidates[0]?.outcome).toBe("matched");
});

test("BusinessFailureEvent fixes status:'ok' and SystemFailureEvent fixes status:'error'", () => {
  const bf: BusinessFailureEvent = {
    ...base,
    type: "business.failure",
    status: "ok",
    domainReason: "INVALID_CREDENTIALS",
  };
  const sf: SystemFailureEvent = {
    ...base,
    type: "system.failure",
    status: "error",
    errorKind: "timeout",
    message: "timed out",
    retryable: true,
    artifactRefs: [],
  };
  expect(bf.status).toBe("ok");
  expect(sf.errorKind).toBe("timeout");
});

test("Assertion/Retry/Artifact/FlowFinished events are satisfiable and join the union", () => {
  const events: TelemetryEvent[] = [
    {
      ...base,
      type: "assertion",
      state: "visible",
      matched: true,
      locatorRank: 0,
    } as AssertionEvent,
    {
      ...base,
      type: "retry",
      attempt: 1,
      maxAttempts: 2,
      reason: "flake",
      previousOutcome: "timeout",
    } as RetryEvent,
    {
      ...base,
      type: "artifact.captured",
      artifactKind: "dom-snapshot",
      ref: "x.html",
      capturedOn: "degradedResolution",
    } as ArtifactCapturedEvent,
    {
      ...base,
      type: "flow.finished",
      outcome: "business-failure",
      terminalReason: "INVALID_CREDENTIALS",
      didDegrade: false,
    } as FlowFinishedEvent,
  ];
  expect(events).toHaveLength(4);
  expect(events.map((e) => e.type)).toContain("flow.finished");
});

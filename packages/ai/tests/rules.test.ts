// packages/ai/tests/rules.test.ts
import { test, expect } from "@playwright/test";
import { classify } from "@sentinel/ai";
import type {
  TelemetryEvent,
  LocatorResolvedEvent,
  AssertionEvent,
  RetryEvent,
  BusinessFailureEvent,
  SystemFailureEvent,
  FlowFinishedEvent,
} from "@sentinel/core";
import { TELEMETRY_SCHEMA_VERSION } from "@sentinel/core";

let seq = 0;
const base = <T extends TelemetryEvent["type"]>(type: T, name: string) => ({
  schemaVersion: TELEMETRY_SCHEMA_VERSION,
  eventId: `evt-${type}-${++seq}`,
  type,
  traceId: "run-1",
  spanId: `span-${seq}`,
  sequence: seq,
  name,
  timing: { startWallClockMs: seq, startMonotonicNs: BigInt(seq) },
});

const locatorResolved = (
  o: Partial<LocatorResolvedEvent> & { logicalName: string },
): LocatorResolvedEvent => ({
  ...base("locator.resolved", o.logicalName),
  logicalName: o.logicalName,
  resolvedKind: o.resolvedKind ?? "css",
  resolvedRank: o.resolvedRank ?? 0,
  degraded: o.degraded ?? false,
  candidates: o.candidates ?? [],
  score: o.score ?? 1,
  resolveDurationMs: o.resolveDurationMs ?? 1,
  ...o,
});

const assertion = (o: Partial<AssertionEvent>): AssertionEvent => ({
  ...base("assertion", o.name ?? "assert"),
  state: o.state ?? "visible",
  matched: o.matched ?? true,
  locatorRank: o.locatorRank ?? 0,
  ...o,
});

const retry = (o: Partial<RetryEvent>): RetryEvent => ({
  ...base("retry", o.name ?? "retry"),
  attempt: o.attempt ?? 1,
  maxAttempts: o.maxAttempts ?? 3,
  reason: o.reason ?? "transient",
  previousOutcome: o.previousOutcome ?? "timeout",
  ...o,
});

const businessFailure = (
  o: Partial<BusinessFailureEvent> & { domainReason: string },
): BusinessFailureEvent => ({
  ...base("business.failure", o.name ?? "business"),
  status: "ok",
  domainReason: o.domainReason,
  ...o,
});

const systemFailure = (
  o: Partial<SystemFailureEvent> & {
    errorKind: SystemFailureEvent["errorKind"];
  },
): SystemFailureEvent => ({
  ...base("system.failure", o.name ?? "system"),
  status: "error",
  errorKind: o.errorKind,
  message: o.message ?? "boom",
  retryable: o.retryable ?? false,
  artifactRefs: o.artifactRefs ?? [],
  ...o,
});

const flowFinished = (
  o: Partial<FlowFinishedEvent> & { outcome: FlowFinishedEvent["outcome"] },
): FlowFinishedEvent => ({
  ...base("flow.finished", o.name ?? "flow"),
  outcome: o.outcome,
  didDegrade: o.didDegrade ?? false,
  ...o,
});

test("classify: silent selector-drift on a passing run is surfaced (healthy + drift)", () => {
  const drifted = locatorResolved({
    logicalName: "auth.login.username",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const events: TelemetryEvent[] = [
    drifted,
    flowFinished({ outcome: "success", didDegrade: true }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("success");
  expect(c.degraded).toBe(true);
  const drift = c.verdicts.find((v) => v.kind === "selector-drift");
  expect(drift).toBeDefined();
  expect(drift?.confidence).toBe(0.9);
  expect(drift?.source).toBe("rule");
  expect(drift?.logicalName).toBe("auth.login.username");
  expect(drift?.evidence[0]?.eventId).toBe(drifted.eventId);
  // healthy coexists with the drift warning on a passing degraded run
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(true);
});

test("classify: selector-not-found system failure is selector-drift", () => {
  const fail = systemFailure({
    name: "auth.login.username",
    errorKind: "selector-not-found",
    message: "no element matched durable locator",
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const drift = c.verdicts.find((v) => v.kind === "selector-drift");
  expect(drift).toBeDefined();
  expect(drift?.confidence).toBe(0.9);
  expect(drift?.source).toBe("rule");
  expect(drift?.logicalName).toBe("auth.login.username");
  expect(drift?.evidence[0]?.eventId).toBe(fail.eventId);
  // a not-found drift must NOT be double-classified as infra-flake/real-bug
  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
  expect(c.verdicts.some((v) => v.kind === "infra-flake")).toBe(false);
});

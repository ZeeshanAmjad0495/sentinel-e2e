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

test("classify: rank-0 assertion mismatch with no prior retry is real-bug", () => {
  const a = assertion({
    name: "dashboard.greeting",
    spanId: "span-assert",
    matched: false,
    locatorRank: 0,
    state: "visible",
  });
  const events: TelemetryEvent[] = [
    a,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const bug = c.verdicts.find((v) => v.kind === "real-bug");
  expect(bug).toBeDefined();
  expect(bug?.confidence).toBe(0.85);
  expect(bug?.source).toBe("rule");
  expect(bug?.evidence[0]?.eventId).toBe(a.eventId);
});

test("classify: a preceding retry on the same span suppresses real-bug", () => {
  const r = retry({ spanId: "span-X", previousOutcome: "assertionFailed" });
  const a = assertion({
    name: "dashboard.greeting",
    spanId: "span-X",
    matched: false,
    locatorRank: 0,
  });
  const events: TelemetryEvent[] = [
    r,
    a,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
});

test("classify: timeout whose branchProgress is attached-not-visible is real-bug", () => {
  const a = assertion({
    name: "dashboard.firstOf",
    spanId: "span-firstOf",
    matched: false,
    locatorRank: 1, // not a rank-0 mismatch; the signal is branchProgress
    state: "visible",
    branchProgress: [
      { label: "success", reachedState: "attached", resolvedRank: 0 },
      { label: "error", reachedState: "none", resolvedRank: null },
    ],
  });
  const fail = systemFailure({
    name: "dashboard.firstOf",
    spanId: "span-firstOf",
    errorKind: "timeout",
    retryable: true,
    message: "race timed out",
  });
  const events: TelemetryEvent[] = [
    a,
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const bug = c.verdicts.find((v) => v.kind === "real-bug");
  expect(bug).toBeDefined();
  expect(bug?.confidence).toBe(0.85);
  expect(bug?.evidence[0]?.eventId).toBe(fail.eventId);
  // the attached-not-visible timeout is a real-bug, never an infra-flake
  expect(c.verdicts.some((v) => v.kind === "infra-flake")).toBe(false);
});

test("classify: retry-then-pass is infra-flake", () => {
  const r = retry({
    name: "loginForm.submit",
    spanId: "span-submit",
    previousOutcome: "timeout",
  });
  const events: TelemetryEvent[] = [r, flowFinished({ outcome: "success" })];

  const c = classify(events);

  const flake = c.verdicts.find((v) => v.kind === "infra-flake");
  expect(flake).toBeDefined();
  expect(flake?.confidence).toBe(0.8);
  expect(flake?.source).toBe("rule");
  expect(flake?.evidence[0]?.eventId).toBe(r.eventId);
});

test("classify: retryable timeout (not a rank-0 mismatch) is infra-flake", () => {
  const fail = systemFailure({
    name: "loginForm.submit",
    spanId: "span-submit",
    errorKind: "timeout",
    retryable: true,
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  const flake = c.verdicts.find((v) => v.kind === "infra-flake");
  expect(flake).toBeDefined();
  expect(flake?.confidence).toBe(0.8);
  expect(flake?.evidence[0]?.eventId).toBe(fail.eventId);
  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(false);
});

test("classify: rank-0 assertion mismatch + retryable timeout on same span is real-bug, not infra-flake", () => {
  const span = "span-collision";
  const a = assertion({
    name: "dashboard.greeting",
    spanId: span,
    matched: false,
    locatorRank: 0,
    state: "visible",
  });
  const fail = systemFailure({
    name: "dashboard.greeting",
    spanId: span,
    errorKind: "timeout",
    retryable: true,
  });
  const events: TelemetryEvent[] = [
    a,
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  expect(c.verdicts.some((v) => v.kind === "real-bug")).toBe(true);
  expect(c.verdicts.some((v) => v.kind === "infra-flake")).toBe(false);
});

test("classify: business.failure is business-outcome carrying domainReason", () => {
  const bf = businessFailure({
    name: "auth.login",
    domainReason: "INVALID_CREDENTIALS",
  });
  const events: TelemetryEvent[] = [
    bf,
    flowFinished({
      outcome: "business-failure",
      terminalReason: "INVALID_CREDENTIALS",
    }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("business-failure");
  const bo = c.verdicts.find((v) => v.kind === "business-outcome");
  expect(bo).toBeDefined();
  expect(bo?.confidence).toBe(1.0);
  expect(bo?.source).toBe("rule");
  expect(bo?.evidence[0]?.eventId).toBe(bf.eventId);
  expect(bo?.evidence[0]?.fields?.domainReason).toBe("INVALID_CREDENTIALS");
  // a business outcome is not a defect, but it is also not "healthy"
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(false);
});

test("classify: assertion-infrastructure failure is indeterminate (for the LLM)", () => {
  const fail = systemFailure({
    name: "loginForm.submit",
    errorKind: "assertion-infrastructure",
    retryable: false,
    message: "driver returned an unexpected null handle",
  });
  const events: TelemetryEvent[] = [
    fail,
    flowFinished({ outcome: "system-failure" }),
  ];

  const c = classify(events);

  expect(c.verdicts.length).toBe(0);
  expect(c.indeterminate.length).toBe(1);
  const ind = c.indeterminate[0];
  expect(ind?.kind).toBe("indeterminate");
  expect(ind?.confidence).toBe(0);
  expect(ind?.source).toBe("rule");
  expect(ind?.evidence[0]?.eventId).toBe(fail.eventId);
});

test("classify: clean success with no degradation is purely healthy", () => {
  const events: TelemetryEvent[] = [
    locatorResolved({ logicalName: "auth.login.username", resolvedRank: 0 }),
    assertion({ name: "dashboard.greeting", matched: true, locatorRank: 0 }),
    flowFinished({ outcome: "success", didDegrade: false }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("success");
  expect(c.degraded).toBe(false);
  expect(c.verdicts.map((v) => v.kind)).toEqual(["healthy"]);
  expect(c.verdicts[0]?.confidence).toBe(1.0);
  expect(c.indeterminate.length).toBe(0);
});

test("classify: auth-invalid run yields business-outcome + two drift verdicts", () => {
  const u = locatorResolved({
    logicalName: "auth.login.username",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const p = locatorResolved({
    logicalName: "auth.login.password",
    resolvedKind: "css",
    resolvedRank: 6,
    degraded: true,
    candidates: [
      { kind: "label", outcome: "missed", rank: 0 },
      { kind: "css", outcome: "matched", rank: 6 },
    ],
  });
  const bf = businessFailure({
    name: "auth.login",
    domainReason: "INVALID_CREDENTIALS",
  });
  const events: TelemetryEvent[] = [
    u,
    p,
    bf,
    flowFinished({
      outcome: "business-failure",
      terminalReason: "INVALID_CREDENTIALS",
      didDegrade: true,
    }),
  ];

  const c = classify(events);

  expect(c.outcome).toBe("business-failure");
  expect(c.degraded).toBe(true);
  const kinds = c.verdicts.map((v) => v.kind).sort();
  expect(kinds).toEqual([
    "business-outcome",
    "selector-drift",
    "selector-drift",
  ]);
  const driftNames = c.verdicts
    .filter((v) => v.kind === "selector-drift")
    .map((v) => v.logicalName)
    .sort();
  expect(driftNames).toEqual(["auth.login.password", "auth.login.username"]);
  expect(c.verdicts.some((v) => v.kind === "healthy")).toBe(false);
  expect(c.indeterminate.length).toBe(0);
});

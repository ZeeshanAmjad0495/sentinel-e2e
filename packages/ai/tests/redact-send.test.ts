import { test, expect } from "@playwright/test";
import type { TelemetryEvent } from "@sentinele2e/core";
import { analyzeRun } from "@sentinele2e/ai/analyze";
import type {
  AnalysisContext,
  LlmProvider,
  LlmRunResult,
} from "@sentinele2e/ai/llm/provider";

/** A spy provider: records the context it was handed, returns a canned result. */
class SpyLlmProvider implements LlmProvider {
  public seen: readonly TelemetryEvent[] = [];
  public ctx: AnalysisContext | null = null;
  analyze(ctx: AnalysisContext): Promise<LlmRunResult> {
    this.seen = ctx.events;
    this.ctx = ctx;
    return Promise.resolve({ explanation: "spy", adjudications: [] });
  }
}

const PLANTED_SECRET = "super-secret-bearer-value";

function eventsWithPlantedSecret(): TelemetryEvent[] {
  const base = {
    schemaVersion: "1.0.0",
    traceId: "run-redact-1",
    spanId: "span-1",
    name: "auth.login",
    timing: { startWallClockMs: 1, startMonotonicNs: "1" },
  };
  return [
    {
      ...base,
      eventId: "ev-1",
      type: "locator.resolved",
      sequence: 1,
      logicalName: "auth.login.username",
      resolvedKind: "css",
      resolvedRank: 0,
      degraded: false,
      candidates: [{ kind: "css", outcome: "matched", rank: 0 }],
      score: 1,
      resolveDurationMs: 5,
      // planted secret lives on the redactable `attributes` map by KEY
      attributes: { authorization: PLANTED_SECRET, ok: "plain" },
    },
    {
      ...base,
      eventId: "ev-2",
      type: "flow.finished",
      sequence: 2,
      outcome: "success",
      didDegrade: false,
    },
  ] as unknown as TelemetryEvent[];
}

test("orchestrator redacts events before handing them to the provider", async () => {
  const spy = new SpyLlmProvider();

  await analyzeRun(eventsWithPlantedSecret(), {
    provider: spy,
    explain: true,
  });

  const serialized = JSON.stringify(spy.seen);
  expect(serialized).not.toContain(PLANTED_SECRET);
  expect(serialized).toContain("[redacted]");
});

const PLANTED_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWFrIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

/**
 * An indeterminate run whose `system.failure.message` carries a JWT. The classifier
 * embeds `message` into the evidence `detail` (rules.failureEvidence), so this proves
 * BOTH the value-shape redaction AND that the ctx.classification is built from
 * redacted events.
 */
function eventsWithSecretInFailureMessage(): TelemetryEvent[] {
  const base = {
    schemaVersion: "1.0.0",
    traceId: "run-redact-2",
    spanId: "span-1",
    timing: { startWallClockMs: 1, startMonotonicNs: "1" },
  };
  return [
    {
      ...base,
      eventId: "ev-1",
      type: "system.failure",
      sequence: 1,
      name: "auth.login.submit",
      status: "error",
      errorKind: "assertion-infrastructure",
      message: `selector engine crashed; leaked token=${PLANTED_JWT}`,
      retryable: false,
      artifactRefs: [],
    },
    {
      ...base,
      eventId: "ev-2",
      type: "flow.finished",
      sequence: 2,
      name: "auth.login",
      status: "error",
      outcome: "system-failure",
      didDegrade: false,
    },
  ] as unknown as TelemetryEvent[];
}

test("orchestrator routes classification through redaction before sending", async () => {
  const spy = new SpyLlmProvider();

  await analyzeRun(eventsWithSecretInFailureMessage(), {
    provider: spy,
    explain: true,
  });

  // ctx.events: the planted JWT in the failure message is scrubbed.
  const eventsSerialized = JSON.stringify(spy.ctx?.events);
  expect(eventsSerialized).not.toContain("eyJhbGci");
  expect(eventsSerialized).toContain("[redacted]");

  // ctx.classification: evidence detail strings (which embed message) are scrubbed.
  const allDetails = [
    ...(spy.ctx?.classification.verdicts ?? []),
    ...(spy.ctx?.classification.indeterminate ?? []),
  ].flatMap((v) => v.evidence.map((e) => e.detail));

  expect(allDetails.length).toBeGreaterThan(0);
  const detailBlob = allDetails.join("\n");
  expect(detailBlob).not.toContain("eyJhbGci");
  expect(detailBlob).toContain("[redacted]");
});

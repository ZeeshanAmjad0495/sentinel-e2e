import { test, expect } from "@playwright/test";
import type { TelemetryEvent } from "@sentinel/core";
import { analyzeRun } from "@sentinel/ai/analyze";
import type {
  AnalysisContext,
  LlmProvider,
  LlmRunResult,
} from "@sentinel/ai/llm/provider";

/** A spy provider: records the events it was handed, returns a canned result. */
class SpyLlmProvider implements LlmProvider {
  public seen: readonly TelemetryEvent[] = [];
  analyze(ctx: AnalysisContext): Promise<LlmRunResult> {
    this.seen = ctx.events;
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

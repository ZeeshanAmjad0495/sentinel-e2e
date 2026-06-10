// packages/driver-playwright/src/resolver.ts
import type { Page } from "@playwright/test";
import type {
  Locator,
  LocatorStrategy,
  StrategyKind,
} from "@sentinel/contracts";
import type {
  LocatorResolution,
  LocatorResolver,
  TelemetrySink,
} from "@sentinel/core";
import {
  SelectorAmbiguousError,
  SelectorNotFoundError,
  StrategyRegistry,
} from "@sentinel/core";
import { PlaywrightElementHandle } from "./element";
import { compileStrategy } from "./strategy-compiler";

interface ResolverContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

type CandidateOutcome = "matched" | "missed" | "skipped";
interface CandidateRecord {
  readonly kind: StrategyKind;
  readonly outcome: CandidateOutcome;
  readonly rank: number;
}

export class PlaywrightResolver implements LocatorResolver {
  constructor(
    private readonly page: Page,
    private readonly strategies: ReadonlySet<StrategyKind>,
    private readonly sink: TelemetrySink,
    private readonly ctx: ResolverContext,
    // S2 exports the StrategyRegistry pre-seeded with the §7 rank table in its
    // constructor (role=0 … css/xpath=6); the plan's `defaultStrategyRegistry`
    // export does not exist, so default to a fresh instance per its Task-3 note.
    private readonly registry: StrategyRegistry = new StrategyRegistry(),
  ) {}

  async resolve(locator: Locator): Promise<LocatorResolution> {
    const start = process.hrtime.bigint();
    const records: CandidateRecord[] = [];
    let winner: { strategy: LocatorStrategy; rank: number } | null = null;

    for (const candidate of locator.candidates) {
      const rank = this.registry.rankOf(candidate.kind);

      if (!this.strategies.has(candidate.kind)) {
        records.push({ kind: candidate.kind, outcome: "skipped", rank });
        continue;
      }

      const count = await compileStrategy(this.page, candidate).count();
      if (count === 0) {
        records.push({ kind: candidate.kind, outcome: "missed", rank });
        continue;
      }
      if (count > 1) {
        this.throwAmbiguous(locator, candidate, count, records);
      }

      records.push({ kind: candidate.kind, outcome: "matched", rank });
      winner = { strategy: candidate, rank };
      break;
    }

    if (winner === null) {
      throw new SelectorNotFoundError(
        `No supported candidate resolved for "${locator.logicalName}"`,
        {
          correlationId: this.ctx.correlationId,
          flowName: this.ctx.flowName,
          startedAt: this.ctx.startedAt,
          durationMs: Number(process.hrtime.bigint() - start) / 1e6,
          logicalName: locator.logicalName,
          attempted: records
            .filter((r) => r.outcome !== "skipped")
            .map((r) => ({
              strategy: r.kind,
              matched: r.outcome === "matched",
              rank: r.rank,
            })),
        },
      );
    }

    const resolveDurationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const degraded = winner.rank > 0;

    // EMIT BEFORE returning the handle (spec §6/§7 obligation a).
    this.sink.emit({
      schemaVersion: "1.0.0",
      eventId: cryptoRandom(),
      type: "locator.resolved",
      traceId: this.ctx.correlationId,
      spanId: cryptoRandom(),
      sequence: 0,
      name: locator.logicalName,
      timing: {
        startWallClockMs: this.ctx.startedAt,
        startMonotonicNs: start,
        endMonotonicNs: process.hrtime.bigint(),
        durationMs: resolveDurationMs,
      },
      logicalName: locator.logicalName,
      resolvedKind: winner.strategy.kind,
      resolvedRank: winner.rank,
      degraded,
      candidates: records,
      score: 1.0,
      resolveDurationMs,
    });

    return {
      handle: new PlaywrightElementHandle(this.page, locator, winner.strategy),
      resolvedKind: winner.strategy.kind,
      resolvedRank: winner.rank,
      degraded,
      score: 1.0,
    };
  }

  private throwAmbiguous(
    locator: Locator,
    candidate: LocatorStrategy,
    count: number,
    records: CandidateRecord[],
  ): never {
    throw new SelectorAmbiguousError(
      `"${locator.logicalName}" matched ${count} elements via ${candidate.kind}`,
      {
        correlationId: this.ctx.correlationId,
        flowName: this.ctx.flowName,
        startedAt: this.ctx.startedAt,
        durationMs: 0,
        logicalName: locator.logicalName,
        attempted: [
          ...records.map((r) => ({
            strategy: r.kind,
            matched: r.outcome === "matched",
            rank: r.rank,
          })),
          {
            strategy: candidate.kind,
            matched: true,
            rank: this.registry.rankOf(candidate.kind),
          },
        ],
      },
    );
  }
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}

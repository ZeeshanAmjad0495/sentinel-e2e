// packages/driver-selenium/src/resolver.ts
import type { WebDriver } from "selenium-webdriver";
import type {
  Locator,
  LocatorStrategy,
  StrategyKind,
} from "@sentinele2e/contracts";
import type {
  LocatorResolution,
  LocatorResolver,
  TelemetrySink,
} from "@sentinele2e/core";
import {
  SelectorAmbiguousError,
  SelectorNotFoundError,
  StrategyRegistry,
} from "@sentinele2e/core";
import { SeleniumElementHandle } from "./element";
import { compileStrategy, toBy } from "./strategy-compiler";

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

export class SeleniumResolver implements LocatorResolver {
  constructor(
    private readonly driver: WebDriver,
    private readonly strategies: ReadonlySet<StrategyKind>,
    private readonly sink: TelemetrySink,
    private readonly ctx: ResolverContext,
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

      // findElements returns [] (never throws) — the ideal poll primitive.
      const count = (
        await this.driver.findElements(toBy(compileStrategy(candidate)))
      ).length;
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
    // Drift = a more-durable candidate the driver TRIED was MISSED (skipped != degraded).
    const degraded = records.some(
      (r) => r.outcome === "missed" && r.rank < winner.rank,
    );

    // EMIT BEFORE returning the handle (spec §5.3 obligation; schema-identical to Playwright).
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
      handle: new SeleniumElementHandle(this.driver, locator, winner.strategy),
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

// packages/core/src/telemetry/timers.ts
import type { Timing } from "./event";

export type HrClock = () => bigint;

const defaultClock: HrClock = () => process.hrtime.bigint();

/** ns delta -> fractional milliseconds (duration source of truth is the monotonic clock). */
export const durationMsFromNs = (deltaNs: bigint): number =>
  Number(deltaNs) / 1_000_000;

export interface Timer {
  readonly startMonotonicNs: bigint;
  readonly startWallClockMs: number;
  finish(): Timing;
}

export const startTimer = (clock: HrClock = defaultClock): Timer => {
  const startMonotonicNs = clock();
  const startWallClockMs = Date.now();
  return {
    startMonotonicNs,
    startWallClockMs,
    finish(): Timing {
      const endMonotonicNs = clock();
      return {
        startWallClockMs,
        startMonotonicNs,
        endMonotonicNs,
        durationMs: durationMsFromNs(endMonotonicNs - startMonotonicNs),
      };
    },
  };
};

// packages/core/tests/timers.test.ts
import { test, expect } from "@playwright/test";
import { startTimer, durationMsFromNs, type Timer } from "@sentinele2e/core";

test("durationMsFromNs converts a ns delta to fractional ms", () => {
  expect(durationMsFromNs(1_000_000n)).toBe(1);
  expect(durationMsFromNs(1_500_000n)).toBeCloseTo(1.5, 6);
  expect(durationMsFromNs(0n)).toBe(0);
});

test("startTimer().finish derives durationMs from an injected hrtime clock", () => {
  let now = 5_000_000n;
  const clock = () => now;
  const timer: Timer = startTimer(clock);
  now = 8_500_000n; // +3.5ms elapsed
  const timing = timer.finish();
  expect(timing.startMonotonicNs).toBe(5_000_000n);
  expect(timing.endMonotonicNs).toBe(8_500_000n);
  expect(timing.durationMs).toBeCloseTo(3.5, 6);
  expect(typeof timing.startWallClockMs).toBe("number");
});

test("startTimer with the default clock yields a non-negative duration", () => {
  const timing = startTimer().finish();
  expect(timing.durationMs!).toBeGreaterThanOrEqual(0);
});

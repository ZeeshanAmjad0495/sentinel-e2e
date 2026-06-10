// packages/ai/tests/load.test.ts
import { test, expect } from "@playwright/test";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { loadEvents } from "@sentinel/ai";

const line = (name: string, seq: number): string =>
  JSON.stringify({
    schemaVersion: "1.0.0",
    eventId: randomUUID(),
    type: "component.action",
    traceId: "run-1",
    spanId: "s",
    sequence: seq,
    name,
    // bigint timing arrives as JSONL decimal strings; loadEvents keeps them as strings.
    timing: {
      startWallClockMs: 1,
      startMonotonicNs: "5000000",
      endMonotonicNs: "6000000",
      durationMs: 1,
    },
  });

const withTmpFile = (contents: string, fn: (path: string) => void): void => {
  const filePath = join(tmpdir(), `sentinel-ai-load-${randomUUID()}.jsonl`);
  try {
    writeFileSync(filePath, contents, "utf8");
    fn(filePath);
  } finally {
    if (existsSync(filePath)) rmSync(filePath);
  }
};

test("loadEvents parses a valid 2-line JSONL string into ordered events", () => {
  withTmpFile(`${line("first", 0)}\n${line("second", 1)}\n`, (path) => {
    const events = loadEvents(path);
    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe("first");
    expect(events[1]?.name).toBe("second");
    // timing ns fields are KEPT as their JSONL string form (no bigint revive).
    expect(events[0]?.timing.startMonotonicNs).toBe("5000000");
    expect(typeof events[0]?.timing.startMonotonicNs).toBe("string");
  });
});

test("loadEvents skips a malformed line with a console.warn", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    withTmpFile(
      `${line("first", 0)}\nthis-is-not-json\n${line("third", 2)}\n`,
      (path) => {
        const events = loadEvents(path);
        expect(events).toHaveLength(2);
        expect(events.map((e) => e.name)).toEqual(["first", "third"]);
      },
    );
    expect(warnings.some((w) => /malformed|skip/i.test(w))).toBe(true);
  } finally {
    console.warn = original;
  }
});

test("loadEvents throws when no valid events are present", () => {
  withTmpFile("\n   \nnot-json\n", (path) => {
    expect(() => loadEvents(path)).toThrow(/no valid telemetry events/i);
  });
});

test("loadEvents warns on an unknown schemaVersion major but returns the event", () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    const skewed = JSON.stringify({
      schemaVersion: "9.0.0",
      eventId: randomUUID(),
      type: "component.action",
      traceId: "run-1",
      spanId: "s",
      sequence: 0,
      name: "future",
      timing: { startWallClockMs: 1, startMonotonicNs: "1" },
    });
    withTmpFile(`${skewed}\n`, (path) => {
      const events = loadEvents(path); // best-effort, no throw
      expect(events).toHaveLength(1);
      expect(events[0]?.name).toBe("future");
    });
    expect(warnings.some((w) => /schemaVersion|skew|unknown/i.test(w))).toBe(
      true,
    );
  } finally {
    console.warn = original;
  }
});

test("loadEvents accepts an in-memory event array unchanged", () => {
  withTmpFile(`${line("first", 0)}\n`, (path) => {
    const [evt] = loadEvents(path);
    const events = loadEvents([evt!]);
    expect(events).toHaveLength(1);
    expect(events[0]?.name).toBe("first");
  });
});

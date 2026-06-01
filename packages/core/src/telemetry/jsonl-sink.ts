// packages/core/src/telemetry/jsonl-sink.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TelemetrySink } from "./sink";
import type { TelemetryEvent } from "./signals";

export interface JsonlSinkOptions {
  readonly filePath: string;
}

/** Stringifies bigint timing fields; JSON.stringify throws on bigint otherwise. */
const bigintReplacer = (_k: string, v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : v;

export class JsonlSink implements TelemetrySink {
  private readonly filePath: string;
  private dirEnsured = false;

  constructor(options: JsonlSinkOptions) {
    this.filePath = options.filePath;
  }

  emit(event: TelemetryEvent): void {
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        this.dirEnsured = true;
      }
      appendFileSync(
        this.filePath,
        `${JSON.stringify(event, bigintReplacer)}\n`,
      );
    } catch (err) {
      // Telemetry must never fail a run: best-effort warn, never throw.
      console.warn(`JsonlSink write failed for ${this.filePath}:`, err);
    }
  }

  child(_name: string): TelemetrySink {
    // Shares the same file path; span naming is carried on the event envelope.
    return this;
  }
}

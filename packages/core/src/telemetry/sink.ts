// packages/core/src/telemetry/sink.ts
import { randomUUID } from "node:crypto";
import type { TelemetryEvent } from "./signals";

export interface TelemetrySink {
  emit(event: TelemetryEvent): void; // sync, non-throwing; never breaks the run
  child(name: string): TelemetrySink; // opens a nested span (run -> flow -> action)
}

/** Single per-run context: owns the monotonic sequence, mints span ids, threads parentSpanId. */
export class SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  private readonly counter: { value: number };

  constructor(traceId: string, parent?: SpanContext) {
    this.traceId = traceId;
    this.spanId = randomUUID();
    this.parentSpanId = parent?.spanId;
    // The sequence counter is shared across the whole run, not per span.
    this.counter = parent ? parent.counter : { value: 0 };
  }

  nextSequence(): number {
    const next = this.counter.value;
    this.counter.value += 1;
    return next;
  }

  child(): SpanContext {
    return new SpanContext(this.traceId, this);
  }
}

/** Pure recorder: stores events verbatim in append order. Stamping (traceId/spanId/
 *  sequence) is owned upstream by StampingSink — sinks never own counters (spec §6). */
export class InMemorySink implements TelemetrySink {
  readonly events: TelemetryEvent[];

  constructor(events: TelemetryEvent[] = []) {
    this.events = events;
  }

  emit(event: TelemetryEvent): void {
    this.events.push(event);
  }

  child(_name: string): TelemetrySink {
    // child shares the SAME backing array (one flat event log per run)
    return new InMemorySink(this.events);
  }
}

/** The ONE place stamping happens: applies the run's traceId/spanId/parentSpanId and the
 *  monotonic sequence from a single shared SpanContext, then delegates to the inner sink.
 *  Stamping BEFORE fan-out means every downstream sink (InMemory, Jsonl) sees identical
 *  events — so the in-memory log and the on-disk JSONL never diverge. */
export class StampingSink implements TelemetrySink {
  constructor(
    private readonly span: SpanContext,
    private readonly inner: TelemetrySink,
  ) {}

  emit(event: TelemetryEvent): void {
    this.inner.emit({
      ...event,
      traceId: this.span.traceId,
      spanId: this.span.spanId,
      ...(this.span.parentSpanId !== undefined
        ? { parentSpanId: this.span.parentSpanId }
        : {}),
      sequence: this.span.nextSequence(),
    });
  }

  child(name: string): TelemetrySink {
    return new StampingSink(this.span.child(), this.inner.child(name));
  }
}

export class NoopSink implements TelemetrySink {
  emit(): void {}
  child(): this {
    return this;
  }
}

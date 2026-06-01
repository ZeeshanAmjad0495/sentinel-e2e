// packages/core/src/errors/system-failure-error.ts
import type {
  Capability,
  StrategyKind,
  BranchProgress,
} from "@sentinel/contracts";

export type SystemFailureKind =
  | "timeout"
  | "selector-not-found"
  | "selector-ambiguous"
  | "driver-session"
  | "assertion-infrastructure"
  | "capability-unsupported";

export interface Artifact {
  readonly kind:
    | "screenshot"
    | "dom-snapshot"
    | "a11y-snapshot"
    | "trace"
    | "console-log"
    | "har";
  readonly ref?: string;
  readonly inline?: string;
}

export interface SystemFailureContext {
  readonly correlationId: string; // SAME id as ResultMeta + every telemetry event
  readonly flowName: string;
  readonly startedAt: number;
  readonly durationMs: number; // elapsed before failure
  readonly artifacts?: readonly Artifact[];
  readonly logicalName?: string; // for selector-* kinds: which element
  readonly attempted?: readonly {
    strategy: StrategyKind;
    matched: boolean;
    rank: number;
  }[];
  readonly branchProgress?: readonly BranchProgress[]; // for waitForFirstOf timeouts (disambiguation)
  readonly capability?: Capability; // for capability-unsupported
  readonly cause?: unknown; // raw driver error preserved
}

export abstract class SystemFailureError extends Error {
  abstract readonly kind: SystemFailureKind;
  abstract readonly retryable: boolean; // A-PRIORI flake HINT, not a verdict; analyzer refines via history
  constructor(
    message: string,
    readonly context: SystemFailureContext,
  ) {
    super(message);
    this.name = new.target.name;
    if (context.cause !== undefined)
      (this as { cause?: unknown }).cause = context.cause;
    Error.captureStackTrace?.(this, new.target);
  }
}

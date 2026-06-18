// packages/core/src/telemetry/signals.ts
import type {
  StrategyKind,
  ElementState,
  BranchProgress,
} from "@sentinele2e/contracts";
import type { Artifact, SystemFailureKind } from "../errors";
import type { TelemetryEnvelope } from "./event";

export interface LocatorResolvedEvent extends TelemetryEnvelope<"locator.resolved"> {
  logicalName: string;
  resolvedKind: StrategyKind;
  resolvedRank: number; // rank of the winning candidate (0 = most durable)
  degraded: boolean; // a more-durable candidate the driver TRIED was MISSED (skipped != degraded)
  candidates: readonly {
    kind: StrategyKind;
    outcome: "matched" | "missed" | "skipped";
    rank: number;
  }[];
  score: number;
  resolveDurationMs: number;
}
export interface AssertionEvent extends TelemetryEnvelope<"assertion"> {
  state: ElementState;
  matched: boolean;
  locatorRank: number; // matched:false && rank===0 && no prior retry => REAL-BUG
  branch?: string;
  branchProgress?: readonly BranchProgress[];
}
export interface RetryEvent extends TelemetryEnvelope<"retry"> {
  attempt: number;
  maxAttempts: number;
  reason: string;
  previousOutcome: "error" | "assertionFailed" | "timeout"; // retry-then-pass => INFRA-FLAKE
}
export interface BusinessFailureEvent extends TelemetryEnvelope<"business.failure"> {
  status: "ok"; // run mechanically succeeded; domain said no
  domainReason: string; // STABLE "INVALID_CREDENTIALS" — emitted independent of localized message
}
export interface SystemFailureEvent extends TelemetryEnvelope<"system.failure"> {
  status: "error";
  errorKind: SystemFailureKind;
  message: string;
  retryable: boolean;
  artifactRefs: readonly string[];
}
export interface ArtifactCapturedEvent extends TelemetryEnvelope<"artifact.captured"> {
  artifactKind: Artifact["kind"];
  ref: string;
  capturedOn: "systemFailure" | "degradedResolution"; // attachable to NON-failing drifted runs too
}
export interface FlowFinishedEvent extends TelemetryEnvelope<"flow.finished"> {
  outcome: "success" | "business-failure" | "system-failure";
  terminalReason?: string; // domainReason or SystemFailureKind
  didDegrade: boolean; // true iff any locator.resolved was `degraded` by the above rule
}

/** The emitted event surface: a typed signal OR a plain envelope for the simple event types. */
export type TelemetryEvent =
  | LocatorResolvedEvent
  | AssertionEvent
  | RetryEvent
  | BusinessFailureEvent
  | SystemFailureEvent
  | ArtifactCapturedEvent
  | FlowFinishedEvent
  | TelemetryEnvelope;

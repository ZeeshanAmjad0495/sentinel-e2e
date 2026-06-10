// packages/core/src/errors/kinds.ts
import {
  SystemFailureError,
  type SystemFailureKind,
} from "./system-failure-error";

export class TimeoutError extends SystemFailureError {
  readonly kind: SystemFailureKind = "timeout";
  readonly retryable = true;
}

export class SelectorNotFoundError extends SystemFailureError {
  readonly kind: SystemFailureKind = "selector-not-found";
  readonly retryable = false;
}

export class SelectorAmbiguousError extends SystemFailureError {
  readonly kind: SystemFailureKind = "selector-ambiguous";
  readonly retryable = false;
}

export class DriverSessionError extends SystemFailureError {
  readonly kind: SystemFailureKind = "driver-session";
  readonly retryable = true;
}

export class AssertionInfrastructureError extends SystemFailureError {
  readonly kind: SystemFailureKind = "assertion-infrastructure";
  readonly retryable = false;
}

export class CapabilityUnsupportedError extends SystemFailureError {
  readonly kind: SystemFailureKind = "capability-unsupported";
  readonly retryable = false;
}

export const isSystemFailure = (e: unknown): e is SystemFailureError =>
  e instanceof SystemFailureError;

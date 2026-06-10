// packages/core/src/errors/index.ts
export {
  SystemFailureError,
  type SystemFailureKind,
  type SystemFailureContext,
  type Artifact,
} from "./system-failure-error";
export {
  TimeoutError,
  SelectorNotFoundError,
  SelectorAmbiguousError,
  DriverSessionError,
  AssertionInfrastructureError,
  CapabilityUnsupportedError,
  isSystemFailure,
} from "./kinds";

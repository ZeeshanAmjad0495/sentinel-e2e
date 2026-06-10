// packages/core/src/result/index.ts
export type { ResultMeta, Success, BusinessFailure, Result } from "./result";
export { ok, businessFailure, isSuccess, assertNever } from "./factory";

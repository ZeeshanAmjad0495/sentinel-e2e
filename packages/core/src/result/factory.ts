// packages/core/src/result/factory.ts
import type { Result, Success, BusinessFailure, ResultMeta } from "./result";

export const ok = <T>(data: T, meta: ResultMeta): Success<T> => ({
  status: "success",
  data,
  meta,
});

export const businessFailure = <R extends string, D = unknown>(
  reason: R,
  meta: ResultMeta,
  opts?: { message?: string; details?: D },
): BusinessFailure<R, D> => ({
  status: "business-failure",
  reason,
  message: opts?.message,
  details: opts?.details,
  meta,
});

export const isSuccess = <T, R extends string, D>(
  r: Result<T, R, D>,
): r is Success<T> => r.status === "success";

export const assertNever = (x: never): never => {
  throw new Error(`Unhandled Result variant: ${JSON.stringify(x)}`);
};

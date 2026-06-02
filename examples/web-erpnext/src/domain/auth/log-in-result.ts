// examples/web-erpnext/src/domain/auth/log-in-result.ts
import type { Result } from "@sentinel/core";

export interface LoginSuccessData {
  readonly username: string;
  readonly finalUrl?: string;
}
export type LoginReason = "INVALID_CREDENTIALS"; // stable, language-independent
export interface LoginFailureDetails {
  readonly username: string;
  readonly finalUrl?: string;
}

export type LoginResult = Result<
  LoginSuccessData,
  LoginReason,
  LoginFailureDetails
>;

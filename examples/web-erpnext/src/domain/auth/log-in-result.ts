interface LoginResult {
  success: boolean;
  errorMessage?: string;
  durationMs: number;
  finalUrl: string;
  timestamp: number;
  username: string;
}

export default LoginResult;

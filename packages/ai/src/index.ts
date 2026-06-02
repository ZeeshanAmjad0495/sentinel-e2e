// packages/ai/src/index.ts
export type { VerdictKind, Verdict, Evidence } from "./verdict";
export type { RunOutcome, RunClassification, RunAnalysis } from "./analysis";
export { ANALYSIS_SCHEMA_VERSION } from "./analysis";
export { loadEvents } from "./load";
export { redactEvents } from "./redact";
export { classify } from "./classify";
export type {
  AnalysisContext,
  LlmAdjudication,
  LlmRunResult,
  LlmProvider,
} from "./llm/provider";
export { FakeLlmProvider } from "./llm/provider";
export type { AnalyzeOptions } from "./analyze";
export { analyzeRun } from "./analyze";
export { toJson, toText } from "./render";
// NOTE: ClaudeProvider is deliberately NOT re-exported here. It is the only
// importer of @anthropic-ai/sdk; keeping it out of the barrel keeps the SDK
// lazy (imported only when llm/claude-provider.ts is imported directly by the
// orchestrator's auto-resolution path).

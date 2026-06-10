// packages/ai/src/llm/index.ts
// SDK-free barrel: re-exports ONLY the provider interface + the test fake.
// claude-provider.ts is deliberately NOT re-exported so importing @sentinel/ai
// never pulls @anthropic-ai/sdk into the deterministic import path.
export type {
  AnalysisContext,
  LlmAdjudication,
  LlmRunResult,
  LlmProvider,
} from "./provider";
export { FakeLlmProvider } from "./provider";

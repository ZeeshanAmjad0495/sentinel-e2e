// packages/ai/src/llm/claude-provider.ts  (compile stub; B5 replaces this with the real @anthropic-ai/sdk provider)
import type { AnalysisContext, LlmProvider, LlmRunResult } from "./provider";

export class ClaudeProvider implements LlmProvider {
  analyze(_ctx: AnalysisContext): Promise<LlmRunResult> {
    throw new Error("ClaudeProvider not implemented until B5");
  }
}

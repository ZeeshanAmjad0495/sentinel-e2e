import { test, expect } from "@playwright/test";
import { ClaudeProvider, CLAUDE_MODEL } from "@sentinel/ai/llm/claude-provider";

test("ClaudeProvider pins claude-opus-4-8 and constructs from an explicit key", () => {
  expect(CLAUDE_MODEL).toBe("claude-opus-4-8");
  const provider = new ClaudeProvider({ apiKey: "test-key-not-used" });
  expect(provider).toBeInstanceOf(ClaudeProvider);
});

test("ClaudeProvider throws a clear error when no key is available", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    expect(() => new ClaudeProvider()).toThrow(/ANTHROPIC_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

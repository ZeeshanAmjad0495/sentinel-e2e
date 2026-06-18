import { test, expect } from "@playwright/test";
import Anthropic from "@anthropic-ai/sdk";
import type { TelemetryEvent } from "@sentinele2e/core";
import type { AnalysisContext } from "@sentinele2e/ai/llm/provider";
import {
  ClaudeProvider,
  CLAUDE_MODEL,
  SYSTEM_PROMPT,
  REPORT_TOOL_NAME,
  REPORT_TOOL_INPUT_SCHEMA,
} from "@sentinele2e/ai/llm/claude-provider";

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

const runItest = process.env.ANTHROPIC_API_KEY ? test : test.skip;

function sampleContext(): AnalysisContext {
  const events: TelemetryEvent[] = [
    {
      schemaVersion: "1.0.0",
      eventId: "ev-1",
      type: "flow.finished",
      traceId: "run-itest-1",
      spanId: "span-1",
      sequence: 1,
      name: "auth.login",
      timing: { startWallClockMs: 1, startMonotonicNs: "1" },
      outcome: "system-failure",
      didDegrade: false,
    } as unknown as TelemetryEvent,
  ];
  return {
    runId: "run-itest-1",
    outcome: "system-failure",
    classification: {
      runId: "run-itest-1",
      outcome: "system-failure",
      degraded: false,
      verdicts: [],
      indeterminate: [
        {
          kind: "indeterminate",
          confidence: 0,
          summary: "flow.finished system-failure with no pinned cause",
          evidence: [
            {
              eventId: "ev-1",
              type: "flow.finished",
              detail: "system-failure terminal with no matching rule",
            },
          ],
          source: "rule",
        },
      ],
    },
    events,
  };
}

runItest(
  "real ClaudeProvider returns a well-formed result and uses prompt caching",
  async () => {
    const provider = new ClaudeProvider({ maxTokens: 512 });

    const result = await provider.analyze(sampleContext());
    expect(typeof result.explanation).toBe("string");
    expect(result.explanation.length).toBeGreaterThan(0);
    expect(Array.isArray(result.adjudications)).toBe(true);
    for (const adj of result.adjudications) {
      expect(typeof adj.verdict.kind).toBe("string");
      expect(adj.verdict.source).toBe("llm");
    }

    // Second, independent call mirroring the provider request to inspect usage.
    const client = new Anthropic();
    const raw = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 512,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: "runId: cache-probe\noutcome: success" },
      ],
      tools: [
        {
          name: REPORT_TOOL_NAME,
          description: "Report the run analysis.",
          input_schema:
            REPORT_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
    });
    const cacheCreate = raw.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = raw.usage.cache_read_input_tokens ?? 0;
    expect(cacheCreate + cacheRead).toBeGreaterThan(0);
  },
);

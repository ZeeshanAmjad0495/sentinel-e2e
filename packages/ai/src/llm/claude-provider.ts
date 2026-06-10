import Anthropic from "@anthropic-ai/sdk";
import type {
  LlmProvider,
  AnalysisContext,
  LlmRunResult,
  LlmAdjudication,
} from "./provider";
import type { Verdict, VerdictKind } from "../verdict";

/** Locked model for the AI run-analyzer (spec D-3 / §5.2). */
export const CLAUDE_MODEL = "claude-opus-4-8" as const;

/** The forced structured-output tool name (spec §5.2). */
export const REPORT_TOOL_NAME = "report_run_analysis" as const;

export interface ClaudeProviderOptions {
  /** Falls back to process.env.ANTHROPIC_API_KEY when omitted. */
  readonly apiKey?: string;
  /** Cost ceiling for the single analysis call. */
  readonly maxTokens?: number;
}

/**
 * The static classification rubric + telemetry-event schema + output contract.
 * This is the large, STABLE prefix sent as a cached system block so repeated
 * runs reuse it (spec §5.2 — prompt caching mandatory). Keep this byte-stable:
 * no timestamps, no per-run data — those go in the user message.
 */
export const SYSTEM_PROMPT = `You are the Sentinel run-analyzer's explanation and adjudication layer.

A deterministic rule engine has ALREADY classified an end-to-end test run from its
structured telemetry. Your job is NOT to re-classify. Your job is to:
  1. Write a concise, plain-language explanation of what happened in the run,
     referencing the deterministic verdicts you are given.
  2. Adjudicate ONLY the verdicts the rules marked "indeterminate": assign each a
     concrete VerdictKind with a one-line reason grounded in the telemetry.
  3. NEVER override or contradict a high-confidence rule verdict.

VerdictKind values (use EXACTLY these strings):
  - "real-bug"          the app behaved wrong with a stable, most-durable locator.
  - "infra-flake"       transient failure: retry-then-pass, or a retryable timeout/session loss.
  - "selector-drift"    a locator degraded to a fallback, or was not-found / ambiguous.
  - "healthy"           success with no degradation.
  - "business-outcome"  an expected domain result (e.g. INVALID_CREDENTIALS) — NOT a defect.
  - "indeterminate"     only if you genuinely cannot adjudicate from the evidence.

Telemetry event types you may see (driver-agnostic; already REDACTED):
  - locator.resolved {logicalName, resolvedKind, resolvedRank, degraded, candidates[]}
      resolvedRank>0 or degraded:true => the durable locator missed and a fallback won.
  - assertion {state, matched, locatorRank, branchProgress[]}
      matched:false && locatorRank===0 && no prior retry => a real defect signal.
  - retry {attempt, maxAttempts, reason, previousOutcome}
  - business.failure {domainReason}   the run mechanically succeeded; the domain said no.
  - system.failure {errorKind, message, retryable, artifactRefs[]}
  - flow.finished {outcome, terminalReason, didDegrade}

Output contract: you MUST call the tool "report_run_analysis" exactly once. Do not
write free-text JSON. Provide:
  - explanation: a short paragraph (no markdown headers).
  - adjudications: one entry per INDETERMINATE verdict you resolved, each with the
    matching logicalName and/or eventId and a verdict object whose kind is one of the
    VerdictKind strings above, a confidence in [0,1], a one-line summary, and an
    evidence array. Return an empty adjudications array if there were none.`;

/** JSON Schema for the forced tool input — mirrors LlmRunResult (spec §5.1). */
export const REPORT_TOOL_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["explanation", "adjudications"],
  properties: {
    explanation: { type: "string" },
    adjudications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["verdict"],
        properties: {
          logicalName: { type: "string" },
          eventId: { type: "string" },
          verdict: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "confidence", "summary", "evidence"],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "real-bug",
                  "infra-flake",
                  "selector-drift",
                  "healthy",
                  "business-outcome",
                  "indeterminate",
                ],
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              summary: { type: "string" },
              logicalName: { type: "string" },
              evidence: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["eventId", "type", "detail"],
                  properties: {
                    eventId: { type: "string" },
                    type: { type: "string" },
                    detail: { type: "string" },
                    fields: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export class ClaudeProvider implements LlmProvider {
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: ClaudeProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new Error(
        "ClaudeProvider requires an ANTHROPIC_API_KEY (pass apiKey or set the env var).",
      );
    }
    this.client = new Anthropic({ apiKey });
    this.maxTokens = options.maxTokens ?? 1024;
  }

  async analyze(ctx: AnalysisContext): Promise<LlmRunResult> {
    const response = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: this.maxTokens,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: buildUserMessage(ctx) }],
      tools: [
        {
          name: REPORT_TOOL_NAME,
          description:
            "Report the plain-language run explanation and adjudications for the indeterminate verdicts.",
          input_schema:
            REPORT_TOOL_INPUT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: REPORT_TOOL_NAME },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === REPORT_TOOL_NAME,
    );
    if (toolUse === undefined) {
      throw new Error(
        `ClaudeProvider: model did not call ${REPORT_TOOL_NAME} (stop_reason=${response.stop_reason}).`,
      );
    }
    return parseToolInput(toolUse.input);
  }
}

/** Build the small, VARIABLE per-run user message (after the cached prefix). */
function buildUserMessage(ctx: AnalysisContext): string {
  return [
    `runId: ${ctx.runId}`,
    `outcome: ${ctx.outcome}`,
    "deterministic classification (verdicts the rules already decided):",
    JSON.stringify(ctx.classification.verdicts),
    "indeterminate verdicts to adjudicate:",
    JSON.stringify(ctx.classification.indeterminate),
    "redacted telemetry events:",
    JSON.stringify(ctx.events),
  ].join("\n");
}

const VERDICT_KINDS: readonly VerdictKind[] = [
  "real-bug",
  "infra-flake",
  "selector-drift",
  "healthy",
  "business-outcome",
  "indeterminate",
];

/** Parse + validate the tool input into an LlmRunResult; stamp source:"llm". */
function parseToolInput(input: unknown): LlmRunResult {
  if (typeof input !== "object" || input === null) {
    throw new Error("ClaudeProvider: tool input was not an object.");
  }
  const obj = input as Record<string, unknown>;
  const explanation = obj.explanation;
  if (typeof explanation !== "string") {
    throw new Error("ClaudeProvider: tool input missing string 'explanation'.");
  }
  const rawAdjs = Array.isArray(obj.adjudications) ? obj.adjudications : [];
  const adjudications: LlmAdjudication[] = rawAdjs.map((raw) =>
    parseAdjudication(raw),
  );
  return { explanation, adjudications };
}

function parseAdjudication(raw: unknown): LlmAdjudication {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("ClaudeProvider: adjudication entry was not an object.");
  }
  const obj = raw as Record<string, unknown>;
  const v =
    typeof obj.verdict === "object" && obj.verdict !== null
      ? (obj.verdict as Record<string, unknown>)
      : undefined;
  if (v === undefined) {
    throw new Error("ClaudeProvider: adjudication missing 'verdict'.");
  }
  const kind = v.kind;
  if (
    typeof kind !== "string" ||
    !VERDICT_KINDS.includes(kind as VerdictKind)
  ) {
    throw new Error(`ClaudeProvider: invalid verdict kind '${String(kind)}'.`);
  }
  const verdict: Verdict = {
    kind: kind as VerdictKind,
    confidence: typeof v.confidence === "number" ? v.confidence : 0,
    summary: typeof v.summary === "string" ? v.summary : "",
    evidence: Array.isArray(v.evidence)
      ? (v.evidence as Verdict["evidence"])
      : [],
    ...(typeof v.logicalName === "string"
      ? { logicalName: v.logicalName }
      : {}),
    source: "llm",
  };
  return {
    ...(typeof obj.logicalName === "string"
      ? { logicalName: obj.logicalName }
      : {}),
    ...(typeof obj.eventId === "string" ? { eventId: obj.eventId } : {}),
    verdict,
  };
}

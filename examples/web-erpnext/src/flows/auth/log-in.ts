// examples/web-erpnext/src/flows/auth/log-in.ts
import type { Page } from "@playwright/test";
import type { Session, TelemetrySinkLike } from "@sentinele2e/contracts";
import type { TelemetrySink } from "@sentinele2e/core";
import {
  CompositeSink,
  InMemorySink,
  JsonlSink,
  ok,
  businessFailure,
} from "@sentinele2e/core";
import { PlaywrightDriver } from "@sentinele2e/driver-playwright";
import type { Credentials, LoginResult } from "../../domain/auth";
import { loginLocators, appShellLocators } from "../../domain/auth/locators";
import { LogInForm } from "../../components/auth/log-in-form";
import { defaultTimeoutMs } from "../../config/timeout";

const FLOW_NAME = "auth.login";
const INVALID_REASON = "INVALID_CREDENTIALS" as const;

// traceId/spanId/sequence are stamped centrally by the session's StampingSink (core §6);
// these are placeholders that satisfy the TelemetryEnvelope type contract only.
const STAMPED_BY_SINK = "";

type CreateSession = (
  page: Page,
  sink: TelemetrySink,
  sessionId: string,
) => Promise<Session>;

export interface LogInOptions {
  readonly timeoutMs?: number;
  /** §10.4 unit hook: inject an InMemorySink to read emitted events. Default: Composite+Jsonl. */
  readonly sink?: TelemetrySink;
  /** §8 unit hook: override session creation. Default: PlaywrightDriver.createSession (page-wrap). */
  readonly createSession?: CreateSession;
}

const defaultCreateSession: CreateSession = (page, sink, sessionId) =>
  new PlaywrightDriver().createSession(
    { existingPage: page, defaultTimeoutMs, sessionId },
    sink,
  );

/**
 * Page-wrap login flow (R-1: signature preserved). Builds a Session over the supplied Page,
 * runs the form, and races INVALID vs app-shell-ready via the driver-owned waitForFirstOf
 * (D2/D3 fixed: no Promise.race, no dead waitForSuccessSignal, throws on no-winner).
 * Returns the rich LoginResult (D-2).
 */
async function logIn(
  page: Page,
  credentials: Credentials,
  options?: LogInOptions,
): Promise<LoginResult> {
  const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
  const createSession = options?.createSession ?? defaultCreateSession;

  // Mint the run id up front so it names BOTH the JSONL file and the Session: the driver
  // adopts it as Session.id, so runId == Session.id == correlationId == every event's
  // traceId (spec §3.7/§6). When a sink is injected (unit tests), use it verbatim.
  const runId = crypto.randomUUID();
  const sink =
    options?.sink ??
    new CompositeSink([
      new InMemorySink(),
      new JsonlSink({ filePath: `test-results/telemetry/${runId}.jsonl` }),
    ]);

  const session = await createSession(page, sink, runId);

  const correlationId = session.id;
  const startedAt = Date.now();

  const flowSink = session.telemetry;
  emitEvent(flowSink, "flow.started", correlationId, FLOW_NAME);

  const form = new LogInForm(session);
  await form.fill(credentials);
  await form.submit();

  // D2/D3: driver-owned race. THROWS TimeoutError (with branchProgress) on no winner.
  const winner = await session.assert.waitForFirstOf(
    [
      { label: "INVALID", target: loginLocators.invalid, state: "visible" },
      { label: "SUCCESS", target: appShellLocators.ready, state: "visible" },
    ],
    { timeoutMs },
  );

  const finalUrl = session.supports("navigation")
    ? await readCurrentUrl(session)
    : undefined;
  const durationMs = Date.now() - startedAt;
  const meta = { correlationId, flowName: FLOW_NAME, startedAt, durationMs };

  if (winner === "INVALID") {
    const message = await form.readMessage();
    emitEvent(flowSink, "business.failure", correlationId, FLOW_NAME, {
      status: "ok" as const,
      domainReason: INVALID_REASON,
    });
    emitEvent(flowSink, "flow.finished", correlationId, FLOW_NAME, {
      outcome: "business-failure" as const,
      terminalReason: INVALID_REASON,
      didDegrade: false,
      timing: finishedTiming(startedAt, durationMs),
    });
    return businessFailure(INVALID_REASON, meta, {
      message,
      details: { username: credentials.username, finalUrl },
    });
  }

  emitEvent(flowSink, "flow.finished", correlationId, FLOW_NAME, {
    outcome: "success" as const,
    didDegrade: false,
    timing: finishedTiming(startedAt, durationMs),
  });
  return ok({ username: credentials.username, finalUrl }, meta);
}

async function readCurrentUrl(session: Session): Promise<string | undefined> {
  return session.currentUrl ? session.currentUrl() : undefined;
}

function nowTiming() {
  return {
    startWallClockMs: Date.now(),
    startMonotonicNs: process.hrtime.bigint(),
  };
}

/** Timing for the terminal flow.finished event: reuses the already-computed flow duration. */
function finishedTiming(startedAt: number, durationMs: number) {
  return {
    startWallClockMs: startedAt,
    startMonotonicNs: process.hrtime.bigint(),
    durationMs,
  };
}

/**
 * Single envelope builder. Merges common fields with type-specific `extra` and emits.
 * spanId/sequence are placeholders — the session's StampingSink overwrites them (core §6).
 */
function emitEvent(
  sink: TelemetrySinkLike,
  type: string,
  traceId: string,
  name: string,
  extra: Record<string, unknown> = {},
): void {
  const { timing, ...rest } = extra as {
    timing?: ReturnType<typeof nowTiming>;
    [k: string]: unknown;
  };
  sink.emit({
    schemaVersion: "1.0.0",
    eventId: cryptoId(),
    type: type as never,
    traceId,
    spanId: STAMPED_BY_SINK,
    sequence: 0,
    name,
    timing: timing ?? nowTiming(),
    ...rest,
  } as never);
}

function cryptoId(): string {
  return crypto.randomUUID();
}

export default logIn;
export { logIn };

// examples/web-erpnext/tests/flows/log-in.test.ts
import { test, expect } from "@playwright/test";
import { logIn } from "../../src/flows/auth/log-in";
import { InMemorySink } from "@sentinel/core";
import type { Locator, ElementState, Session } from "@sentinel/contracts";

/** Build a fake Page (only the methods the driver duck-types / flow may touch). */
function fakePage(url: string) {
  return {
    goto: async () => {},
    locator: () => ({}),
    url: () => url,
  } as unknown;
}

/**
 * The flow builds its own Session via PlaywrightDriver.createSession. To unit-test the flow
 * in isolation we pass `opts.sink` (an InMemorySink) and `opts.createSession` — the spec's
 * injectable hook documented in §8 (default = PlaywrightDriver.createSession). The fake
 * session decides the race winner.
 */
function fakeSession(
  sink: InMemorySink,
  winner: "INVALID" | "SUCCESS",
  id = "run-1",
): Session {
  return {
    id,
    driver: "fake",
    capabilities: new Set(),
    telemetry: sink,
    supports: () => false,
    require: () => {},
    locate: () => ({}) as never,
    action: {
      typeText: async () => {},
      tap: async () => {},
      clear: async () => {},
      read: async () => "Invalid Login. Try again.",
    },
    assert: {
      waitFor: async () => {},
      waitForFirstOf: async (
        _conds: ReadonlyArray<{
          label: string;
          target: Locator;
          state: ElementState;
        }>,
      ) => winner,
    },
    end: async () => {},
  } as unknown as Session;
}

test("invalid path returns business-failure with stable reason and truthy message", async () => {
  const sink = new InMemorySink();
  const result = await logIn(
    fakePage("https://erp/login") as never,
    { username: "admin.invalid", password: "x" },
    { sink, createSession: async () => fakeSession(sink, "INVALID") },
  );

  expect(result.status).toBe("business-failure");
  if (result.status === "business-failure") {
    expect(result.reason).toBe("INVALID_CREDENTIALS");
    expect(result.message).toBeTruthy();
    expect(result.details?.username).toBe("admin.invalid");
  }

  const types = sink.events.map((e) => e.type);
  expect(types).toContain("flow.started");
  expect(types).toContain("flow.finished");
  const biz = sink.events.find((e) => e.type === "business.failure");
  expect(biz).toBeDefined();
  expect((biz as { domainReason?: string }).domainReason).toBe(
    "INVALID_CREDENTIALS",
  );

  // one correlationId across the run
  const ids = new Set(sink.events.map((e) => e.traceId));
  expect(ids.size).toBe(1);
});

test("success path returns success with username", async () => {
  const sink = new InMemorySink();
  const result = await logIn(
    fakePage("https://erp/app") as never,
    { username: "admin", password: "secret" },
    { sink, createSession: async () => fakeSession(sink, "SUCCESS") },
  );
  expect(result.status).toBe("success");
  if (result.status === "success") {
    expect(result.data.username).toBe("admin");
  }
});

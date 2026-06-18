// packages/dashboard/tests/redact.test.ts
//
// SECURITY regression (blocking gate, spec §6 / §11 F6). Two independent
// controls are exercised end-to-end against the generated HTML:
//   1. redact-before-embed: shape-matching secrets in a system.failure.message
//      are scrubbed to [redacted] in BOTH the timeline row AND the joined
//      verdict-evidence detail (which is rebuilt from classify(redacted)).
//   2. escape-on-output: an XSS payload planted in a logicalName appears only
//      HTML-escaped, never live; a </script> inside a string never breaks the
//      JSON data island.
// The documented non-shape-matching-secret limitation is asserted EXPLICITLY:
// a plain non-shaped value under a non-secret key survives (known limitation,
// not a silent pass).
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { buildDashboardModel } from "../src/model";
import { generateDashboard } from "../src/render";

const LEAKY = path.join(__dirname, "fixtures", "leaky");

// The planted shape-matching secrets (JWT, sk- API key) inside the
// system.failure.message — these must NEVER reach the output.
const PLANTED_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const PLANTED_SK = "sk-abcdef0123456789abcdef0123";
// The planted XSS payload inside a logicalName.
const XSS_RAW = "<script>alert(1)</script>";
const XSS_ESCAPED = "&lt;script&gt;alert(1)&lt;/script&gt;";
// The documented limitation: a plain, non-shaped secret under a non-secret key.
const NON_SHAPED_SECRET = "DBPASSWORD_HUNTER2";

async function leakyHtml(): Promise<string> {
  const model = await buildDashboardModel(LEAKY, {
    generatedAt: "1970-01-01T00:00:00.000Z",
  });
  return generateDashboard(model);
}

test("shape-matching secrets never reach the HTML; [redacted] does", async () => {
  const out = await leakyHtml();
  expect(out).not.toContain(PLANTED_JWT);
  expect(out).not.toContain(PLANTED_SK);
  // and the marker IS present (it came through redactEvents)
  expect(out).toContain("[redacted]");
});

test("the redacted secret is scrubbed in BOTH timeline row AND verdict evidence", async () => {
  const out = await leakyHtml();

  // Timeline row: the system.failure event renders its (redacted) message.
  const timelineStart = out.indexOf('<ul class="timeline">');
  const timelineEnd = out.indexOf("</ul>", timelineStart);
  const timeline = out.slice(timelineStart, timelineEnd);
  expect(timeline).toContain("system.failure");
  expect(timeline).toContain("[redacted]");
  expect(timeline).not.toContain(PLANTED_JWT);
  expect(timeline).not.toContain(PLANTED_SK);

  // Joined verdict-evidence detail: built from classify(redacted), so the
  // same scrubbed message is interpolated into the selector-drift evidence.
  const verdictsStart = out.indexOf("<h3>Verdicts</h3>");
  const verdicts = out.slice(verdictsStart);
  expect(verdicts).toContain("selector-not-found");
  expect(verdicts).toContain("[redacted]");
  expect(verdicts).not.toContain(PLANTED_JWT);
  expect(verdicts).not.toContain(PLANTED_SK);
});

test("XSS payload in logicalName appears only escaped, never live", async () => {
  const out = await leakyHtml();
  // never a live <script>alert(1)</script> anywhere
  expect(out).not.toContain(XSS_RAW);
  // it appears only in its escaped form (in the timeline row and the evidence)
  expect(out).toContain(XSS_ESCAPED);
});

test("a </script> inside a string does not break the JSON data island", async () => {
  const out = await leakyHtml();
  const islandStart = out.indexOf(
    '<script id="sentinel-data" type="application/json">',
  );
  expect(islandStart).toBeGreaterThanOrEqual(0);
  const jsonStart =
    islandStart + '<script id="sentinel-data" type="application/json">'.length;
  const jsonEnd = out.indexOf("</script>", jsonStart);
  const islandJson = out.slice(jsonStart, jsonEnd);

  // No literal </script breakout inside the island payload.
  expect(islandJson).not.toContain("</script");
  expect(islandJson).toContain("\\u003C/script");
  // The island is still valid, parseable JSON carrying the model.
  const parsed = JSON.parse(islandJson) as {
    report: { totals: { runs: number } };
  };
  expect(parsed.report.totals.runs).toBe(1);
});

test("DOCUMENTED LIMITATION: a non-shaped secret under a non-secret key survives", async () => {
  // redactEvents is value-shape-narrow by design (it preserves UUIDs/selectors),
  // so a plaintext secret that matches no known shape and sits under a
  // non-secret key (here: system.failure.message) is NOT scrubbed. We assert it
  // EXPLICITLY so this known gap can never regress silently into a false pass.
  const out = await leakyHtml();
  expect(out).toContain(NON_SHAPED_SECRET);
});

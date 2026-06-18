// packages/dashboard/src/render.ts
//
// PURE server-side renderer: generateDashboard(model, opts) -> a single
// self-contained <!doctype html> string. No fs, no network. EVERY interpolated
// telemetry string passes through escapeHtml; the embedded model goes through
// the </script>-guarded jsonIsland; exactly one
// <script id="sentinel-data" type="application/json"> island is emitted.
//
// Two-layer rule (spec §3): the totals strip uses run-level `report.totals.*`
// (indeterminate ABSENT); the per-run chips use verdict-level
// `RunSummary.verdictCounts` (indeterminate INCLUDED). They are never mixed.
import type {
  RunReport,
  RunSummary,
  Verdict,
  VerdictKind,
} from "@sentinele2e/ai";
import type { DashboardModel, RunDetail, TimelineEntry } from "./model";
import { DASHBOARD_CSS, DASHBOARD_JS, escapeHtml, jsonIsland } from "./html";

export interface GenerateDashboardOptions {
  /** Document title suffix override; defaults to the report's generatedFrom. */
  readonly title?: string;
}

const ANALYSIS_SCHEMA_VERSION = "1.0.0";

/** Run-level totals tiles. `indeterminate` is intentionally absent here. */
const TOTAL_TILES: ReadonlyArray<{
  readonly key: keyof RunReport["totals"];
  readonly label: string;
}> = [
  { key: "realBug", label: "runs containing ≥1 real bug" },
  { key: "infraFlake", label: "runs containing ≥1 infra flake" },
  { key: "selectorDrift", label: "runs containing ≥1 selector drift" },
  { key: "businessOutcome", label: "runs containing ≥1 business outcome" },
  { key: "healthy", label: "runs containing ≥1 healthy verdict" },
];

/** Verdict chips, including `indeterminate` (verdict-level layer). */
const VERDICT_KINDS: readonly VerdictKind[] = [
  "real-bug",
  "infra-flake",
  "selector-drift",
  "business-outcome",
  "healthy",
  "indeterminate",
];

function esc(value: unknown): string {
  return escapeHtml(String(value));
}

function tile(count: number, label: string, key: string): string {
  return `<div class="tile" data-total="${esc(key)}"><div class="count">${esc(
    count,
  )}</div><div class="label">${esc(label)}</div></div>`;
}

function verdictChips(counts: Record<VerdictKind, number>): string {
  return VERDICT_KINDS.filter((k) => (counts[k] ?? 0) > 0)
    .map(
      (k) =>
        `<span class="chip kind-${esc(k)}">${esc(k)} ${esc(counts[k])}</span>`,
    )
    .join("");
}

/** Count, per drifting logicalName, how many runs it drifted in. */
function driftRunCounts(runs: readonly RunSummary[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of runs) {
    for (const loc of r.driftingLocators) {
      counts.set(loc, (counts.get(loc) ?? 0) + 1);
    }
  }
  return counts;
}

function header(model: DashboardModel): string {
  const { report } = model;
  const banner = model.anyTruncated
    ? `<div class="banner">Some run timelines were truncated to the configured event cap. Telemetry strings are redacted before embedding and HTML-escaped on output.</div>`
    : `<div class="banner">Telemetry strings are redacted before embedding and HTML-escaped on output.</div>`;
  return `<header class="report-header">
  <h1>Sentinel report — ${esc(report.generatedFrom)}</h1>
  <div class="meta">
    <span>Generated at ${esc(model.generatedAt)}</span> ·
    <span>${esc(report.totals.runs)} run(s)</span> ·
    <span>report schema ${esc(report.schemaVersion)}</span> ·
    <span>analysis schema ${esc(ANALYSIS_SCHEMA_VERSION)}</span>
  </div>
  ${banner}
</header>`;
}

function totalsStrip(report: RunReport): string {
  const tiles = [
    tile(report.totals.runs, "total runs", "runs"),
    ...TOTAL_TILES.map((t) =>
      tile(report.totals[t.key] as number, t.label, t.key),
    ),
  ].join("");
  return `<section class="totals-strip" aria-label="run-level totals">${tiles}</section>`;
}

function driftSection(report: RunReport): string {
  const counts = driftRunCounts(report.runs);
  if (report.totals.driftingLocators.length === 0) {
    return `<section class="drift-section"><h2>Drifting locators</h2><p class="muted">No locator drift detected.</p></section>`;
  }
  const chips = report.totals.driftingLocators
    .map((loc) => {
      const n = counts.get(loc) ?? 0;
      return `<span class="chip">${esc(loc)} <span class="muted">(${esc(
        n,
      )} run${n === 1 ? "" : "s"})</span></span>`;
    })
    .join("");
  return `<section class="drift-section"><h2>Drifting locators</h2><div>${chips}</div></section>`;
}

/** Type-specific one-line timeline body; unknown event types render generically. */
function timelineBody(entry: TimelineEntry): string {
  const ev = entry.event as unknown as Record<string, unknown>;
  switch (entry.type) {
    case "locator.resolved": {
      const degraded = ev.degraded === true;
      const trail = Array.isArray(ev.candidates)
        ? (ev.candidates as Array<Record<string, unknown>>)
            .map((c) => `${esc(c.kind)}:${esc(c.outcome)}@${esc(c.rank)}`)
            .join(" → ")
        : "";
      const badge = degraded
        ? ` <span class="badge-degraded">degraded</span>`
        : "";
      return `resolved <code>${esc(ev.logicalName)}</code> → <code>${esc(
        ev.resolvedKind,
      )}</code> rank ${esc(ev.resolvedRank)}${badge} <span class="muted">[${trail}]</span>`;
    }
    case "assertion":
      return `assertion <code>${esc(entry.name)}</code> state=${esc(
        ev.state,
      )} matched=${esc(ev.matched)} rank=${esc(ev.locatorRank)}`;
    case "retry":
      return `retry <code>${esc(entry.name)}</code> attempt ${esc(
        ev.attempt,
      )}/${esc(ev.maxAttempts)} reason=${esc(ev.reason)} prev=${esc(
        ev.previousOutcome,
      )}`;
    case "system.failure":
      return `system.failure <code>${esc(entry.name)}</code> ${esc(
        ev.errorKind,
      )} retryable=${esc(ev.retryable)} — ${esc(ev.message)}`;
    case "business.failure":
      return `business.failure <code>${esc(entry.name)}</code> reason=${esc(
        ev.domainReason,
      )}`;
    case "artifact.captured":
      return `artifact.captured ${esc(ev.artifactKind)} ref=${esc(
        ev.ref,
      )} on=${esc(ev.capturedOn)}`;
    case "flow.finished":
      return `flow.finished <code>${esc(entry.name)}</code> outcome=${esc(
        ev.outcome,
      )} didDegrade=${esc(ev.didDegrade)}${
        ev.terminalReason ? ` reason=${esc(ev.terminalReason)}` : ""
      }`;
    default:
      return `${esc(entry.type)} <code>${esc(entry.name)}</code>`;
  }
}

function timelineRow(entry: TimelineEntry, runId: string): string {
  const anchor = `tl-${esc(runId)}-${esc(entry.eventId)}`;
  const dur =
    entry.durationMs !== undefined
      ? ` <span class="muted">(${esc(entry.durationMs)}ms)</span>`
      : "";
  return `<li id="${anchor}"><span class="seq">#${esc(
    entry.sequence,
  )}</span> ${timelineBody(entry)}${dur}</li>`;
}

function evidenceItem(runId: string, e: Verdict["evidence"][number]): string {
  const anchor = `tl-${esc(runId)}-${esc(e.eventId)}`;
  return `<div class="evidence"><a class="evidence-link" href="#${anchor}">${esc(
    e.type,
  )}</a>: ${esc(e.detail)}</div>`;
}

function verdictBlock(runId: string, v: Verdict): string {
  const evidence = v.evidence.map((e) => evidenceItem(runId, e)).join("");
  const logical = v.logicalName
    ? ` <span class="muted">on <code>${esc(v.logicalName)}</code></span>`
    : "";
  return `<div class="verdict">
  <span class="chip kind-${esc(v.kind)}">${esc(v.kind)}</span>
  <strong>${esc(v.summary)}</strong>${logical}
  <span class="muted">(${esc(v.source)}, confidence ${esc(v.confidence)})</span>
  ${evidence}
</div>`;
}

function runDetailPanel(detail: RunDetail): string {
  const panelId = `detail-${esc(detail.runId)}`;
  const truncNote = detail.truncated
    ? `<p class="muted">Truncated — showing first ${esc(
        detail.timeline.length,
      )} of ${esc(detail.totalEvents)} events.</p>`
    : "";
  const timeline = detail.timeline
    .map((t) => timelineRow(t, detail.runId))
    .join("");
  const verdicts =
    detail.verdicts.length > 0
      ? detail.verdicts.map((v) => verdictBlock(detail.runId, v)).join("")
      : `<p class="muted">No rule verdicts.</p>`;
  const explanation = detail.explanation
    ? `<div class="explanation"><h3>Explanation</h3><p>${esc(
        detail.explanation,
      )}</p></div>`
    : "";
  return `<tr class="run-detail-row" hidden data-open="false"><td colspan="5">
  <div id="${panelId}" class="run-detail">
    <h3>Timeline</h3>
    ${truncNote}
    <ul class="timeline">${timeline}</ul>
    <h3>Verdicts</h3>
    ${verdicts}
    ${explanation}
  </div>
</td></tr>`;
}

interface RunRow {
  readonly summary: RunSummary;
  readonly detail?: RunDetail;
}

function runRow(row: RunRow): string {
  const s = row.summary;
  const kinds = VERDICT_KINDS.filter((k) => (s.verdictCounts[k] ?? 0) > 0).join(
    " ",
  );
  const expand = row.detail
    ? `<button class="expand-btn" data-target="detail-${esc(
        s.runId,
      )}" aria-expanded="false">▸ details</button>`
    : "";
  const main = `<tr class="run-row" data-outcome="${esc(
    s.outcome,
  )}" data-kinds="${esc(kinds)}">
  <td>${expand} <code>${esc(s.runId)}</code></td>
  <td><code>${esc(s.file)}</code></td>
  <td>${esc(s.outcome)}</td>
  <td>${s.hasRealBug ? '<span class="chip kind-real-bug">real bug</span>' : ""}</td>
  <td>${verdictChips(s.verdictCounts)}</td>
</tr>`;
  return row.detail ? main + runDetailPanel(row.detail) : main;
}

function runsTable(model: DashboardModel): string {
  // Prefer the time-ordered detail list; fall back to report.runs when detail
  // was disabled (rollup-only). The detail list is already sorted by startedAt.
  const detailByRunId = new Map(model.runs.map((d) => [d.runId, d]));
  const rows: RunRow[] =
    model.runs.length > 0
      ? model.runs.map((d) => {
          const summary = model.report.runs.find((s) => s.runId === d.runId);
          // summary is always present (detail is derived from report.runs)
          return { summary: summary as RunSummary, detail: d };
        })
      : model.report.runs.map((s) => ({
          summary: s,
          detail: detailByRunId.get(s.runId),
        }));

  const controls = `<div class="controls">
  <label for="filter-kind">Filter:</label>
  <select id="filter-kind">
    <option value="all">all</option>
    <option value="success">outcome: success</option>
    <option value="business-failure">outcome: business-failure</option>
    <option value="system-failure">outcome: system-failure</option>
    <option value="real-bug">kind: real-bug</option>
    <option value="infra-flake">kind: infra-flake</option>
    <option value="selector-drift">kind: selector-drift</option>
    <option value="business-outcome">kind: business-outcome</option>
    <option value="healthy">kind: healthy</option>
    <option value="indeterminate">kind: indeterminate</option>
  </select>
</div>`;

  return `<section class="runs-section">
  <h2>Runs</h2>
  ${controls}
  <table class="runs">
    <thead><tr><th>run</th><th>file</th><th>outcome</th><th>real bug</th><th>verdicts</th></tr></thead>
    <tbody>${rows.map(runRow).join("")}</tbody>
  </table>
</section>`;
}

/**
 * Render the complete single-file dashboard HTML. Pure: same model -> same
 * string. The embedded model is already redacted (built by buildDashboardModel
 * from redactEvents/classify(redacted)); here we add the output-side escape +
 * the </script>-guarded data island.
 */
export function generateDashboard(
  model: DashboardModel,
  opts: GenerateDashboardOptions = {},
): string {
  const titleSuffix = opts.title ?? model.report.generatedFrom;
  const island = jsonIsland(model);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Sentinel report — ${esc(titleSuffix)}</title>
    <style>${DASHBOARD_CSS}</style>
  </head>
  <body>
    <main id="app">
      ${header(model)}
      ${totalsStrip(model.report)}
      ${driftSection(model.report)}
      ${runsTable(model)}
    </main>
    <script id="sentinel-data" type="application/json">${island}</script>
    <script>${DASHBOARD_JS}</script>
  </body>
</html>
`;
}

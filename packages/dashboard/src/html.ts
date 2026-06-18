// packages/dashboard/src/html.ts
//
// The two mandatory output-side security controls plus the inline assets.
//
//  - escapeHtml(s): escapes & < > " ' on EVERY interpolated telemetry string in
//    the server-rendered DOM (the stored-XSS control).
//  - jsonIsland(obj): JSON.stringify hardened so the serialized data can sit
//    safely inside a <script type="application/json"> element — </script>, HTML
//    comment openers, and the U+2028/U+2029 line/paragraph separators are all
//    neutralized (the data-island breakout control).
//
// These are distinct, both-required controls: redaction (model.ts / ai) is
// necessary but NOT sufficient against telemetry-sourced stored XSS.

/** HTML-escape a string for safe interpolation into element text/attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize `obj` to JSON safe to embed inside
 * `<script id="sentinel-data" type="application/json">…</script>`.
 *
 * Beyond plain JSON.stringify we escape:
 *  - `<`, `>`, `&` (defense-in-depth; a raw `<` cannot start a tag in an HTML
 *    comment/CDATA edge case),
 *  - `</script` -> `<\/script` (the primary data-island breakout vector),
 *  - `<!--` -> `<\!--` (HTML comment opener),
 *  - U+2028 / U+2029 (LINE / PARAGRAPH SEPARATOR — valid in JSON, illegal in a
 *    bare JS string; harmless here but escaped for portability).
 *
 * The output is still valid JSON: `JSON.parse` of the UN-escaped string round-
 * trips to the original object.
 */
export function jsonIsland(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Inline stylesheet. System font stack only — NO CDN, NO external font/asset.
 * Kept deliberately small; the snapshot test asserts structural anchors, never
 * this blob, so it can evolve without churning tests.
 */
export const DASHBOARD_CSS = `
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e5e7eb;
  --chip-bg: #f3f4f6; --bad: #b91c1c; --warn: #b45309; --ok: #15803d;
  --info: #1d4ed8; --neutral: #4b5563;
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 1.5rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--fg); background: var(--bg); line-height: 1.45;
}
h1, h2, h3 { line-height: 1.2; margin: 0 0 .5rem; }
header.report-header { border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1rem; }
header.report-header .meta { color: var(--muted); font-size: .875rem; }
.banner { background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; padding: .5rem .75rem; border-radius: 6px; margin: .75rem 0; font-size: .875rem; }
.totals-strip { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0; }
.totals-strip .tile { border: 1px solid var(--border); border-radius: 8px; padding: .75rem 1rem; min-width: 9rem; }
.totals-strip .tile .count { font-size: 1.75rem; font-weight: 700; }
.totals-strip .tile .label { color: var(--muted); font-size: .8125rem; }
.chip { display: inline-block; padding: .125rem .5rem; border-radius: 999px; font-size: .75rem; background: var(--chip-bg); color: var(--neutral); margin: 0 .25rem .25rem 0; }
.chip.kind-real-bug { background: #fee2e2; color: var(--bad); }
.chip.kind-infra-flake { background: #fef3c7; color: var(--warn); }
.chip.kind-selector-drift { background: #fef9c3; color: var(--warn); }
.chip.kind-healthy { background: #dcfce7; color: var(--ok); }
.chip.kind-business-outcome { background: #dbeafe; color: var(--info); }
.chip.kind-indeterminate { background: var(--chip-bg); color: var(--neutral); }
.drift-section .chip { background: #fef9c3; color: var(--warn); }
table.runs { border-collapse: collapse; width: 100%; margin-top: .5rem; }
table.runs th, table.runs td { text-align: left; padding: .5rem .625rem; border-bottom: 1px solid var(--border); vertical-align: top; font-size: .875rem; }
table.runs th { color: var(--muted); font-weight: 600; }
.controls { display: flex; gap: .5rem; align-items: center; margin: .75rem 0; flex-wrap: wrap; }
.controls select, .controls button { font: inherit; padding: .25rem .5rem; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--fg); cursor: pointer; }
.expand-btn { background: none; border: none; cursor: pointer; color: var(--info); padding: 0; font: inherit; }
.run-detail[hidden] { display: none; }
.run-detail { background: #fafafa; border: 1px solid var(--border); border-radius: 8px; padding: .75rem; margin: .25rem 0 .75rem; }
.timeline { list-style: none; padding: 0; margin: .5rem 0; }
.timeline li { padding: .375rem .5rem; border-left: 3px solid var(--border); margin-bottom: .25rem; }
.timeline li.highlight { background: #fff7ed; border-left-color: var(--warn); }
.timeline .seq { color: var(--muted); font-variant-numeric: tabular-nums; }
.badge-degraded { color: var(--bad); font-weight: 600; }
.verdict { border-top: 1px solid var(--border); padding-top: .5rem; margin-top: .5rem; }
.verdict .evidence { color: var(--neutral); font-size: .8125rem; margin: .25rem 0 0 .5rem; }
.evidence a { color: var(--info); }
.muted { color: var(--muted); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .8125rem; }
`.trim();

/**
 * Inline client script. Does ONLY filter / sort / expand / anchor-highlight.
 * Hard rules baked into the code:
 *  - NEVER assigns innerHTML from any data (only toggles `hidden`, classes,
 *    and reads textContent for sort keys),
 *  - NO eval / Function,
 *  - NO network (no fetch / XHR / dynamic import),
 *  - reads the parsed #sentinel-data island for nothing but a defensive presence
 *    check; all rendering already happened server-side.
 */
export const DASHBOARD_JS = `
(function () {
  "use strict";
  // Defensive presence check of the data island (parsed, never rendered).
  var dataEl = document.getElementById("sentinel-data");
  try { if (dataEl) JSON.parse(dataEl.textContent || "{}"); } catch (e) { /* ignore */ }

  // Expand / collapse per-run drill-down (toggles [hidden] only).
  document.querySelectorAll(".expand-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-target");
      if (!id) return;
      var panel = document.getElementById(id);
      if (!panel) return;
      var nowHidden = !panel.hidden;
      panel.hidden = nowHidden;
      btn.setAttribute("aria-expanded", String(!nowHidden));
      btn.textContent = nowHidden ? "▸ details" : "▾ details";
    });
  });

  // Outcome / verdict-kind filter over the runs table (toggles row [hidden]).
  var filterEl = document.getElementById("filter-kind");
  if (filterEl) {
    filterEl.addEventListener("change", function () {
      var v = filterEl.value;
      document.querySelectorAll("tr.run-row").forEach(function (row) {
        var kinds = (row.getAttribute("data-kinds") || "").split(" ");
        var outcome = row.getAttribute("data-outcome") || "";
        var match = v === "all" || outcome === v || kinds.indexOf(v) !== -1;
        row.hidden = !match;
        // also hide an open detail panel for a filtered-out row
        var detail = row.nextElementSibling;
        if (detail && detail.classList.contains("run-detail-row")) {
          detail.hidden = !match || detail.getAttribute("data-open") !== "true";
        }
      });
    });
  }

  // Anchor highlight: clicking an evidence link flashes its timeline row.
  document.querySelectorAll("a.evidence-link").forEach(function (a) {
    a.addEventListener("click", function () {
      var id = a.getAttribute("href");
      if (!id || id.charAt(0) !== "#") return;
      var li = document.getElementById(id.slice(1));
      if (!li) return;
      document.querySelectorAll(".timeline li.highlight").forEach(function (el) {
        el.classList.remove("highlight");
      });
      li.classList.add("highlight");
    });
  });
})();
`.trim();

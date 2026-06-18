// packages/cli/src/commands/report.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { buildReport } from "@sentinele2e/ai";
import type { RunReport, VerdictKind } from "@sentinele2e/ai";
import {
  buildDashboardModel,
  generateDashboard,
  DEFAULT_MAX_EVENTS,
} from "@sentinele2e/dashboard";
import type { CliResult } from "../dispatch";
import { loadConfig } from "../config";

// Slice F (F1): buildReport + the RunReport contract moved into @sentinele2e/ai
// (single source of truth shared with the dashboard). Re-export buildReport so
// existing CLI imports (`import { reportCommand, buildReport }`) resolve.
export { buildReport };

const VERDICT_KINDS: readonly VerdictKind[] = [
  "real-bug",
  "infra-flake",
  "selector-drift",
  "healthy",
  "business-outcome",
  "indeterminate",
];

/** Human-readable run table + totals footer. */
function renderText(report: RunReport): string {
  const lines: string[] = [];
  lines.push(`Sentinel report — ${report.generatedFrom}`);
  lines.push("");
  if (report.runs.length === 0) {
    lines.push("(no runs)");
    return lines.join("\n");
  }
  lines.push("RUN                            OUTCOME            VERDICTS");
  for (const r of report.runs) {
    const verdicts = VERDICT_KINDS.filter((k) => r.verdictCounts[k] > 0)
      .map((k) => `${k}×${r.verdictCounts[k]}`)
      .join(", ");
    lines.push(
      `${r.runId.padEnd(30)} ${r.outcome.padEnd(18)} ${verdicts || "(none)"}`,
    );
  }
  lines.push("");
  lines.push(
    `Totals: ${report.totals.runs} run(s) — ` +
      `real-bug ${report.totals.realBug}, ` +
      `infra-flake ${report.totals.infraFlake}, ` +
      `selector-drift ${report.totals.selectorDrift}, ` +
      `business-outcome ${report.totals.businessOutcome}, ` +
      `healthy ${report.totals.healthy}`,
  );
  if (report.totals.driftingLocators.length > 0) {
    lines.push(
      `Drifting locators: ${report.totals.driftingLocators.join(", ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * Read the value of a `--flag <value>` option from argv. Returns undefined when
 * the flag is absent; the parsed value otherwise. The value token is collected so
 * the positional-`dir` scan can skip it (it is not a directory argument).
 */
function flagValue(
  args: readonly string[],
  flag: string,
): { value?: string; consumed: Set<number> } {
  const consumed = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      consumed.add(i);
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith("--")) {
        consumed.add(i + 1);
        return { value: v, consumed };
      }
      return { value: "", consumed };
    }
  }
  return { consumed };
}

/**
 * `sentinel report [dir] [--json | --html <out>] [--serve] [--port <n>]
 *  [--auth <user:pass>] [--explain] [--max-events <n>] [--no-detail]`.
 * `dir` defaults to config.telemetryDir. Exit 1 iff any run contains a real bug;
 * an empty/missing dir is not an error (clear message + exit 0).
 *
 *  - `--json` (unchanged) and `--html <out>` are MUTUALLY EXCLUSIVE (exit 2).
 *  - `--html <out>` builds the dashboard model + writes a self-contained HTML
 *    file; the output message is the ABSOLUTE path written; the real-bug gate
 *    drives the exit code exactly as the text/json paths do.
 *  - `--serve` builds the model + html and starts a loopback (127.0.0.1) server;
 *    it is long-running (does not return; Ctrl-C to stop). `--auth user:pass`
 *    requires HTTP Basic Auth.
 *  - `--explain` is opt-in LLM prose (may hit the network/cost when
 *    ANTHROPIC_API_KEY is set); off by default (rules-only, provider:null).
 */
export async function reportCommand(
  args: readonly string[],
): Promise<CliResult> {
  const asJson = args.includes("--json");
  const htmlFlag = flagValue(args, "--html");
  const asHtml = args.includes("--html");
  const serve = args.includes("--serve");
  const explain = args.includes("--explain");
  const detail = !args.includes("--no-detail");
  const maxEventsFlag = flagValue(args, "--max-events");
  const portFlag = flagValue(args, "--port");
  const authFlag = flagValue(args, "--auth");

  if (asJson && (asHtml || serve)) {
    return {
      output: "error: --json and --html are mutually exclusive.",
      exitCode: 2,
    };
  }

  const maxEvents = maxEventsFlag.value
    ? Number(maxEventsFlag.value)
    : DEFAULT_MAX_EVENTS;
  if (!Number.isFinite(maxEvents) || maxEvents <= 0) {
    return {
      output: `error: --max-events must be a positive number (got '${maxEventsFlag.value}').`,
      exitCode: 2,
    };
  }

  // The positional `dir` is the first non-flag token that was not consumed as a
  // flag value (e.g. the path after --html / --max-events / --port / --auth).
  const consumed = new Set<number>([
    ...htmlFlag.consumed,
    ...maxEventsFlag.consumed,
    ...portFlag.consumed,
    ...authFlag.consumed,
  ]);
  let dirArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (tok !== undefined && !tok.startsWith("--") && !consumed.has(i)) {
      dirArg = tok;
      break;
    }
  }
  const dir = dirArg ?? loadConfig().telemetryDir;

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      output: `No telemetry directory at '${dir}' — nothing to report.`,
      exitCode: 0,
    };
  }

  if (asHtml || serve) {
    return reportDashboard(dir, {
      out: htmlFlag.value,
      serve,
      port: portFlag.value ? Number(portFlag.value) : undefined,
      auth: authFlag.value,
      explain,
      maxEvents,
      detail,
    });
  }

  const report = await buildReport(dir);
  if (report.runs.length === 0) {
    return {
      output: asJson
        ? JSON.stringify(report, null, 2)
        : `No *.jsonl runs in '${dir}' — nothing to report.`,
      exitCode: 0,
    };
  }

  const output = asJson ? JSON.stringify(report, null, 2) : renderText(report);
  const hasRealBug = report.totals.realBug > 0;
  return { output, exitCode: hasRealBug ? 1 : 0 };
}

interface DashboardCliOptions {
  readonly out?: string;
  readonly serve: boolean;
  readonly port?: number;
  readonly auth?: string;
  readonly explain: boolean;
  readonly maxEvents: number;
  readonly detail: boolean;
}

/** Default loopback port for `--serve`. */
const DEFAULT_SERVE_PORT = 4317;

/**
 * `--html` / `--serve` path: build the dashboard model (rules-only unless
 * `--explain`), render the self-contained HTML, then write a file and/or start a
 * loopback server. The exit code mirrors the text/json real-bug gate. `--serve`
 * is long-running (does not return; Ctrl-C to stop).
 */
async function reportDashboard(
  dir: string,
  opts: DashboardCliOptions,
): Promise<CliResult> {
  const model = await buildDashboardModel(dir, {
    explain: opts.explain,
    maxEvents: opts.maxEvents,
    detail: opts.detail,
  });
  const html = generateDashboard(model, {});
  const hasRealBug = model.report.totals.realBug > 0;

  const messages: string[] = [];

  // `--html` writes the file even alongside `--serve`.
  if (opts.out !== undefined && opts.out !== "") {
    const abs = path.resolve(opts.out);
    fs.writeFileSync(abs, html);
    messages.push(abs);
  }

  if (opts.serve) {
    const { serveDashboard } = await import("@sentinele2e/dashboard");
    const auth = parseAuth(opts.auth);
    const { ready } = serveDashboard(html, {
      port: opts.port ?? DEFAULT_SERVE_PORT,
      auth,
    });
    const url = await ready;
    messages.push(`Serving Sentinel dashboard at ${url}`);
    if (auth) {
      messages.push(
        "HTTP Basic Auth is required (configured --auth user:pass).",
      );
    }
    messages.push("Loopback-only (127.0.0.1). Press Ctrl-C to stop.");
    // `--serve` is long-running: the normal "return CliResult -> shim prints"
    // path never fires, so emit the banner now, then keep the loop alive.
    console.log(messages.join("\n"));
    await new Promise<never>(() => {});
  }

  return { output: messages.join("\n"), exitCode: hasRealBug ? 1 : 0 };
}

/** Parse a `user:pass` auth string; undefined/empty means open serving. */
function parseAuth(
  raw: string | undefined,
): { user: string; pass: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf(":");
  if (idx < 0) return { user: raw, pass: "" };
  return { user: raw.slice(0, idx), pass: raw.slice(idx + 1) };
}

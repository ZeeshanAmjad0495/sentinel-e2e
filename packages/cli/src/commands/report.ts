// packages/cli/src/commands/report.ts
import * as fs from "node:fs";
import { buildReport } from "@sentinele2e/ai";
import type { RunReport, VerdictKind } from "@sentinele2e/ai";
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
 * `sentinel report [dir] [--json]`. `dir` defaults to config.telemetryDir.
 * Exit 1 iff any run contains a real bug; an empty/missing dir is not an error
 * (clear message + exit 0 — there is simply nothing to report).
 */
export async function reportCommand(
  args: readonly string[],
): Promise<CliResult> {
  const asJson = args.includes("--json");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const dir = dirArg ?? loadConfig().telemetryDir;

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      output: `No telemetry directory at '${dir}' — nothing to report.`,
      exitCode: 0,
    };
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

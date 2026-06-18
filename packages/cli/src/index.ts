// packages/cli/src/index.ts
export type { CliResult } from "./dispatch";
export { run, USAGE } from "./dispatch";
export type { SentinelConfig } from "./config";
export { loadConfig, DEFAULT_CONFIG, CONFIG_FILENAME } from "./config";
export type { RunReport, RunSummary } from "./report-model";
export { REPORT_SCHEMA_VERSION } from "./report-model";

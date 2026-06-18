// packages/cli/src/report-model.ts
//
// Slice F (F1): the RunReport contract now lives in @sentinele2e/ai (the shared
// analysis layer) so both `reportCommand` and the slice-F dashboard consume one
// source of truth. These are thin re-exports preserving the CLI's prior export
// surface — existing imports/tests resolve unchanged.
export type { RunReport, RunSummary } from "@sentinele2e/ai";
export { REPORT_SCHEMA_VERSION } from "@sentinele2e/ai";

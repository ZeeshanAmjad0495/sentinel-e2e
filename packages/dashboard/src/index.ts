// packages/dashboard/src/index.ts
// Barrel for @sentinele2e/dashboard — a pure, offline static-HTML generator over
// run telemetry. (render/html surfaces land in F4/F5.)
export type {
  DashboardModel,
  RunDetail,
  TimelineEntry,
  BuildDashboardModelOptions,
} from "./model";
export { buildDashboardModel, DEFAULT_MAX_EVENTS } from "./model";

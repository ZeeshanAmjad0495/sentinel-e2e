// packages/cli/tests/dispatch.test.ts
import { test, expect } from "@playwright/test";
import { run, USAGE } from "../src/dispatch";

test("no args prints usage and exits 0", async () => {
  const res = await run([]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toBe(USAGE);
  expect(res.output).toContain("analyze");
  expect(res.output).toContain("report");
  expect(res.output).toContain("init");
  expect(res.output).toContain("run");
});

test("--help prints usage and exits 0", async () => {
  const res = await run(["--help"]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("usage: sentinel");
});

test("--version prints a semver-ish version and exits 0", async () => {
  const res = await run(["--version"]);
  expect(res.exitCode).toBe(0);
  expect(res.output.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("unknown command prints usage and exits 2", async () => {
  const res = await run(["frobnicate"]);
  expect(res.exitCode).toBe(2);
  expect(res.output.toLowerCase()).toContain("unknown command");
  expect(res.output).toContain("usage: sentinel");
});

test("routes analyze/report/init/run to their handlers (exit 0)", async () => {
  for (const cmd of ["analyze", "report", "init", "run"]) {
    const res = await run([cmd]);
    expect(res.exitCode, `${cmd} should route`).toBe(0);
    expect(res.output).toContain(cmd);
  }
});

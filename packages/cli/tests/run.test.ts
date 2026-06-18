// packages/cli/tests/run.test.ts
import { test, expect } from "@playwright/test";
import {
  runCommand,
  runnerCommand,
  buildRunnerArgs,
} from "../src/commands/run";

test("run --dry-run prints the resolved runner command (exit 0, no spawn)", async () => {
  const res = await runCommand(["--dry-run"]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("npx playwright test -c");
  expect(res.output).toContain("playwright.config.ts"); // default config
});

test("run --dry-run includes a positional test pattern", async () => {
  const res = await runCommand(["tests/auth", "--dry-run"]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("npx playwright test -c");
  expect(res.output.endsWith("tests/auth")).toBe(true);
});

test("run --dry-run honours --config override", async () => {
  const res = await runCommand([
    "--config",
    "custom/pw.config.ts",
    "--dry-run",
  ]);
  expect(res.exitCode).toBe(0);
  expect(res.output).toContain("-c custom/pw.config.ts");
});

test("buildRunnerArgs / runnerCommand construct the expected argv + string", () => {
  expect(buildRunnerArgs("pw.config.ts")).toEqual([
    "playwright",
    "test",
    "-c",
    "pw.config.ts",
  ]);
  expect(buildRunnerArgs("pw.config.ts", "tests/x")).toEqual([
    "playwright",
    "test",
    "-c",
    "pw.config.ts",
    "tests/x",
  ]);
  expect(runnerCommand("pw.config.ts", "tests/x")).toBe(
    "npx playwright test -c pw.config.ts tests/x",
  );
});

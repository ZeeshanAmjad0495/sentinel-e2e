// packages/cli/tests/config.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, DEFAULT_CONFIG } from "../src/config";

test("loadConfig returns defaults when no config file exists", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-cfg-"));
  try {
    const cfg = loadConfig(empty);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    expect(cfg.telemetryDir).toBe("test-results/telemetry");
    expect(cfg.testDir).toBe("tests");
    expect(cfg.runner).toBe("playwright");
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test("loadConfig overrides defaults from a fixture sentinel.config.json", () => {
  const dir = path.join(__dirname, "fixtures");
  const cfg = loadConfig(dir);
  expect(cfg.telemetryDir).toBe("custom/telemetry");
  expect(cfg.testDir).toBe("e2e");
  expect(cfg.playwrightConfig).toBe("config/playwright.config.ts");
});

test("loadConfig fills missing keys with defaults (partial file)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-cfg-"));
  try {
    fs.writeFileSync(
      path.join(dir, "sentinel.config.json"),
      JSON.stringify({ telemetryDir: "only/this" }),
    );
    const cfg = loadConfig(dir);
    expect(cfg.telemetryDir).toBe("only/this");
    expect(cfg.testDir).toBe(DEFAULT_CONFIG.testDir);
    expect(cfg.runner).toBe(DEFAULT_CONFIG.runner);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loadConfig throws a clear error on malformed JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-cfg-"));
  try {
    fs.writeFileSync(path.join(dir, "sentinel.config.json"), "{ not json ");
    expect(() => loadConfig(dir)).toThrow(/invalid sentinel\.config\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

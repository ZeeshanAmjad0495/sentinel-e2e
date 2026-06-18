// packages/cli/tests/init.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initCommand } from "../src/commands/init";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-init-"));
}

test("init scaffolds the starter files into an empty dir (exit 0)", async () => {
  const dir = tmpDir();
  try {
    const res = await initCommand([dir]);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain("Next steps");

    for (const rel of [
      "package.json",
      "sentinel.config.json",
      "playwright.config.ts",
      path.join("tests", "flows", "example.ts"),
      path.join("tests", "example.spec.ts"),
      ".gitignore",
    ]) {
      expect(fs.existsSync(path.join(dir, rel)), `${rel} should exist`).toBe(
        true,
      );
    }

    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies["@sentinel/driver-playwright"]).toBeDefined();
    expect(pkg.scripts.test).toContain("sentinel");

    const cfg = JSON.parse(
      fs.readFileSync(path.join(dir, "sentinel.config.json"), "utf8"),
    ) as { telemetryDir: string };
    expect(cfg.telemetryDir).toBe("test-results/telemetry");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init refuses a non-empty dir without --force (exit 1)", async () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
    const res = await initCommand([dir]);
    expect(res.exitCode).toBe(1);
    expect(res.output.toLowerCase()).toContain("non-empty");
    // the existing file is untouched and no scaffold leaked in
    expect(fs.existsSync(path.join(dir, "existing.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("init --force scaffolds into a non-empty dir (exit 0)", async () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, "existing.txt"), "keep me");
    const res = await initCommand([dir, "--force"]);
    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(path.join(dir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "existing.txt"))).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

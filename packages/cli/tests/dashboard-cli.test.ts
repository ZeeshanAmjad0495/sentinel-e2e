// packages/cli/tests/dashboard-cli.test.ts
// F7/F8: `sentinel report --html <out>` (and the loopback `--serve`) wiring.
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reportCommand } from "../src/commands/report";

const TELEMETRY = path.join(__dirname, "fixtures", "telemetry");

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-html-"));
  return path.join(dir, "dashboard.html");
}

test("report --html writes a self-contained dashboard and gates on real bugs", async () => {
  const out = tmpFile();
  try {
    const res = await reportCommand([TELEMETRY, "--html", out]);

    // the fixture dir contains one real bug -> exit 1 (same gate as text/json).
    expect(res.exitCode).toBe(1);
    // output message is the ABSOLUTE path written.
    expect(res.output).toContain(out);
    expect(path.isAbsolute(res.output.trim().split("\n").pop()!)).toBe(true);

    const html = fs.readFileSync(out, "utf8");
    expect(html).toContain("sentinel-data");
    expect(html).toContain("<!doctype html>");
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

test("report --html with no real bug exits 0", async () => {
  const out = tmpFile();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sentinel-clean-"));
  try {
    // a single healthy run -> no real bug -> exit 0.
    fs.copyFileSync(
      path.join(TELEMETRY, "run-healthy.jsonl"),
      path.join(dir, "run-healthy.jsonl"),
    );
    const res = await reportCommand([dir, "--html", out]);
    expect(res.exitCode).toBe(0);
    expect(fs.readFileSync(out, "utf8")).toContain("sentinel-data");
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("report --json and --html together is an error (exit 2)", async () => {
  const res = await reportCommand([
    TELEMETRY,
    "--json",
    "--html",
    "/tmp/x.html",
  ]);
  expect(res.exitCode).toBe(2);
  expect(res.output.toLowerCase()).toContain("mutually exclusive");
});

test("report --no-detail still writes the rollup data island", async () => {
  const out = tmpFile();
  try {
    const res = await reportCommand([TELEMETRY, "--html", out, "--no-detail"]);
    expect(res.exitCode).toBe(1);
    expect(fs.readFileSync(out, "utf8")).toContain("sentinel-data");
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
});

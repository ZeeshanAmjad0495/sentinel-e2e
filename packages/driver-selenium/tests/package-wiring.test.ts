// packages/driver-selenium/tests/package-wiring.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
// Static import (not dynamic): every package's `main` points at raw src/index.ts,
// so a dynamic bare-specifier import() would resolve untransformed TS and throw.
// A static import is resolved by Playwright's TS loader via tsconfig `paths`.
import * as driverBarrel from "@sentinel/driver-selenium";

test("barrel exposes SeleniumDriver", () => {
  expect(typeof (driverBarrel as Record<string, unknown>).SeleniumDriver).toBe(
    "function",
  );
});

test("package declares selenium-webdriver as a dependency", () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  expect(pkg.dependencies?.["selenium-webdriver"]).toBeTruthy();
});

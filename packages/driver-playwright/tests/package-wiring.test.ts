// packages/driver-playwright/tests/package-wiring.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
// NOTE: static import (not the plan's `await import(...)`). In this TS-source
// workspace, every package's `main` points at raw `src/index.ts`, so a dynamic
// bare-specifier `import()` resolves through the node_modules symlink to
// untransformed TypeScript and throws `SyntaxError: Unexpected token 'export'`.
// A static import is resolved by Playwright's TS loader via the tsconfig `paths`
// mapping (exactly how every @sentinele2e/* import in the repo's tests works), so
// the barrel-export assertion below is unchanged in intent.
import * as driverBarrel from "@sentinele2e/driver-playwright";

test("barrel exposes PlaywrightDriver", () => {
  expect(
    typeof (driverBarrel as Record<string, unknown>).PlaywrightDriver,
  ).toBe("function");
});

test("package declares @playwright/test as a peerDependency", () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    peerDependencies?: Record<string, string>;
  };
  expect(pkg.peerDependencies?.["@playwright/test"]).toBeTruthy();
});

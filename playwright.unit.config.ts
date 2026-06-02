import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "packages/**/tests/**/*.test.ts",
    "examples/**/tests/**/*.test.ts",
  ],
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    headless: true,
  },
});

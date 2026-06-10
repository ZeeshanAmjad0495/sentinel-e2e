# Sentinel Slice A — Core Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@sentinel/core` tool-agnostic spine (driver contracts, result/error taxonomy, telemetry event model, locator engine) plus the Playwright driver, and migrate the existing auth slice onto it with its live defects fixed.

**Architecture:** npm-workspaces monorepo — `@sentinel/contracts` (pure types) ← `@sentinel/core` (result/errors/telemetry/locator) ← `@sentinel/driver-playwright` (the only package importing Playwright). The auth slice lives in `examples/web-erpnext` and consumes the contracts. Every action emits structured telemetry (the seam future AI run-analysis consumes).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, CommonJS, ES2022), Playwright Test 1.60 (also the unit-test runner), ESLint flat config + Prettier + Husky + commitlint, dotenv. Node 22.

**Source spec:** `docs/superpowers/specs/2026-06-01-sentinel-core-spine-design.md` (single source of truth — every task traces to it).

---

## Global conventions (apply to every task)

- **Unit-test runner:** Playwright Test doubles as the unit runner — no new test dependency. Package unit tests live at `packages/<pkg>/tests/**/*.test.ts` and import `{ test, expect } from "@playwright/test"`; a root `playwright.unit.config.ts` matches `packages/**/tests/**/*.test.ts`. Pure-logic tests never request the `page` fixture, so no browser launches; driver tests that need a browser live under `packages/driver-playwright/tests/**`.
- **Lint boundary:** `@playwright/test`/`playwright` are banned outside `packages/driver-playwright/**` and the test-runner dirs (`packages/**/tests/**`, `examples/web-erpnext/tests/**`). App/flow/component code must never import Playwright.
- **TDD loop per task:** write the failing test → run it and confirm the specific failure → write the minimal implementation → run and confirm pass → commit. Pure-type files verify via `npm run typecheck` plus a value/type-level assertion.
- **Commits:** Conventional Commits (commitlint-enforced). Scopes: `core`, `contracts`, `web` (driver-playwright), `repo`, `example`.
- **Sub-step order:** S1 → S2 → S3 → S4 → S5. Each sub-step is independently verifiable against its acceptance gate before the next begins.

---
> Sub-step S1 — Monorepo move + tooling

Convert the flat `erpnext-e2e` package into an npm-workspaces monorepo with four wired-but-empty workspace skeletons, base/solution tsconfigs, an ESLint flat-config boundary ban, `.gitignore` hygiene, and a relocated Playwright config — then `git mv` the existing (un-migrated) auth slice into `examples/web-erpnext` so its tests still resolve and run from the new home. Acceptance: `tsc -b` green, `npm run lint` green (typed rules resolve via `projectService`), and the relocated `smoke.spec.ts` passes from `examples/web-erpnext/tests/`.

### S1 — Task 1: Root `package.json` → workspaces + scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Write the failing assertion — root is not yet a workspace root.** Run this; it must FAIL because there is no `workspaces` field and the name is still `erpnext-e2e`.

```bash
node -e "const p=require('./package.json'); const a=require('assert'); a.deepStrictEqual(p.workspaces,['packages/*','examples/*'],'workspaces missing'); a.strictEqual(p.name,'sentinel-monorepo'); a.strictEqual(p.type,'commonjs'); a.strictEqual(p.private,true); a.strictEqual(p.scripts.typecheck,'tsc -b'); a.strictEqual(p.scripts['test:unit'],'playwright test --config playwright.unit.config.ts'); console.log('OK');"
```

Run: `node -e "..."` (the command above)
Expected: throws `AssertionError [ERR_ASSERTION]: workspaces missing` (non-zero exit).

- [ ] **Step 2: Edit `package.json`** — rename, add `workspaces`, and replace the scripts block. Replace the whole file with:

```json
{
  "name": "sentinel-monorepo",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "typecheck": "tsc -b",
    "test": "playwright test --config examples/web-erpnext/playwright.config.ts",
    "test:unit": "playwright test --config playwright.unit.config.ts",
    "test:all": "npm run test:unit && npm test",
    "test:headed": "playwright test --config examples/web-erpnext/playwright.config.ts --headed",
    "test:ui": "playwright test --config examples/web-erpnext/playwright.config.ts --ui",
    "lint": "eslint . --max-warnings=0",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  },
  "devDependencies": {
    "@commitlint/cli": "^20.4.2",
    "@commitlint/config-conventional": "^20.4.2",
    "@playwright/test": "^1.58.2",
    "@types/node": "^25.3.0",
    "@typescript-eslint/eslint-plugin": "^8.56.1",
    "@typescript-eslint/parser": "^8.56.1",
    "eslint": "^10.0.2",
    "eslint-config-prettier": "^10.1.8",
    "husky": "^9.1.7",
    "lint-staged": "^16.2.7",
    "prettier": "^3.8.1",
    "typescript": "^5.9.3"
  },
  "dependencies": {
    "dotenv": "^17.3.1"
  }
}
```

- [ ] **Step 3: Re-run the assertion — now it PASSES.**

```bash
node -e "const p=require('./package.json'); const a=require('assert'); a.deepStrictEqual(p.workspaces,['packages/*','examples/*'],'workspaces missing'); a.strictEqual(p.name,'sentinel-monorepo'); a.strictEqual(p.type,'commonjs'); a.strictEqual(p.private,true); a.strictEqual(p.scripts.typecheck,'tsc -b'); a.strictEqual(p.scripts['test:unit'],'playwright test --config playwright.unit.config.ts'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add package.json
git commit -m "chore(repo): convert root package to npm workspaces"
```

Run: `git commit -m "chore(repo): convert root package to npm workspaces"`
Expected: commit-msg hook passes commitlint; one commit recorded.

---

### S1 — Task 2: `tsconfig.base.json` with explicit `@sentinel/*` paths

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Write the failing assertion — base config does not exist yet.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('tsconfig.base.json'),'tsconfig.base.json missing'); const c=JSON.parse(fs.readFileSync('tsconfig.base.json','utf8').replace(/\/\/.*$/gm,'')); const o=c.compilerOptions; a.strictEqual(o.strict,true); a.strictEqual(o.noUncheckedIndexedAccess,true); a.strictEqual(o.module,'CommonJS'); a.strictEqual(o.target,'ES2022'); a.deepStrictEqual(o.paths['@sentinel/core'],['packages/core/src/index.ts']); a.deepStrictEqual(o.paths['@sentinel/contracts/*'],['packages/contracts/src/*']); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: tsconfig.base.json missing` (non-zero exit).

- [ ] **Step 2: Create `tsconfig.base.json`** with the EXACT `paths` block from spec §2:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "baseUrl": ".",
    "paths": {
      "@sentinel/contracts": ["packages/contracts/src/index.ts"],
      "@sentinel/contracts/*": ["packages/contracts/src/*"],
      "@sentinel/core": ["packages/core/src/index.ts"],
      "@sentinel/core/*": ["packages/core/src/*"],
      "@sentinel/driver-playwright": ["packages/driver-playwright/src/index.ts"],
      "@sentinel/driver-playwright/*": ["packages/driver-playwright/src/*"]
    }
  }
}
```

- [ ] **Step 3: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('tsconfig.base.json'),'tsconfig.base.json missing'); const c=JSON.parse(fs.readFileSync('tsconfig.base.json','utf8').replace(/\/\/.*$/gm,'')); const o=c.compilerOptions; a.strictEqual(o.strict,true); a.strictEqual(o.noUncheckedIndexedAccess,true); a.strictEqual(o.module,'CommonJS'); a.strictEqual(o.target,'ES2022'); a.deepStrictEqual(o.paths['@sentinel/core'],['packages/core/src/index.ts']); a.deepStrictEqual(o.paths['@sentinel/contracts/*'],['packages/contracts/src/*']); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Commit.**

```bash
git add tsconfig.base.json
git commit -m "chore(repo): add tsconfig.base with sentinel paths"
```

Run: `git commit -m "chore(repo): add tsconfig.base with sentinel paths"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 3: `@sentinel/contracts` skeleton

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`

- [ ] **Step 1: Write the failing assertion — package does not exist.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/contracts/package.json'); a.strictEqual(p.name,'@sentinel/contracts'); const t=JSON.parse(fs.readFileSync('packages/contracts/tsconfig.json','utf8')); a.strictEqual(t.compilerOptions.composite,true); a.ok(fs.existsSync('packages/contracts/src/index.ts')); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `Cannot find module './packages/contracts/package.json'` (non-zero exit).

- [ ] **Step 2: Create `packages/contracts/package.json`** (zero runtime deps — pure types):

```json
{
  "name": "@sentinel/contracts",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 3: Create `packages/contracts/tsconfig.json`** (extends base, composite, no references — it has no deps):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `packages/contracts/src/index.ts`** (trivial seed so `tsc -b` is green):

```ts
export {};
```

- [ ] **Step 5: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/contracts/package.json'); a.strictEqual(p.name,'@sentinel/contracts'); const t=JSON.parse(fs.readFileSync('packages/contracts/tsconfig.json','utf8')); a.strictEqual(t.compilerOptions.composite,true); a.ok(fs.existsSync('packages/contracts/src/index.ts')); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 6: Commit.**

```bash
git add packages/contracts
git commit -m "feat(contracts): add @sentinel/contracts package skeleton"
```

Run: `git commit -m "feat(contracts): add @sentinel/contracts package skeleton"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 4: `@sentinel/core` skeleton (refs contracts)

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing assertion — package does not exist.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/core/package.json'); a.strictEqual(p.name,'@sentinel/core'); a.strictEqual(p.dependencies['@sentinel/contracts'],'*'); const t=JSON.parse(fs.readFileSync('packages/core/tsconfig.json','utf8')); a.deepStrictEqual(t.references,[{path:'../contracts'}]); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `Cannot find module './packages/core/package.json'` (non-zero exit).

- [ ] **Step 2: Create `packages/core/package.json`** (depends ONLY on contracts via workspace ref):

```json
{
  "name": "@sentinel/core",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@sentinel/contracts": "*"
  }
}
```

- [ ] **Step 3: Create `packages/core/tsconfig.json`** (composite + reference to contracts):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "references": [{ "path": "../contracts" }],
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `packages/core/src/index.ts`** seed:

```ts
export {};
```

- [ ] **Step 5: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/core/package.json'); a.strictEqual(p.name,'@sentinel/core'); a.strictEqual(p.dependencies['@sentinel/contracts'],'*'); const t=JSON.parse(fs.readFileSync('packages/core/tsconfig.json','utf8')); a.deepStrictEqual(t.references,[{path:'../contracts'}]); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 6: Commit.**

```bash
git add packages/core
git commit -m "feat(core): add @sentinel/core package skeleton"
```

Run: `git commit -m "feat(core): add @sentinel/core package skeleton"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 5: `@sentinel/driver-playwright` skeleton (refs contracts + core)

**Files:**
- Create: `packages/driver-playwright/package.json`
- Create: `packages/driver-playwright/tsconfig.json`
- Create: `packages/driver-playwright/src/index.ts`

- [ ] **Step 1: Write the failing assertion — package does not exist.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/driver-playwright/package.json'); a.strictEqual(p.name,'@sentinel/driver-playwright'); a.strictEqual(p.dependencies['@sentinel/core'],'*'); a.strictEqual(p.dependencies['@sentinel/contracts'],'*'); const t=JSON.parse(fs.readFileSync('packages/driver-playwright/tsconfig.json','utf8')); a.deepStrictEqual(t.references,[{path:'../contracts'},{path:'../core'}]); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `Cannot find module './packages/driver-playwright/package.json'` (non-zero exit).

- [ ] **Step 2: Create `packages/driver-playwright/package.json`** (the ONLY package allowed `@playwright/test`):

```json
{
  "name": "@sentinel/driver-playwright",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@sentinel/contracts": "*",
    "@sentinel/core": "*"
  },
  "peerDependencies": {
    "@playwright/test": "^1.58.2"
  }
}
```

- [ ] **Step 3: Create `packages/driver-playwright/tsconfig.json`** (composite + references to contracts & core):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node", "@playwright/test"]
  },
  "references": [{ "path": "../contracts" }, { "path": "../core" }],
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `packages/driver-playwright/src/index.ts`** seed:

```ts
export {};
```

- [ ] **Step 5: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./packages/driver-playwright/package.json'); a.strictEqual(p.name,'@sentinel/driver-playwright'); a.strictEqual(p.dependencies['@sentinel/core'],'*'); a.strictEqual(p.dependencies['@sentinel/contracts'],'*'); const t=JSON.parse(fs.readFileSync('packages/driver-playwright/tsconfig.json','utf8')); a.deepStrictEqual(t.references,[{path:'../contracts'},{path:'../core'}]); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 6: Commit.**

```bash
git add packages/driver-playwright
git commit -m "feat(web): add @sentinel/driver-playwright package skeleton"
```

Run: `git commit -m "feat(web): add @sentinel/driver-playwright package skeleton"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 6: `examples/web-erpnext` skeleton (refs all three, own `baseUrl`)

**Files:**
- Create: `examples/web-erpnext/package.json`
- Create: `examples/web-erpnext/tsconfig.json`
- Create: `examples/web-erpnext/src/index.ts`

- [ ] **Step 1: Write the failing assertion — example does not exist; CRITICAL its tsconfig keeps `baseUrl:"."` so the old `src/...` imports resolve from the example root.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./examples/web-erpnext/package.json'); a.strictEqual(p.name,'@sentinel/example-web-erpnext'); a.strictEqual(p.private,true); a.strictEqual(p.dependencies['@sentinel/driver-playwright'],'*'); const t=JSON.parse(fs.readFileSync('examples/web-erpnext/tsconfig.json','utf8')); a.strictEqual(t.compilerOptions.baseUrl,'.'); a.deepStrictEqual(t.references,[{path:'../../packages/contracts'},{path:'../../packages/core'},{path:'../../packages/driver-playwright'}]); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `Cannot find module './examples/web-erpnext/package.json'` (non-zero exit).

- [ ] **Step 2: Create `examples/web-erpnext/package.json`** (private; refs all three packages + dotenv; keeps `@playwright/test` available for the test runner):

```json
{
  "name": "@sentinel/example-web-erpnext",
  "version": "0.0.0",
  "private": true,
  "dependencies": {
    "@sentinel/contracts": "*",
    "@sentinel/core": "*",
    "@sentinel/driver-playwright": "*",
    "dotenv": "^17.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.58.2"
  }
}
```

- [ ] **Step 3: Create `examples/web-erpnext/tsconfig.json`** — extends base, BUT re-declares `baseUrl: "."` so `import { env } from "src/config/env"` / `import { LogInPage } from "src/ui"` keep resolving from the example root unchanged. Composite + references to all three packages. Includes `src`, `tests`, and the playwright config.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": ".",
    "outDir": "dist",
    "types": ["node", "@playwright/test"]
  },
  "references": [
    { "path": "../../packages/contracts" },
    { "path": "../../packages/core" },
    { "path": "../../packages/driver-playwright" }
  ],
  "include": ["src/**/*.ts", "tests/**/*.ts", "playwright.config.ts"]
}
```

- [ ] **Step 4: Create `examples/web-erpnext/src/index.ts`** seed (temporary; replaced by the moved tree in Task 12):

```ts
export {};
```

- [ ] **Step 5: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const p=require('./examples/web-erpnext/package.json'); a.strictEqual(p.name,'@sentinel/example-web-erpnext'); a.strictEqual(p.private,true); a.strictEqual(p.dependencies['@sentinel/driver-playwright'],'*'); const t=JSON.parse(fs.readFileSync('examples/web-erpnext/tsconfig.json','utf8')); a.strictEqual(t.compilerOptions.baseUrl,'.'); a.deepStrictEqual(t.references,[{path:'../../packages/contracts'},{path:'../../packages/core'},{path:'../../packages/driver-playwright'}]); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 6: Commit.**

```bash
git add examples/web-erpnext
git commit -m "feat(example): add web-erpnext example workspace skeleton"
```

Run: `git commit -m "feat(example): add web-erpnext example workspace skeleton"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 7: Solution-style root `tsconfig.json` (references-only)

**Files:**
- Modify: `tsconfig.json`

- [ ] **Step 1: Write the failing assertion — root tsconfig is still the old flat config (has `include`/`compilerOptions`, no `references`).**

```bash
node -e "const fs=require('fs'),a=require('assert'); const t=JSON.parse(fs.readFileSync('tsconfig.json','utf8')); a.deepStrictEqual(t.files,[],'files must be empty array'); a.ok(Array.isArray(t.references) && t.references.length===4,'must reference 4 projects'); a.ok(!t.include,'include must be absent'); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: files must be empty array` (non-zero exit).

- [ ] **Step 2: Replace `tsconfig.json`** with a solution-style root that includes NO files (so the typed-lint `projectService` is the only thing resolving project membership) and references every project:

```json
{
  "files": [],
  "references": [
    { "path": "packages/contracts" },
    { "path": "packages/core" },
    { "path": "packages/driver-playwright" },
    { "path": "examples/web-erpnext" }
  ]
}
```

- [ ] **Step 3: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const t=JSON.parse(fs.readFileSync('tsconfig.json','utf8')); a.deepStrictEqual(t.files,[],'files must be empty array'); a.ok(Array.isArray(t.references) && t.references.length===4,'must reference 4 projects'); a.ok(!t.include,'include must be absent'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Install workspaces + build the project graph end-to-end.** This wires the workspace symlinks and proves the four empty-but-seeded projects compile under `strict` + `noUncheckedIndexedAccess` (the S1 `tsc -b` acceptance gate). (Note: at this point the old flat `src/`/`tests/` still exist at root but are NOT in any project's `include`, so they are not type-checked yet — they move in Task 12.)

```bash
npm install && npm run typecheck
```

Run: `npm install && npm run typecheck`
Expected: install completes; `tsc -b` exits 0 with no errors (builds contracts → core → driver-playwright → example).

- [ ] **Step 5: Commit.**

```bash
git add tsconfig.json package-lock.json
git commit -m "chore(repo): make root tsconfig solution-style references-only"
```

Run: `git commit -m "chore(repo): make root tsconfig solution-style references-only"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 8: ESLint flat config — `projectService` + boundary ban

**Files:**
- Modify: `eslint.config.cjs`

- [ ] **Step 1: Write the failing assertion — config still uses `parserOptions.project` and has no `no-restricted-imports` ban.** Loading the flat config and inspecting it must FAIL.

```bash
node -e "const c=require('./eslint.config.cjs'),a=require('assert'); const txt=require('fs').readFileSync('eslint.config.cjs','utf8'); a.ok(txt.includes('projectService: true'),'projectService not set'); a.ok(!txt.includes(\"project: './tsconfig.json'\"),'old project option still present'); a.ok(txt.includes('no-restricted-imports'),'ban missing'); a.ok(txt.includes('packages/driver-playwright/**'),'driver exemption missing'); a.ok(txt.includes('examples/web-erpnext/tests/**'),'example test exemption missing'); a.ok(txt.includes('packages/**/tests/**'),'package test exemption missing'); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: projectService not set` (non-zero exit).

- [ ] **Step 2: Replace `eslint.config.cjs`** — switch the typed parser to `projectService: true`, then add the TWO ordered `no-restricted-imports` entries (global ban first, exemption for the three test-runner/driver dirs last; last match wins):

```js
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Core correctness
      'no-console': 'off',
      'no-debugger': 'error',

      // TypeScript best-practices (strict but sane)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],

      // Style kept mostly to Prettier; don't fight formatting in ESLint.
    },
  },
  {
    // SEAM boundary: app/flow/component code must not import Playwright.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
            {
              name: 'playwright',
              message:
                'Playwright is confined to @sentinel/driver-playwright and test-runner dirs.',
            },
          ],
        },
      ],
    },
  },
  {
    // Exemption (last match wins): the driver adapter + all test-runner dirs.
    files: [
      'packages/driver-playwright/**/*.ts',
      'packages/**/tests/**',
      'examples/web-erpnext/tests/**',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
];
```

- [ ] **Step 3: Re-run the assertion — now it PASSES.**

```bash
node -e "const c=require('./eslint.config.cjs'),a=require('assert'); const txt=require('fs').readFileSync('eslint.config.cjs','utf8'); a.ok(txt.includes('projectService: true'),'projectService not set'); a.ok(!txt.includes(\"project: './tsconfig.json'\"),'old project option still present'); a.ok(txt.includes('no-restricted-imports'),'ban missing'); a.ok(txt.includes('packages/driver-playwright/**'),'driver exemption missing'); a.ok(txt.includes('examples/web-erpnext/tests/**'),'example test exemption missing'); a.ok(txt.includes('packages/**/tests/**'),'package test exemption missing'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Run lint on the wired-but-empty tree — typed rules must resolve via `projectService`.**

```bash
npm run lint
```

Run: `npm run lint`
Expected: exits 0, no warnings/errors (the seeded `export {}` files trigger no rule; typed rules resolve with no "file not included in any project" parser error).

- [ ] **Step 5: Commit.**

```bash
git add eslint.config.cjs
git commit -m "chore(repo): switch eslint to projectService and ban playwright imports"
```

Run: `git commit -m "chore(repo): switch eslint to projectService and ban playwright imports"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 9: `.gitignore` hygiene

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing assertion — VCS ignore lacks `test-results/` and `playwright-report/`.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const g=fs.readFileSync('.gitignore','utf8').split(/\r?\n/); a.ok(g.includes('test-results/'),'test-results/ not ignored'); a.ok(g.includes('playwright-report/'),'playwright-report/ not ignored'); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: test-results/ not ignored` (non-zero exit).

- [ ] **Step 2: Append the two entries to `.gitignore`** (add these lines at the end of the file):

```gitignore
# Playwright + Sentinel telemetry output
test-results/
playwright-report/
```

- [ ] **Step 3: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); const g=fs.readFileSync('.gitignore','utf8').split(/\r?\n/); a.ok(g.includes('test-results/'),'test-results/ not ignored'); a.ok(g.includes('playwright-report/'),'playwright-report/ not ignored'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Remove the already-tracked `test-results/` artifact so the ignore takes effect, then commit.** (`test-results/.last-run.json` is currently tracked.)

```bash
git rm -r --cached --ignore-unmatch test-results
git add .gitignore
git commit -m "chore(repo): gitignore test-results and playwright-report"
```

Run: `git commit -m "chore(repo): gitignore test-results and playwright-report"`
Expected: commitlint passes; the stale `test-results/.last-run.json` is untracked; commit recorded.

---

### S1 — Task 10: Root `playwright.unit.config.ts` (unit runner)

**Files:**
- Create: `playwright.unit.config.ts`

- [ ] **Step 1: Write the failing test — a placeholder unit test in a package, run via the not-yet-existing unit config, must fail to find a config.** First create the probe test file so the runner has something to discover:

```ts
// packages/core/tests/skeleton.test.ts
import { test, expect } from "@playwright/test";

test("core skeleton package is wired", () => {
  expect(1 + 1).toBe(2);
});
```

Then run:

```bash
npm run test:unit
```

Run: `npm run test:unit`
Expected: FAILS — Playwright errors with `Error: Can't read config file ... playwright.unit.config.ts` (file does not exist; non-zero exit).

- [ ] **Step 2: Create `playwright.unit.config.ts`** (per conventions: `testDir:"."`, glob the package tests, headless, no baseURL, no browser unless a test requests `page`):

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "packages/**/tests/**/*.test.ts",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  use: {
    headless: true,
  },
});
```

- [ ] **Step 3: Re-run — the pure-logic test now PASSES with no browser launch.**

```bash
npm run test:unit
```

Run: `npm run test:unit`
Expected: `1 passed` — `packages/core/tests/skeleton.test.ts` runs green; no browser binary required (test does not request the `page` fixture).

- [ ] **Step 4: Commit.**

```bash
git add playwright.unit.config.ts packages/core/tests/skeleton.test.ts
git commit -m "test(core): add unit runner config and skeleton package test"
```

Run: `git commit -m "test(core): add unit runner config and skeleton package test"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 11: Relocate the Playwright e2e config under the example

**Files:**
- Create: `examples/web-erpnext/playwright.config.ts` (moved from root)
- Delete: `playwright.config.ts` (root)

- [ ] **Step 1: Write the failing assertion — the e2e config is still at the root, not under the example, and root `npm test` points at the new path which does not exist yet.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('examples/web-erpnext/playwright.config.ts'),'config not relocated'); a.ok(!fs.existsSync('playwright.config.ts'),'root config still present'); const c=fs.readFileSync('examples/web-erpnext/playwright.config.ts','utf8'); a.ok(c.includes('testDir: \"./tests\"'),'testDir wrong'); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: config not relocated` (non-zero exit).

- [ ] **Step 2: `git mv` the config into the example, preserving history.**

```bash
git mv playwright.config.ts examples/web-erpnext/playwright.config.ts
```

Run: `git mv playwright.config.ts examples/web-erpnext/playwright.config.ts`
Expected: file is staged as a rename; no output on success.

- [ ] **Step 3: Replace the moved `examples/web-erpnext/playwright.config.ts`** so `testDir` stays `"./tests"` (now relative to the example) and the `env` import resolves from the example `baseUrl` (`src/config/env`). Content:

```ts
import { defineConfig } from "@playwright/test";
import { env } from "src/config/env";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: env.baseUrl,
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  fullyParallel: true,
});
```

- [ ] **Step 4: Re-run the assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('examples/web-erpnext/playwright.config.ts'),'config not relocated'); a.ok(!fs.existsSync('playwright.config.ts'),'root config still present'); const c=fs.readFileSync('examples/web-erpnext/playwright.config.ts','utf8'); a.ok(c.includes('testDir: \"./tests\"'),'testDir wrong'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 5: Commit.** (The `env` import will resolve once the config tree is moved in Task 12; do not run the e2e suite yet — `examples/web-erpnext/tests/` and `src/config/env` arrive next task.)

```bash
git add examples/web-erpnext/playwright.config.ts
git commit -m "chore(example): relocate playwright e2e config under web-erpnext"
```

Run: `git commit -m "chore(example): relocate playwright e2e config under web-erpnext"`
Expected: commitlint passes; commit recorded.

---

### S1 — Task 12: `git mv` the existing auth tree into the example

**Files:**
- Move: `src/**` → `examples/web-erpnext/src/**`
- Move: `tests/**` → `examples/web-erpnext/tests/**`
- Delete: temporary `examples/web-erpnext/src/index.ts` seed (replaced by the real moved tree)

- [ ] **Step 1: Write the failing assertion — the auth slice is still at the repo root, not under the example.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('examples/web-erpnext/src/flows/auth/log-in.ts'),'flow not moved'); a.ok(fs.existsSync('examples/web-erpnext/tests/smoke.spec.ts'),'smoke not moved'); a.ok(fs.existsSync('examples/web-erpnext/src/config/env.ts'),'env not moved'); a.ok(!fs.existsSync('src/flows/auth/log-in.ts'),'old flow still at root'); console.log('OK');"
```

Run: `node -e "..."` (above)
Expected: throws `AssertionError [ERR_ASSERTION]: flow not moved` (non-zero exit).

- [ ] **Step 2: Remove the temporary seed, then `git mv` the whole `src/` and `tests/` trees under the example** (history-preserving move; the old `src/...` baseUrl imports keep resolving because the example tsconfig sets `baseUrl:"."`):

```bash
git rm examples/web-erpnext/src/index.ts
git mv src/config examples/web-erpnext/src/config
git mv src/core examples/web-erpnext/src/core
git mv src/domain examples/web-erpnext/src/domain
git mv src/flows examples/web-erpnext/src/flows
git mv src/selectors examples/web-erpnext/src/selectors
git mv src/ui examples/web-erpnext/src/ui
git mv src/index.ts examples/web-erpnext/src/index.ts
git mv tests examples/web-erpnext/tests
```

Run: the eight `git mv` commands above (plus the `git rm`)
Expected: each stages a rename with no output; `src/` and root `tests/` no longer exist; `examples/web-erpnext/src` + `examples/web-erpnext/tests` now hold the full tree.

- [ ] **Step 3: Re-run the move assertion — now it PASSES.**

```bash
node -e "const fs=require('fs'),a=require('assert'); a.ok(fs.existsSync('examples/web-erpnext/src/flows/auth/log-in.ts'),'flow not moved'); a.ok(fs.existsSync('examples/web-erpnext/tests/smoke.spec.ts'),'smoke not moved'); a.ok(fs.existsSync('examples/web-erpnext/src/config/env.ts'),'env not moved'); a.ok(!fs.existsSync('src/flows/auth/log-in.ts'),'old flow still at root'); console.log('OK');"
```

Run: `node -e "..."` (same command)
Expected: prints `OK` (exit 0).

- [ ] **Step 4: Typecheck the whole graph including the relocated tree.** The example tsconfig now compiles the moved `src/**`/`tests/**` under `strict` + `noUncheckedIndexedAccess`; the `src/...` baseUrl imports resolve from the example root.

```bash
npm run typecheck
```

Run: `npm run typecheck`
Expected: `tsc -b` exits 0 — all four projects build, including the moved auth slice (still the OLD Playwright-coupled version; its rewrite is S4).

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "refactor(example): move auth slice into web-erpnext workspace"
```

Run: `git commit -m "refactor(example): move auth slice into web-erpnext workspace"`
Expected: commitlint passes; commit recorded (renames preserved).

---

### S1 — Task 13: Verify S1 acceptance — lint, typecheck, relocated smoke green

**Files:**
- (no file changes — verification + final commit of any formatting)

- [ ] **Step 1: Run the full static-analysis gate.** Both must be green: `projectService` resolves typed rules across `packages/**` + `examples/**`; the `no-restricted-imports` ban reports no `@playwright/test` import outside the driver + test-runner dirs (the moved app/flow/component code still imports `@playwright/test` in the OLD version — confirm those files live ONLY where the exemption or driver allows, OR that lint flags them so S4 is forced to fix them).

```bash
npm run typecheck && npm run lint
```

Run: `npm run typecheck && npm run lint`
Expected: `tsc -b` exits 0. NOTE: `npm run lint` is EXPECTED to report `no-restricted-imports` errors on the still-un-migrated app/flow/component files (`examples/web-erpnext/src/flows/auth/log-in.ts`, `src/ui/...`, `src/ui/components/...`) because they import `@playwright/test` outside the exemption. This is the intended boundary signal that S4 must resolve. If you require a green `lint` for the S1 gate, add a TEMPORARY scoped exemption (see Step 2); otherwise record the expected violation list and proceed.

- [ ] **Step 2: (Gate decision) Make `npm run lint` green for S1 by scoping a temporary migration exemption for the un-migrated example app code.** Per the global conventions the S1 acceptance is "`lint` green"; since the moved code is still the OLD Playwright-coupled version (rewrite deferred to S4), add a clearly-labelled temporary exemption block to `eslint.config.cjs` (placed BEFORE the final `eslintConfigPrettier`, AFTER the existing exemption block) so app code lints clean now and S4 deletes this block when it removes the Playwright coupling:

```js
  {
    // TEMPORARY (S1 → removed in S4): the migrated auth slice is still the
    // OLD Playwright-coupled version. Its rewrite onto @sentinel/driver-playwright
    // happens in S4, which deletes this block. Until then, exempt the moved
    // app/flow/component code from the Playwright import ban.
    files: ['examples/web-erpnext/src/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
```

Insert it immediately after the existing test/driver exemption object and before `eslintConfigPrettier`.

- [ ] **Step 3: Re-run the gate — both green now.**

```bash
npm run typecheck && npm run lint
```

Run: `npm run typecheck && npm run lint`
Expected: `tsc -b` exits 0; `eslint . --max-warnings=0` exits 0 with no errors/warnings.

- [ ] **Step 4: Run the relocated smoke spec from its new home — the S1 e2e acceptance (hits example.com, needs no live ERPNext app, but does load `playwright.config.ts` which imports `src/config/env`, so provide the three env vars).** Playwright's TS loader honors the example tsconfig `paths`/`baseUrl`.

```bash
npx playwright install chromium && BASE_URL=https://example.com ADMIN_USER=x ADMIN_PASSWORD=x npm test -- smoke.spec.ts
```

Run: `BASE_URL=https://example.com ADMIN_USER=x ADMIN_PASSWORD=x npm test -- smoke.spec.ts`
Expected: `1 passed` — `examples/web-erpnext/tests/smoke.spec.ts` ("basic smoke") goes green; the `env` import resolves (vars supplied), config loads via the relocated path, and the test asserts `example.com` title. (The auth specs need a live app and are NOT part of the S1 gate.)

- [ ] **Step 5: Commit the gate fix.**

```bash
git add eslint.config.cjs
git commit -m "chore(repo): temp-exempt un-migrated example app from playwright ban"
```

Run: `git commit -m "chore(repo): temp-exempt un-migrated example app from playwright ban"`
Expected: commitlint passes; commit recorded. S1 acceptance met: `tsc -b` green, `npm run lint` green, relocated `smoke.spec.ts` passing from its new home.


I have authored the complete S1 plan fragment above. Here is a summary of what I produced and the key grounding decisions, since this output is returned to the calling script.

## Summary

I wrote the full set of 13 bite-sized TDD tasks for sub-step **S1 — Monorepo move + tooling**, emitted as a markdown fragment in the required format (one-line `> Sub-step S1` header + 2-sentence summary, then `### S1 — Task N:` headings, `**Files:**` blocks, and `- [ ]` checkbox steps with fenced code, `Run:`/`Expected:` lines, and a Conventional-Commit step per task).

### Task breakdown
1. Root `package.json` → workspaces, `sentinel-monorepo` name, scripts per conventions
2. `tsconfig.base.json` with the EXACT spec §2 `paths` block
3–6. The four workspace skeletons (`contracts`, `core`, `driver-playwright`, `examples/web-erpnext`) with package.json + composite tsconfig + `export {}` seed
7. Solution-style references-only root `tsconfig.json` + first `tsc -b` green gate
8. ESLint flat config: `projectService: true` + two ordered `no-restricted-imports` entries
9. `.gitignore` additions (`test-results/`, `playwright-report/`)
10. Root `playwright.unit.config.ts` (unit runner)
11. Relocate the Playwright e2e config to `examples/web-erpnext/`
12. `git mv` the auth tree into the example
13. S1 acceptance verification (lint + typecheck + relocated `smoke.spec.ts`)

### Key grounding findings that shaped the plan
- **commitlint** (`commitlint.config.cjs`) restricts types to `feat|fix|refactor|test|chore|docs` and bans sentence/start/pascal-case subjects — every commit message I wrote conforms (lowercase, allowed type, conventions' scopes core/contracts/web/repo/example).
- The old auth tree uses **`src/...` baseUrl imports** (`src/selectors`, `src/domain/auth`, `src/ui`, `src/flows`, `src/config/env`) confirmed across `log-in.ts`, `log-in-page.ts`, `log-in-form.ts`, `playwright.config.ts`, and the fixtures — so the example tsconfig sets its own `baseUrl: "."` to keep them resolving unchanged. The specs also use relative `../../src/flows`, which also resolves post-move.
- `test-results/.last-run.json` is **already tracked**, so Task 9 includes `git rm --cached` to make the new ignore effective.
- **Important nuance surfaced (Task 13):** the moved auth code is still the OLD `@playwright/test`-coupled version (its rewrite is S4). The new `no-restricted-imports` ban will flag `examples/web-erpnext/src/**` app/flow/component files. Since the global conventions require **`lint` green** as the S1 gate, I added a clearly-labelled TEMPORARY `eslint.config.cjs` exemption for `examples/web-erpnext/src/**/*.ts` that S4 deletes when it removes the Playwright coupling. This is the one judgment call needed to reconcile "lint green" with "code moved but not yet rewritten."
- **Verification fidelity:** node v22.22.2 / npm 10.9.7 confirmed; deps are NOT yet installed (no `node_modules/.bin`), so Task 7 includes `npm install` before the first `tsc -b`. The smoke gate supplies `BASE_URL/ADMIN_USER/ADMIN_PASSWORD` because the relocated `playwright.config.ts` imports `src/config/env`, which throws on missing vars even for the example.com smoke test.

Relevant files I read to ground the tasks: `/Users/zeeshan.amjad/Documents/sentinel-e2e/package.json`, `/tsconfig.json`, `/eslint.config.cjs`, `/playwright.config.ts`, `/.gitignore`, `/commitlint.config.cjs`, `/src/flows/auth/log-in.ts`, `/src/ui/pages/log-in-page.ts`, `/src/ui/components/log-in-form/log-in-form.ts`, `/src/config/env.ts`, `/tests/smoke.spec.ts`, `/tests/auth/log-in.spec.ts`, `/tests/_support/fixtures/{auth,test}.ts`.

---

> Sub-step S2 — `@sentinel/contracts` + `@sentinel/core` types

This sub-step authors the two pure-TypeScript framework packages: `@sentinel/contracts` (driver-agnostic interfaces, zero runtime deps) and `@sentinel/core` (result factories, the system-failure error taxonomy, the telemetry event/sink/span model with `JsonlSink`, and the locator `StrategyRegistry` + engine interfaces). Every behavior is driven test-first with Playwright-runner unit tests under `packages/contracts/tests/**` and `packages/core/tests/**`; no driver code is written here.

> **Preconditions (from S1):** the workspace is wired — `packages/contracts/{package.json,tsconfig.json}` and `packages/core/{package.json,tsconfig.json}` exist with `composite:true` and the `@sentinel/*` `paths`/`references` from spec §2; the root `playwright.unit.config.ts` (`testDir:"."`, `testMatch:"packages/**/tests/**/*.test.ts"`, headless, no `baseURL`) exists; root scripts `typecheck`/`test:unit` exist; the ESLint `no-restricted-imports` exemption already covers `packages/**/tests/**`. S2 only adds `src/**` and `tests/**` files inside the two packages.

### S2 — Task 1: Contracts — capability + locator + element types

**Files:**
- Create: `packages/contracts/src/capability.ts`
- Create: `packages/contracts/src/locator.ts`
- Create: `packages/contracts/src/element.ts`
- Create: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/capability-locator.test.ts`

- [ ] **Step 1: Write the failing compile-level test.** This constructs conforming `Capability`, `LocatorStrategy`, `Locator`, and `ElementHandle` values; it fails first because the modules do not exist yet.

  ```ts
  // packages/contracts/tests/capability-locator.test.ts
  import { test, expect } from "@playwright/test";
  import type {
    Capability,
    CapabilityProbe,
    StrategyKind,
    LocatorStrategy,
    Locator,
    ElementHandle,
  } from "@sentinel/contracts";

  test("Capability values are the documented union members", () => {
    const caps: Capability[] = [
      "navigation",
      "dom",
      "accessibilityTree",
      "gestures",
      "contexts",
      "screenshot",
      "networkInspection",
    ];
    expect(caps).toHaveLength(7);
  });

  test("CapabilityProbe shape is satisfiable", () => {
    const probe: CapabilityProbe = {
      supports: (cap: Capability) => cap === "dom",
      require: () => {},
    };
    expect(probe.supports("dom")).toBe(true);
    expect(probe.supports("gestures")).toBe(false);
  });

  test("StrategyKind is an open string and LocatorStrategy carries kind/value/options", () => {
    const kind: StrategyKind = "-ios predicate string";
    const strat: LocatorStrategy = {
      kind,
      value: "type == 'XCUIElementTypeButton'",
      options: { exact: true },
    };
    expect(strat.kind).toBe("-ios predicate string");
    expect(strat.options?.exact).toBe(true);
  });

  test("Locator carries logicalName, ordered candidates and within()", () => {
    const child: Locator = {
      logicalName: "auth.login.submit",
      candidates: [
        { kind: "role", value: "button", options: { name: "Login" } },
        { kind: "css", value: "button.btn-login[type='submit']" },
      ],
      within(parent: Locator): Locator {
        return { ...this, logicalName: `${parent.logicalName}>${this.logicalName}` };
      },
    };
    const parent: Locator = { logicalName: "auth.card", candidates: [], within: child.within };
    expect(child.candidates[0]?.kind).toBe("role");
    expect(child.within(parent).logicalName).toBe("auth.card>auth.login.submit");
  });

  test("ElementHandle is satisfiable", async () => {
    const handle: ElementHandle = {
      locator: { logicalName: "x", candidates: [], within: (p) => p },
      exists: async () => true,
      isVisible: async () => true,
      isEnabled: async () => false,
      text: async () => "hi",
      attribute: async () => null,
    };
    expect(await handle.exists()).toBe(true);
    expect(await handle.attribute("id")).toBeNull();
  });
  ```

  ```bash
  npm run test:unit -- packages/contracts/tests/capability-locator.test.ts
  ```
  Run: `npm run test:unit -- packages/contracts/tests/capability-locator.test.ts`
  Expected: fails — `Error: Cannot find module '@sentinel/contracts'` (or `Cannot find package '@sentinel/contracts'`).

- [ ] **Step 2: Author `capability.ts`** (copied verbatim from spec §3.1).

  ```ts
  // packages/contracts/src/capability.ts
  export type Capability =
    | "navigation" // URL + back/forward .......... web / mobile-webview
    | "dom" // a document tree ............. web
    | "accessibilityTree" // getByRole semantics ......... web
    | "gestures" // swipe/scroll/pinch/long-press  mobile-native
    | "contexts" // NATIVE_APP <-> WEBVIEW ....... mobile
    | "screenshot"
    | "networkInspection";

  export interface CapabilityProbe {
    supports(cap: Capability): boolean;
    /** Loud, typed gate. Throws CapabilityUnsupportedError (a SystemFailureError) if absent. */
    require(cap: Capability): void;
  }
  ```

- [ ] **Step 3: Author `locator.ts`** (spec §3.2).

  ```ts
  // packages/contracts/src/locator.ts
  export type StrategyKind = string; // "role" | "label" | "text" | "testid" | "css" | "xpath" | "-ios predicate string" ...

  export interface LocatorStrategy {
    readonly kind: StrategyKind;
    readonly value: string; // role name / testid / css / predicate
    readonly options?: Readonly<Record<string, string | number | boolean>>; // strategy-scoped; {name,exact} only meaningful to role/label
  }

  export interface Locator {
    readonly logicalName: string; // STABLE id, "auth.login.submit" — the drift anchor
    readonly candidates: readonly LocatorStrategy[]; // ordered most-durable -> css/xpath fallback
    readonly minScore?: number; // accept threshold; default 1.0 in Slice A (binary)
    within(parent: Locator): Locator; // scoping/chaining
  }
  ```

- [ ] **Step 4: Author `element.ts`** (spec §3.3).

  ```ts
  // packages/contracts/src/element.ts
  import type { Locator } from "./locator";

  export interface ElementHandle {
    readonly locator: Locator;
    exists(): Promise<boolean>;
    isVisible(): Promise<boolean>;
    isEnabled(): Promise<boolean>;
    text(): Promise<string>;
    /** NB: attribute namespaces are driver-specific (HTML attrs vs resource-id/content-desc). */
    attribute(name: string): Promise<string | null>;
  }
  ```

- [ ] **Step 5: Author the barrel `index.ts`** (re-exports only the files created so far; later tasks extend it).

  ```ts
  // packages/contracts/src/index.ts
  export type { Capability, CapabilityProbe } from "./capability";
  export type { StrategyKind, LocatorStrategy, Locator } from "./locator";
  export type { ElementHandle } from "./element";
  ```

- [ ] **Step 6: Run the test — confirm PASS.**

  ```bash
  npm run test:unit -- packages/contracts/tests/capability-locator.test.ts
  ```
  Run: `npm run test:unit -- packages/contracts/tests/capability-locator.test.ts`
  Expected: `5 passed`.

- [ ] **Step 7: Commit.**

  ```bash
  git add packages/contracts/src/capability.ts packages/contracts/src/locator.ts packages/contracts/src/element.ts packages/contracts/src/index.ts packages/contracts/tests/capability-locator.test.ts
  git commit -m "feat(contracts): capability, locator and element contracts"
  ```
  Run: `git commit -m "feat(contracts): capability, locator and element contracts"`
  Expected: commit succeeds (commitlint + lint-staged pass); one commit created.

### S2 — Task 2: Contracts — action + gesture-target types

**Files:**
- Create: `packages/contracts/src/action.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/action.test.ts`

- [ ] **Step 1: Write the failing test.** Constructs a `GestureTarget` of each variant and an `Action` with only the universal verbs (gestures omitted), proving the gated methods are optional.

  ```ts
  // packages/contracts/tests/action.test.ts
  import { test, expect } from "@playwright/test";
  import type { GestureTarget, Action, Locator } from "@sentinel/contracts";

  const loc: Locator = { logicalName: "x", candidates: [], within: (p) => p };

  test("GestureTarget has element / point / percent variants", () => {
    const targets: GestureTarget[] = [
      { kind: "element", locator: loc },
      { kind: "point", x: 10, y: 20 },
      { kind: "percent", xPct: 0.5, yPct: 0.5 },
    ];
    const el = targets[0];
    expect(el?.kind).toBe("element");
    if (el?.kind === "element") expect(el.locator.logicalName).toBe("x");
  });

  test("Action is satisfiable with universal verbs only (gestures optional)", async () => {
    const calls: string[] = [];
    const action: Action = {
      tap: async () => void calls.push("tap"),
      typeText: async () => void calls.push("typeText"),
      clear: async () => void calls.push("clear"),
      read: async () => "value",
    };
    await action.tap(loc);
    await action.typeText(loc, "hi");
    expect(await action.read(loc)).toBe("value");
    expect(action.swipe).toBeUndefined();
    expect(calls).toEqual(["tap", "typeText"]);
  });
  ```

  Run: `npm run test:unit -- packages/contracts/tests/action.test.ts`
  Expected: fails — `Module '"@sentinel/contracts"' has no exported member 'GestureTarget'` / `'Action'` (or a resolution error at runtime).

- [ ] **Step 2: Author `action.ts`** (spec §3.4 + §3.5, verbatim).

  ```ts
  // packages/contracts/src/action.ts
  import type { Locator } from "./locator";

  export type GestureTarget =
    | { readonly kind: "element"; readonly locator: Locator }
    | { readonly kind: "point"; readonly x: number; readonly y: number }
    | { readonly kind: "percent"; readonly xPct: number; readonly yPct: number };

  export interface Action {
    // UNIVERSAL surface — genuinely total across web + native. Neutral verb is "tap", not "click".
    tap(target: Locator): Promise<void>;
    typeText(target: Locator, text: string): Promise<void>;
    clear(target: Locator): Promise<void>;
    read(target: Locator): Promise<string>;

    // capability "gestures" (mobile-native) — absent => CapabilityUnsupportedError.
    swipe?(
      from: GestureTarget,
      dir: "up" | "down" | "left" | "right",
      opts?: { velocity?: number },
    ): Promise<void>;
    longPress?(target: GestureTarget, ms?: number): Promise<void>;
    scrollTo?(target: Locator): Promise<void>;
  }
  ```

- [ ] **Step 3: Extend the barrel.**

  ```ts
  // packages/contracts/src/index.ts
  export type { Capability, CapabilityProbe } from "./capability";
  export type { StrategyKind, LocatorStrategy, Locator } from "./locator";
  export type { ElementHandle } from "./element";
  export type { GestureTarget, Action } from "./action";
  ```

- [ ] **Step 4: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/contracts/tests/action.test.ts`
  Expected: `2 passed`.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/contracts/src/action.ts packages/contracts/src/index.ts packages/contracts/tests/action.test.ts
  git commit -m "feat(contracts): action surface and gesture targets"
  ```
  Run: `git commit -m "feat(contracts): action surface and gesture targets"`
  Expected: commit succeeds; one commit created.

### S2 — Task 3: Contracts — assertion types (ElementState, BranchProgress, Assertion)

**Files:**
- Create: `packages/contracts/src/assertion.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/assertion.test.ts`

- [ ] **Step 1: Write the failing test.** Builds an `Assertion` whose `waitForFirstOf` returns a winning label, and a `BranchProgress` with a `reachedState` of `"none"`.

  ```ts
  // packages/contracts/tests/assertion.test.ts
  import { test, expect } from "@playwright/test";
  import type {
    ElementState,
    BranchProgress,
    Assertion,
    Locator,
  } from "@sentinel/contracts";

  const loc: Locator = { logicalName: "x", candidates: [], within: (p) => p };

  test("ElementState union members are usable", () => {
    const states: ElementState[] = ["attached", "detached", "visible", "hidden", "enabled"];
    expect(states).toContain("visible");
  });

  test("BranchProgress carries label, reachedState and resolvedRank (nullable)", () => {
    const progress: BranchProgress<"SUCCESS" | "INVALID"> = {
      label: "INVALID",
      reachedState: "none",
      resolvedRank: null,
    };
    expect(progress.label).toBe("INVALID");
    expect(progress.resolvedRank).toBeNull();
  });

  test("Assertion.waitForFirstOf returns the winning label", async () => {
    const assertion: Assertion = {
      waitFor: async () => {},
      waitForFirstOf: async (conditions) => conditions[0]!.label,
    };
    const winner = await assertion.waitForFirstOf([
      { label: "INVALID", target: loc, state: "visible" },
      { label: "SUCCESS", target: loc, state: "visible" },
    ]);
    expect(winner).toBe("INVALID");
  });
  ```

  Run: `npm run test:unit -- packages/contracts/tests/assertion.test.ts`
  Expected: fails — `has no exported member 'ElementState'` / `'Assertion'`.

- [ ] **Step 2: Author `assertion.ts`** (spec §3.6, verbatim).

  ```ts
  // packages/contracts/src/assertion.ts
  import type { Locator } from "./locator";

  export type ElementState = "attached" | "detached" | "visible" | "hidden" | "enabled";

  export interface BranchProgress<L extends string = string> {
    readonly label: L;
    readonly reachedState: ElementState | "none"; // closest state observed before timeout
    readonly resolvedRank: number | null; // locator rank that matched, or null if unresolved
  }

  export interface Assertion {
    /** Resolves on success; THROWS TimeoutError (with timings + artifacts) on timeout. NEVER returns on timeout. */
    waitFor(target: Locator, state: ElementState, opts?: { timeoutMs?: number }): Promise<void>;

    /** Driver-owned race. Returns the winning label. On no winner, throws TimeoutError whose context
     *  carries per-branch BranchProgress[]. The driver OWNS loser-cancellation (no unhandled rejections). */
    waitForFirstOf<L extends string>(
      conditions: ReadonlyArray<{ label: L; target: Locator; state: ElementState }>,
      opts?: { timeoutMs?: number },
    ): Promise<L>;
  }
  ```

- [ ] **Step 3: Extend the barrel.**

  ```ts
  // packages/contracts/src/index.ts
  export type { Capability, CapabilityProbe } from "./capability";
  export type { StrategyKind, LocatorStrategy, Locator } from "./locator";
  export type { ElementHandle } from "./element";
  export type { GestureTarget, Action } from "./action";
  export type { ElementState, BranchProgress, Assertion } from "./assertion";
  ```

- [ ] **Step 4: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/contracts/tests/assertion.test.ts`
  Expected: `3 passed`.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/contracts/src/assertion.ts packages/contracts/src/index.ts packages/contracts/tests/assertion.test.ts
  git commit -m "feat(contracts): assertion primitives and branch progress"
  ```
  Run: `git commit -m "feat(contracts): assertion primitives and branch progress"`
  Expected: commit succeeds; one commit created.

### S2 — Task 4: Contracts — session + driver types and full barrel

**Files:**
- Create: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/driver.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/session-driver.test.ts`

> Note: `Session.telemetry` is typed `TelemetrySink` in spec §3.7, but the sink type lives in `@sentinel/core`, which depends on `@sentinel/contracts` (not vice-versa). To keep `@sentinel/contracts` dependency-free we model `telemetry` with a minimal structural `TelemetrySinkLike` declared inline in `session.ts` (`emit(event: unknown): void; child(name: string): TelemetrySinkLike;`). `@sentinel/core`'s `TelemetrySink` is structurally assignable to it, so the example session still type-checks. This is the smallest change preserving the no-cycle layering; no public name from the spec is changed.

- [ ] **Step 1: Write the failing test.** Builds a `Driver` and a `Session` exposing only the universal surface (navigation/contexts/screenshot omitted, since they are optional), and asserts capability sets are `ReadonlySet`.

  ```ts
  // packages/contracts/tests/session-driver.test.ts
  import { test, expect } from "@playwright/test";
  import type {
    Session,
    SessionConfig,
    Driver,
    Capability,
    StrategyKind,
    ElementHandle,
    Action,
    Assertion,
  } from "@sentinel/contracts";

  const noopAction: Action = {
    tap: async () => {},
    typeText: async () => {},
    clear: async () => {},
    read: async () => "",
  };
  const noopAssert: Assertion = {
    waitFor: async () => {},
    waitForFirstOf: async (c) => c[0]!.label,
  };
  const noopHandle: ElementHandle = {
    locator: { logicalName: "x", candidates: [], within: (p) => p },
    exists: async () => false,
    isVisible: async () => false,
    isEnabled: async () => false,
    text: async () => "",
    attribute: async () => null,
  };

  test("Session is satisfiable with the universal surface (gated methods omitted)", () => {
    const caps: ReadonlySet<Capability> = new Set<Capability>(["dom"]);
    const session: Session = {
      id: "run-1",
      driver: "playwright",
      capabilities: caps,
      telemetry: { emit: () => {}, child: () => session.telemetry },
      supports: (c) => caps.has(c),
      require: () => {},
      locate: () => noopHandle,
      action: noopAction,
      assert: noopAssert,
      end: async () => {},
    };
    expect(session.supports("dom")).toBe(true);
    expect(session.navigate).toBeUndefined();
  });

  test("Driver advertises capabilities + strategies and createSession", async () => {
    const strategies: ReadonlySet<StrategyKind> = new Set(["css", "role"]);
    const config: SessionConfig = { defaultTimeoutMs: 10_000 };
    const driver: Driver = {
      name: "playwright",
      capabilities: new Set<Capability>(["dom", "navigation"]),
      strategies,
      createSession: async () =>
        ({}) as unknown as Session,
    };
    expect(driver.strategies.has("css")).toBe(true);
    expect(config.defaultTimeoutMs).toBe(10_000);
    expect(typeof driver.createSession).toBe("function");
  });
  ```

  Run: `npm run test:unit -- packages/contracts/tests/session-driver.test.ts`
  Expected: fails — `has no exported member 'Session'` / `'Driver'` / `'SessionConfig'`.

- [ ] **Step 2: Author `session.ts`** (spec §3.7; `telemetry` typed as the inline structural `TelemetrySinkLike`).

  ```ts
  // packages/contracts/src/session.ts
  import type { Capability, CapabilityProbe } from "./capability";
  import type { ElementHandle } from "./element";
  import type { Locator } from "./locator";
  import type { Action } from "./action";
  import type { Assertion } from "./assertion";

  /** Structural minimum of a telemetry sink, declared here to keep @sentinel/contracts
   *  dependency-free. @sentinel/core's TelemetrySink is structurally assignable to this. */
  export interface TelemetrySinkLike {
    emit(event: unknown): void;
    child(name: string): TelemetrySinkLike;
  }

  export interface Session extends CapabilityProbe {
    readonly id: string; // == telemetry traceId == ResultMeta.correlationId
    readonly driver: string;
    readonly capabilities: ReadonlySet<Capability>;
    readonly telemetry: TelemetrySinkLike;

    locate(locator: Locator): ElementHandle;
    readonly action: Action;
    readonly assert: Assertion;

    // capability "navigation" (web / webview) — async (Appium webview URL is async). NOT on universal surface.
    navigate?(url: string): Promise<void>;
    currentUrl?(): Promise<string>;
    back?(): Promise<void>;

    // capability "contexts" (mobile)
    contexts?(): Promise<readonly string[]>;
    switchContext?(name: string): Promise<void>;

    screenshot?(): Promise<Buffer>; // capability "screenshot"
    end(): Promise<void>;
  }

  export interface SessionConfig {
    readonly baseUrl?: string; // OPTIONAL: ignored on the page-wrap path (test owns page.goto)
    readonly defaultTimeoutMs: number; // single timeout source of truth (replaces 10_000 literals)
    /** Slice-A only: the driver adopts this as Session.id when provided, so the flow's runId
     *  (the JSONL filename) == Session.id == correlationId == every event's traceId (§3.7/§6). */
    readonly sessionId?: string;
    /** Slice-A only: wrap a pre-navigated Playwright Page so logIn(page,...) stays working. */
    readonly existingPage?: unknown;
  }
  ```

- [ ] **Step 3: Author `driver.ts`** (spec §3.7, verbatim).

  ```ts
  // packages/contracts/src/driver.ts
  import type { Capability } from "./capability";
  import type { StrategyKind } from "./locator";
  import type { Session, SessionConfig, TelemetrySinkLike } from "./session";

  export interface Driver {
    readonly name: string; // "playwright" | "appium-uiautomator2"
    readonly capabilities: ReadonlySet<Capability>;
    readonly strategies: ReadonlySet<StrategyKind>; // which locator kinds this driver can compile
    createSession(config: SessionConfig, telemetry: TelemetrySinkLike): Promise<Session>;
  }
  ```

- [ ] **Step 4: Complete the barrel.**

  ```ts
  // packages/contracts/src/index.ts
  export type { Capability, CapabilityProbe } from "./capability";
  export type { StrategyKind, LocatorStrategy, Locator } from "./locator";
  export type { ElementHandle } from "./element";
  export type { GestureTarget, Action } from "./action";
  export type { ElementState, BranchProgress, Assertion } from "./assertion";
  export type { Session, SessionConfig, TelemetrySinkLike } from "./session";
  export type { Driver } from "./driver";
  ```

- [ ] **Step 5: Run the test + typecheck — confirm PASS.**

  ```bash
  npm run test:unit -- packages/contracts/tests/session-driver.test.ts
  npm run typecheck
  ```
  Run: `npm run test:unit -- packages/contracts/tests/session-driver.test.ts`
  Expected: `2 passed`.
  Run: `npm run typecheck`
  Expected: exits 0, no output (`tsc -b` clean).

- [ ] **Step 6: Commit.**

  ```bash
  git add packages/contracts/src/session.ts packages/contracts/src/driver.ts packages/contracts/src/index.ts packages/contracts/tests/session-driver.test.ts
  git commit -m "feat(contracts): session and driver interfaces"
  ```
  Run: `git commit -m "feat(contracts): session and driver interfaces"`
  Expected: commit succeeds; one commit created.

### S2 — Task 5: Core — Result model types + factories

**Files:**
- Create: `packages/core/src/result/result.ts`
- Create: `packages/core/src/result/factory.ts`
- Create: `packages/core/src/result/index.ts`
- Test: `packages/core/tests/result.test.ts`

- [ ] **Step 1: Write the failing test** for `ok` / `businessFailure` / `isSuccess` / `assertNever`, covering discriminant narrowing.

  ```ts
  // packages/core/tests/result.test.ts
  import { test, expect } from "@playwright/test";
  import {
    ok,
    businessFailure,
    isSuccess,
    assertNever,
    type Result,
    type ResultMeta,
  } from "@sentinel/core";

  const meta: ResultMeta = {
    correlationId: "run-1",
    flowName: "auth.login",
    startedAt: 1000,
    durationMs: 42,
  };

  test("ok() builds a Success and isSuccess narrows to data", () => {
    const r = ok({ username: "admin" }, meta);
    expect(r.status).toBe("success");
    expect(isSuccess(r)).toBe(true);
    if (isSuccess(r)) expect(r.data.username).toBe("admin");
  });

  test("businessFailure() carries reason/message/details and narrows", () => {
    const r = businessFailure<"INVALID_CREDENTIALS", { username: string }>(
      "INVALID_CREDENTIALS",
      meta,
      { message: "Invalid Login. Try again.", details: { username: "admin" } },
    );
    expect(r.status).toBe("business-failure");
    expect(isSuccess(r)).toBe(false);
    if (!isSuccess(r)) {
      expect(r.reason).toBe("INVALID_CREDENTIALS");
      expect(r.message).toBe("Invalid Login. Try again.");
      expect(r.details?.username).toBe("admin");
    }
  });

  test("businessFailure() omits optional fields when opts not given", () => {
    const r = businessFailure("INVALID_CREDENTIALS", meta);
    expect(r.message).toBeUndefined();
    expect(r.details).toBeUndefined();
  });

  test("assertNever throws on a non-never value at runtime", () => {
    const r = ok(1, meta) as Result<number>;
    const run = () => {
      switch (r.status) {
        case "success":
          return r.data;
        case "business-failure":
          return -1;
        default:
          return assertNever(r);
      }
    };
    expect(run()).toBe(1);
    expect(() => assertNever({ status: "ghost" } as never)).toThrow(/Unhandled Result variant/);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/result.test.ts`
  Expected: fails — `Cannot find module '@sentinel/core'`.

- [ ] **Step 2: Author `result/result.ts`** (spec §4, verbatim).

  ```ts
  // packages/core/src/result/result.ts
  export interface ResultMeta {
    readonly correlationId: string; // == Session.id == telemetry traceId — THE join key
    readonly flowName: string; // "auth.login" — domain intent
    readonly startedAt: number; // single canonical epoch ms at flow entry
    readonly durationMs: number;
    readonly artifacts?: Readonly<Record<string, string>>; // e.g. {traceRef} — OPTIONAL string refs (NOT finalUrl)
  }

  export interface Success<T> {
    readonly status: "success";
    readonly data: T;
    readonly meta: ResultMeta;
  }
  export interface BusinessFailure<R extends string = string, D = unknown> {
    readonly status: "business-failure";
    readonly reason: R; // STABLE enum, "INVALID_CREDENTIALS" — NEVER the localized UI string
    readonly message?: string; // human/UI text (localized; display-only, never keyed on)
    readonly details?: D;
    readonly meta: ResultMeta;
  }
  export type Result<T, R extends string = string, D = unknown> = Success<T> | BusinessFailure<R, D>;
  ```

- [ ] **Step 3: Author `result/factory.ts`** (spec §4, verbatim).

  ```ts
  // packages/core/src/result/factory.ts
  import type { Result, Success, BusinessFailure, ResultMeta } from "./result";

  export const ok = <T>(data: T, meta: ResultMeta): Success<T> => ({ status: "success", data, meta });

  export const businessFailure = <R extends string, D = unknown>(
    reason: R,
    meta: ResultMeta,
    opts?: { message?: string; details?: D },
  ): BusinessFailure<R, D> => ({
    status: "business-failure",
    reason,
    message: opts?.message,
    details: opts?.details,
    meta,
  });

  export const isSuccess = <T, R extends string, D>(r: Result<T, R, D>): r is Success<T> =>
    r.status === "success";

  export const assertNever = (x: never): never => {
    throw new Error(`Unhandled Result variant: ${JSON.stringify(x)}`);
  };
  ```

- [ ] **Step 4: Author `result/index.ts`** and the package barrel.

  ```ts
  // packages/core/src/result/index.ts
  export type { ResultMeta, Success, BusinessFailure, Result } from "./result";
  export { ok, businessFailure, isSuccess, assertNever } from "./factory";
  ```

  ```ts
  // packages/core/src/index.ts
  export * from "./result";
  ```

- [ ] **Step 5: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/result.test.ts`
  Expected: `4 passed`.

- [ ] **Step 6: Commit.**

  ```bash
  git add packages/core/src/result/result.ts packages/core/src/result/factory.ts packages/core/src/result/index.ts packages/core/src/index.ts packages/core/tests/result.test.ts
  git commit -m "feat(core): result model and factories"
  ```
  Run: `git commit -m "feat(core): result model and factories"`
  Expected: commit succeeds; one commit created.

### S2 — Task 6: Core — error taxonomy base + Artifact + context

**Files:**
- Create: `packages/core/src/errors/system-failure-error.ts`
- Test: `packages/core/tests/system-failure-error.test.ts`

- [ ] **Step 1: Write the failing test.** Subclasses the abstract base in the test to verify `name`, `kind`, `context`, `cause` wiring, and `Error.captureStackTrace`.

  ```ts
  // packages/core/tests/system-failure-error.test.ts
  import { test, expect } from "@playwright/test";
  import {
    SystemFailureError,
    type SystemFailureContext,
    type SystemFailureKind,
    type Artifact,
  } from "@sentinel/core";

  class FakeError extends SystemFailureError {
    readonly kind: SystemFailureKind = "timeout";
    readonly retryable = true;
  }

  const ctx: SystemFailureContext = {
    correlationId: "run-1",
    flowName: "auth.login",
    startedAt: 1000,
    durationMs: 5,
  };

  test("base wires name, message, context, kind and retryable", () => {
    const e = new FakeError("boom", ctx);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(SystemFailureError);
    expect(e.message).toBe("boom");
    expect(e.name).toBe("FakeError");
    expect(e.kind).toBe("timeout");
    expect(e.retryable).toBe(true);
    expect(e.context.correlationId).toBe("run-1");
  });

  test("captureStackTrace produces a stack omitting the constructor frame", () => {
    const e = new FakeError("boom", ctx);
    expect(typeof e.stack).toBe("string");
    expect(e.stack).not.toContain("at new FakeError");
  });

  test("cause is attached only when present in context", () => {
    const raw = new Error("driver exploded");
    const withCause = new FakeError("boom", { ...ctx, cause: raw });
    expect((withCause as { cause?: unknown }).cause).toBe(raw);
    const noCause = new FakeError("boom", ctx);
    expect((noCause as { cause?: unknown }).cause).toBeUndefined();
  });

  test("Artifact shape is satisfiable", () => {
    const a: Artifact = { kind: "dom-snapshot", ref: "test-results/x.html" };
    expect(a.kind).toBe("dom-snapshot");
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/system-failure-error.test.ts`
  Expected: fails — `has no exported member 'SystemFailureError'`.

- [ ] **Step 2: Author `errors/system-failure-error.ts`** (spec §5, verbatim).

  ```ts
  // packages/core/src/errors/system-failure-error.ts
  import type { Capability, StrategyKind, BranchProgress } from "@sentinel/contracts";

  export type SystemFailureKind =
    | "timeout"
    | "selector-not-found"
    | "selector-ambiguous"
    | "driver-session"
    | "assertion-infrastructure"
    | "capability-unsupported";

  export interface Artifact {
    readonly kind: "screenshot" | "dom-snapshot" | "a11y-snapshot" | "trace" | "console-log" | "har";
    readonly ref?: string;
    readonly inline?: string;
  }

  export interface SystemFailureContext {
    readonly correlationId: string; // SAME id as ResultMeta + every telemetry event
    readonly flowName: string;
    readonly startedAt: number;
    readonly durationMs: number; // elapsed before failure
    readonly artifacts?: readonly Artifact[];
    readonly logicalName?: string; // for selector-* kinds: which element
    readonly attempted?: readonly { strategy: StrategyKind; matched: boolean; rank: number }[];
    readonly branchProgress?: readonly BranchProgress[]; // for waitForFirstOf timeouts (disambiguation)
    readonly capability?: Capability; // for capability-unsupported
    readonly cause?: unknown; // raw driver error preserved
  }

  export abstract class SystemFailureError extends Error {
    abstract readonly kind: SystemFailureKind;
    abstract readonly retryable: boolean; // A-PRIORI flake HINT, not a verdict; analyzer refines via history
    constructor(
      message: string,
      readonly context: SystemFailureContext,
    ) {
      super(message);
      this.name = new.target.name;
      if (context.cause !== undefined) (this as { cause?: unknown }).cause = context.cause;
      Error.captureStackTrace?.(this, new.target);
    }
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/system-failure-error.test.ts`
  Expected: `4 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/errors/system-failure-error.ts packages/core/tests/system-failure-error.test.ts
  git commit -m "feat(core): system failure error base and context"
  ```
  Run: `git commit -m "feat(core): system failure error base and context"`
  Expected: commit succeeds; one commit created.

### S2 — Task 7: Core — the six typed error subclasses + isSystemFailure

**Files:**
- Create: `packages/core/src/errors/kinds.ts`
- Create: `packages/core/src/errors/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/error-kinds.test.ts`

- [ ] **Step 1: Write the failing test** asserting each subclass's `kind`/`retryable`/`name` per the §5 table, plus `isSystemFailure` narrowing.

  ```ts
  // packages/core/tests/error-kinds.test.ts
  import { test, expect } from "@playwright/test";
  import {
    TimeoutError,
    SelectorNotFoundError,
    SelectorAmbiguousError,
    DriverSessionError,
    AssertionInfrastructureError,
    CapabilityUnsupportedError,
    isSystemFailure,
    SystemFailureError,
    type SystemFailureContext,
  } from "@sentinel/core";

  const ctx: SystemFailureContext = {
    correlationId: "run-1",
    flowName: "auth.login",
    startedAt: 1000,
    durationMs: 5,
  };

  test("each subclass has the specified kind, retryable and name", () => {
    const cases = [
      { e: new TimeoutError("t", ctx), kind: "timeout", retryable: true, name: "TimeoutError" },
      {
        e: new SelectorNotFoundError("s", ctx),
        kind: "selector-not-found",
        retryable: false,
        name: "SelectorNotFoundError",
      },
      {
        e: new SelectorAmbiguousError("s", ctx),
        kind: "selector-ambiguous",
        retryable: false,
        name: "SelectorAmbiguousError",
      },
      {
        e: new DriverSessionError("d", ctx),
        kind: "driver-session",
        retryable: true,
        name: "DriverSessionError",
      },
      {
        e: new AssertionInfrastructureError("a", ctx),
        kind: "assertion-infrastructure",
        retryable: false,
        name: "AssertionInfrastructureError",
      },
      {
        e: new CapabilityUnsupportedError("c", ctx),
        kind: "capability-unsupported",
        retryable: false,
        name: "CapabilityUnsupportedError",
      },
    ] as const;
    for (const c of cases) {
      expect(c.e.kind).toBe(c.kind);
      expect(c.e.retryable).toBe(c.retryable);
      expect(c.e.name).toBe(c.name);
      expect(c.e).toBeInstanceOf(SystemFailureError);
    }
  });

  test("isSystemFailure narrows SystemFailureError and rejects plain errors", () => {
    expect(isSystemFailure(new TimeoutError("t", ctx))).toBe(true);
    expect(isSystemFailure(new Error("plain"))).toBe(false);
    expect(isSystemFailure("nope")).toBe(false);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/error-kinds.test.ts`
  Expected: fails — `has no exported member 'TimeoutError'`.

- [ ] **Step 2: Author `errors/kinds.ts`** (the six §5 subclasses + the guard).

  ```ts
  // packages/core/src/errors/kinds.ts
  import { SystemFailureError, type SystemFailureKind } from "./system-failure-error";

  export class TimeoutError extends SystemFailureError {
    readonly kind: SystemFailureKind = "timeout";
    readonly retryable = true;
  }

  export class SelectorNotFoundError extends SystemFailureError {
    readonly kind: SystemFailureKind = "selector-not-found";
    readonly retryable = false;
  }

  export class SelectorAmbiguousError extends SystemFailureError {
    readonly kind: SystemFailureKind = "selector-ambiguous";
    readonly retryable = false;
  }

  export class DriverSessionError extends SystemFailureError {
    readonly kind: SystemFailureKind = "driver-session";
    readonly retryable = true;
  }

  export class AssertionInfrastructureError extends SystemFailureError {
    readonly kind: SystemFailureKind = "assertion-infrastructure";
    readonly retryable = false;
  }

  export class CapabilityUnsupportedError extends SystemFailureError {
    readonly kind: SystemFailureKind = "capability-unsupported";
    readonly retryable = false;
  }

  export const isSystemFailure = (e: unknown): e is SystemFailureError =>
    e instanceof SystemFailureError;
  ```

- [ ] **Step 3: Author `errors/index.ts`** and extend the package barrel.

  ```ts
  // packages/core/src/errors/index.ts
  export {
    SystemFailureError,
    type SystemFailureKind,
    type SystemFailureContext,
    type Artifact,
  } from "./system-failure-error";
  export {
    TimeoutError,
    SelectorNotFoundError,
    SelectorAmbiguousError,
    DriverSessionError,
    AssertionInfrastructureError,
    CapabilityUnsupportedError,
    isSystemFailure,
  } from "./kinds";
  ```

  ```ts
  // packages/core/src/index.ts
  export * from "./result";
  export * from "./errors";
  ```

- [ ] **Step 4: Run + typecheck — confirm PASS.**

  ```bash
  npm run test:unit -- packages/core/tests/error-kinds.test.ts
  npm run typecheck
  ```
  Run: `npm run test:unit -- packages/core/tests/error-kinds.test.ts`
  Expected: `2 passed`.
  Run: `npm run typecheck`
  Expected: exits 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/core/src/errors/kinds.ts packages/core/src/errors/index.ts packages/core/src/index.ts packages/core/tests/error-kinds.test.ts
  git commit -m "feat(core): typed system failure subclasses and guard"
  ```
  Run: `git commit -m "feat(core): typed system failure subclasses and guard"`
  Expected: commit succeeds; one commit created.

### S2 — Task 8: Core — telemetry envelope + Timing + event types

**Files:**
- Create: `packages/core/src/telemetry/event.ts`
- Test: `packages/core/tests/telemetry-event.test.ts`

- [ ] **Step 1: Write the failing test.** Asserts `TELEMETRY_SCHEMA_VERSION` and constructs a conforming `TelemetryEnvelope` with `Timing` carrying bigint fields.

  ```ts
  // packages/core/tests/telemetry-event.test.ts
  import { test, expect } from "@playwright/test";
  import {
    TELEMETRY_SCHEMA_VERSION,
    type Timing,
    type SpanStatus,
    type TelemetryEventType,
    type TelemetryEnvelope,
  } from "@sentinel/core";

  test("schema version is 1.0.0", () => {
    expect(TELEMETRY_SCHEMA_VERSION).toBe("1.0.0");
  });

  test("Timing carries wall-clock ms and monotonic bigint ns", () => {
    const timing: Timing = {
      startWallClockMs: Date.now(),
      startMonotonicNs: 123n,
      endMonotonicNs: 456n,
      durationMs: 0.333,
    };
    expect(typeof timing.startMonotonicNs).toBe("bigint");
    expect(timing.endMonotonicNs! - timing.startMonotonicNs).toBe(333n);
  });

  test("TelemetryEnvelope is satisfiable and SpanStatus/EventType are usable", () => {
    const status: SpanStatus = "ok";
    const type: TelemetryEventType = "flow.started";
    const env: TelemetryEnvelope<"flow.started"> = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      eventId: "evt-1",
      type,
      traceId: "run-1",
      spanId: "span-1",
      sequence: 0,
      name: "auth.login",
      status,
      timing: { startWallClockMs: 1, startMonotonicNs: 1n },
    };
    expect(env.type).toBe("flow.started");
    expect(env.parentSpanId).toBeUndefined();
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/telemetry-event.test.ts`
  Expected: fails — `has no exported member 'TELEMETRY_SCHEMA_VERSION'`.

- [ ] **Step 2: Author `telemetry/event.ts`** (spec §6, verbatim).

  ```ts
  // packages/core/src/telemetry/event.ts
  export const TELEMETRY_SCHEMA_VERSION = "1.0.0";

  export interface Timing {
    startWallClockMs: number; // Date.now() — cross-machine ordering
    startMonotonicNs: bigint; // process.hrtime.bigint() — duration source of truth
    endMonotonicNs?: bigint;
    durationMs?: number;
  }
  export type SpanStatus = "unset" | "ok" | "error";

  export type TelemetryEventType =
    | "run.started"
    | "run.finished"
    | "flow.started"
    | "flow.finished"
    | "component.action"
    | "locator.resolved"
    | "retry"
    | "assertion"
    | "artifact.captured"
    | "business.failure"
    | "system.failure";

  export interface TelemetryEnvelope<T extends TelemetryEventType = TelemetryEventType> {
    schemaVersion: string;
    eventId: string; // uuid
    type: T;
    traceId: string; // == correlationId == Session.id
    spanId: string;
    parentSpanId?: string;
    sequence: number; // monotonic per run — total order without a span tree
    name: string; // "auth.login" / "loginForm.submit"
    status?: SpanStatus;
    timing: Timing;
    attributes?: Readonly<Record<string, string | number | boolean>>;
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/telemetry-event.test.ts`
  Expected: `3 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/event.ts packages/core/tests/telemetry-event.test.ts
  git commit -m "feat(core): telemetry envelope and timing model"
  ```
  Run: `git commit -m "feat(core): telemetry envelope and timing model"`
  Expected: commit succeeds; one commit created.

### S2 — Task 9: Core — typed signal event interfaces + TelemetryEvent union

**Files:**
- Create: `packages/core/src/telemetry/signals.ts`
- Test: `packages/core/tests/telemetry-signals.test.ts`

- [ ] **Step 1: Write the failing test.** Constructs one of each signal event and asserts the classifier-critical fields exist with the right literal `status`/`type`.

  ```ts
  // packages/core/tests/telemetry-signals.test.ts
  import { test, expect } from "@playwright/test";
  import { TELEMETRY_SCHEMA_VERSION } from "@sentinel/core";
  import type {
    LocatorResolvedEvent,
    AssertionEvent,
    RetryEvent,
    BusinessFailureEvent,
    SystemFailureEvent,
    ArtifactCapturedEvent,
    FlowFinishedEvent,
    TelemetryEvent,
  } from "@sentinel/core";

  const base = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: "e",
    traceId: "run-1",
    spanId: "s",
    sequence: 1,
    name: "n",
    timing: { startWallClockMs: 1, startMonotonicNs: 1n },
  } as const;

  test("LocatorResolvedEvent carries resolvedRank, degraded and candidates", () => {
    const e: LocatorResolvedEvent = {
      ...base,
      type: "locator.resolved",
      logicalName: "auth.login.submit",
      resolvedKind: "role",
      resolvedRank: 0,
      degraded: false,
      candidates: [{ kind: "role", outcome: "matched", rank: 0 }],
      score: 1,
      resolveDurationMs: 4,
    };
    expect(e.degraded).toBe(false);
    expect(e.candidates[0]?.outcome).toBe("matched");
  });

  test("BusinessFailureEvent fixes status:'ok' and SystemFailureEvent fixes status:'error'", () => {
    const bf: BusinessFailureEvent = {
      ...base,
      type: "business.failure",
      status: "ok",
      domainReason: "INVALID_CREDENTIALS",
    };
    const sf: SystemFailureEvent = {
      ...base,
      type: "system.failure",
      status: "error",
      errorKind: "timeout",
      message: "timed out",
      retryable: true,
      artifactRefs: [],
    };
    expect(bf.status).toBe("ok");
    expect(sf.errorKind).toBe("timeout");
  });

  test("Assertion/Retry/Artifact/FlowFinished events are satisfiable and join the union", () => {
    const events: TelemetryEvent[] = [
      { ...base, type: "assertion", state: "visible", matched: true, locatorRank: 0 } as AssertionEvent,
      {
        ...base,
        type: "retry",
        attempt: 1,
        maxAttempts: 2,
        reason: "flake",
        previousOutcome: "timeout",
      } as RetryEvent,
      {
        ...base,
        type: "artifact.captured",
        artifactKind: "dom-snapshot",
        ref: "x.html",
        capturedOn: "degradedResolution",
      } as ArtifactCapturedEvent,
      {
        ...base,
        type: "flow.finished",
        outcome: "business-failure",
        terminalReason: "INVALID_CREDENTIALS",
        didDegrade: false,
      } as FlowFinishedEvent,
    ];
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.type)).toContain("flow.finished");
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/telemetry-signals.test.ts`
  Expected: fails — `has no exported member 'LocatorResolvedEvent'`.

- [ ] **Step 2: Author `telemetry/signals.ts`** (spec §6, verbatim, plus the `TelemetryEvent` union the sink type needs).

  ```ts
  // packages/core/src/telemetry/signals.ts
  import type { StrategyKind, ElementState, BranchProgress } from "@sentinel/contracts";
  import type { Artifact, SystemFailureKind } from "../errors";
  import type { TelemetryEnvelope } from "./event";

  export interface LocatorResolvedEvent extends TelemetryEnvelope<"locator.resolved"> {
    logicalName: string;
    resolvedKind: StrategyKind;
    resolvedRank: number; // >0 => SELECTOR-DRIFT
    degraded: boolean; // resolvedRank > 0
    candidates: readonly { kind: StrategyKind; outcome: "matched" | "missed" | "skipped"; rank: number }[];
    score: number;
    resolveDurationMs: number;
  }
  export interface AssertionEvent extends TelemetryEnvelope<"assertion"> {
    state: ElementState;
    matched: boolean;
    locatorRank: number; // matched:false && rank===0 && no prior retry => REAL-BUG
    branch?: string;
    branchProgress?: readonly BranchProgress[];
  }
  export interface RetryEvent extends TelemetryEnvelope<"retry"> {
    attempt: number;
    maxAttempts: number;
    reason: string;
    previousOutcome: "error" | "assertionFailed" | "timeout"; // retry-then-pass => INFRA-FLAKE
  }
  export interface BusinessFailureEvent extends TelemetryEnvelope<"business.failure"> {
    status: "ok"; // run mechanically succeeded; domain said no
    domainReason: string; // STABLE "INVALID_CREDENTIALS" — emitted independent of localized message
  }
  export interface SystemFailureEvent extends TelemetryEnvelope<"system.failure"> {
    status: "error";
    errorKind: SystemFailureKind;
    message: string;
    retryable: boolean;
    artifactRefs: readonly string[];
  }
  export interface ArtifactCapturedEvent extends TelemetryEnvelope<"artifact.captured"> {
    artifactKind: Artifact["kind"];
    ref: string;
    capturedOn: "systemFailure" | "degradedResolution"; // attachable to NON-failing drifted runs too
  }
  export interface FlowFinishedEvent extends TelemetryEnvelope<"flow.finished"> {
    outcome: "success" | "business-failure" | "system-failure";
    terminalReason?: string; // domainReason or SystemFailureKind
    didDegrade: boolean; // true if ANY locator.resolved in the flow had resolvedRank>0
  }

  /** The emitted event surface: a typed signal OR a plain envelope for the simple event types. */
  export type TelemetryEvent =
    | LocatorResolvedEvent
    | AssertionEvent
    | RetryEvent
    | BusinessFailureEvent
    | SystemFailureEvent
    | ArtifactCapturedEvent
    | FlowFinishedEvent
    | TelemetryEnvelope;
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/telemetry-signals.test.ts`
  Expected: `3 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/signals.ts packages/core/tests/telemetry-signals.test.ts
  git commit -m "feat(core): classifier signal event types"
  ```
  Run: `git commit -m "feat(core): classifier signal event types"`
  Expected: commit succeeds; one commit created.

### S2 — Task 10: Core — timers (durationMs from hrtime.bigint)

**Files:**
- Create: `packages/core/src/telemetry/timers.ts`
- Test: `packages/core/tests/timers.test.ts`

- [ ] **Step 1: Write the failing test.** Verifies `startTimer` snapshots a bigint and `finish` derives `durationMs` from the hrtime delta (not wall clock), using an injectable clock for determinism.

  ```ts
  // packages/core/tests/timers.test.ts
  import { test, expect } from "@playwright/test";
  import { startTimer, durationMsFromNs, type Timer } from "@sentinel/core";

  test("durationMsFromNs converts a ns delta to fractional ms", () => {
    expect(durationMsFromNs(1_000_000n)).toBe(1);
    expect(durationMsFromNs(1_500_000n)).toBeCloseTo(1.5, 6);
    expect(durationMsFromNs(0n)).toBe(0);
  });

  test("startTimer().finish derives durationMs from an injected hrtime clock", () => {
    let now = 5_000_000n;
    const clock = () => now;
    const timer: Timer = startTimer(clock);
    now = 8_500_000n; // +3.5ms elapsed
    const timing = timer.finish();
    expect(timing.startMonotonicNs).toBe(5_000_000n);
    expect(timing.endMonotonicNs).toBe(8_500_000n);
    expect(timing.durationMs).toBeCloseTo(3.5, 6);
    expect(typeof timing.startWallClockMs).toBe("number");
  });

  test("startTimer with the default clock yields a non-negative duration", () => {
    const timing = startTimer().finish();
    expect(timing.durationMs!).toBeGreaterThanOrEqual(0);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/timers.test.ts`
  Expected: fails — `has no exported member 'startTimer'`.

- [ ] **Step 2: Author `telemetry/timers.ts`.** Derives `durationMs` from `process.hrtime.bigint()` deltas (spec §7 obligation (d)); clock is injectable for tests.

  ```ts
  // packages/core/src/telemetry/timers.ts
  import type { Timing } from "./event";

  export type HrClock = () => bigint;

  const defaultClock: HrClock = () => process.hrtime.bigint();

  /** ns delta -> fractional milliseconds (duration source of truth is the monotonic clock). */
  export const durationMsFromNs = (deltaNs: bigint): number => Number(deltaNs) / 1_000_000;

  export interface Timer {
    readonly startMonotonicNs: bigint;
    readonly startWallClockMs: number;
    finish(): Timing;
  }

  export const startTimer = (clock: HrClock = defaultClock): Timer => {
    const startMonotonicNs = clock();
    const startWallClockMs = Date.now();
    return {
      startMonotonicNs,
      startWallClockMs,
      finish(): Timing {
        const endMonotonicNs = clock();
        return {
          startWallClockMs,
          startMonotonicNs,
          endMonotonicNs,
          durationMs: durationMsFromNs(endMonotonicNs - startMonotonicNs),
        };
      },
    };
  };
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/timers.test.ts`
  Expected: `3 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/timers.ts packages/core/tests/timers.test.ts
  git commit -m "feat(core): monotonic timers deriving durationMs from hrtime"
  ```
  Run: `git commit -m "feat(core): monotonic timers deriving durationMs from hrtime"`
  Expected: commit succeeds; one commit created.

### S2 — Task 11: Core — SpanContext + StampingSink + InMemorySink + NoopSink

**Files:**
- Create: `packages/core/src/telemetry/sink.ts`
- Test: `packages/core/tests/sink.test.ts`

> A single per-run `SpanContext` owns the monotonic `sequence` counter and span-id generation (spec §6: "sinks do not each own counters"). `StampingSink` is the ONE place stamping happens — it applies `traceId`/`spanId`/`parentSpanId`/`sequence` from that shared context, then delegates to its inner sink, so every downstream sink (`InMemorySink`, `JsonlSink`) sees identical events and the in-memory log never diverges from the on-disk JSONL. `InMemorySink` is a pure recorder.

- [ ] **Step 1: Write the failing test.** Verifies push order, monotonic sequence, span-id assignment, and `parentSpanId` on a child span; plus `NoopSink` no-op.

  ```ts
  // packages/core/tests/sink.test.ts
  import { test, expect } from "@playwright/test";
  import {
    SpanContext,
    StampingSink,
    InMemorySink,
    NoopSink,
    TELEMETRY_SCHEMA_VERSION,
  } from "@sentinel/core";
  import type { TelemetryEnvelope } from "@sentinel/core";

  const evt = (name: string): TelemetryEnvelope => ({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: "e",
    type: "component.action",
    traceId: "run-1",
    spanId: "PLACEHOLDER",
    sequence: -1,
    name,
    timing: { startWallClockMs: 1, startMonotonicNs: 1n },
  });

  test("SpanContext mints monotonic sequence and unique span ids", () => {
    const root = new SpanContext("run-1");
    expect(root.traceId).toBe("run-1");
    expect(root.nextSequence()).toBe(0);
    expect(root.nextSequence()).toBe(1);
    const child = root.child();
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.spanId).not.toBe(root.spanId);
    // child shares the run-level monotonic sequence
    expect(child.nextSequence()).toBe(2);
  });

  test("StampingSink stamps traceId/spanId/sequence and delegates to its inner sink", () => {
    const inner = new InMemorySink();
    const sink = new StampingSink(new SpanContext("run-1"), inner);
    sink.emit(evt("first"));
    sink.emit(evt("second"));
    expect(inner.events.map((e) => e.name)).toEqual(["first", "second"]);
    expect(inner.events.map((e) => e.sequence)).toEqual([0, 1]);
    expect(inner.events[0]?.traceId).toBe("run-1");
    expect(typeof inner.events[0]?.spanId).toBe("string");
    expect(inner.events[0]?.spanId).not.toBe("PLACEHOLDER");
  });

  test("StampingSink.child stamps parentSpanId and shares the run-level sequence", () => {
    const inner = new InMemorySink();
    const sink = new StampingSink(new SpanContext("run-1"), inner);
    sink.emit(evt("root"));
    sink.child("flow").emit(evt("child"));
    expect(inner.events).toHaveLength(2);
    expect(inner.events[1]?.name).toBe("child");
    expect(inner.events[1]?.parentSpanId).toBe(inner.events[0]?.spanId);
    expect(inner.events.map((e) => e.sequence)).toEqual([0, 1]);
  });

  test("InMemorySink is a pure recorder — stores events verbatim, no stamping", () => {
    const sink = new InMemorySink();
    sink.emit(evt("raw"));
    expect(sink.events.map((e) => e.name)).toEqual(["raw"]);
    expect(sink.events[0]?.sequence).toBe(-1); // pure push preserves the caller's value
    expect(sink.child("c")).toBeInstanceOf(InMemorySink);
  });

  test("NoopSink swallows emit and child returns itself", () => {
    const noop = new NoopSink();
    expect(() => noop.emit(evt("x"))).not.toThrow();
    expect(noop.child("y")).toBe(noop);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/sink.test.ts`
  Expected: fails — `has no exported member 'StampingSink'` (sink.ts not authored yet).

- [ ] **Step 2: Author `telemetry/sink.ts`** (the `TelemetrySink` interface, `SpanContext`, `StampingSink`, `InMemorySink`, `NoopSink`; `CompositeSink` is the next task).

  ```ts
  // packages/core/src/telemetry/sink.ts
  import { randomUUID } from "node:crypto";
  import type { TelemetryEvent } from "./signals";

  export interface TelemetrySink {
    emit(event: TelemetryEvent): void; // sync, non-throwing; never breaks the run
    child(name: string): TelemetrySink; // opens a nested span (run -> flow -> action)
  }

  /** Single per-run context: owns the monotonic sequence, mints span ids, threads parentSpanId. */
  export class SpanContext {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId?: string;
    private readonly counter: { value: number };

    constructor(traceId: string, parent?: SpanContext) {
      this.traceId = traceId;
      this.spanId = randomUUID();
      this.parentSpanId = parent?.spanId;
      // The sequence counter is shared across the whole run, not per span.
      this.counter = parent ? parent.counter : { value: 0 };
    }

    nextSequence(): number {
      const next = this.counter.value;
      this.counter.value += 1;
      return next;
    }

    child(): SpanContext {
      return new SpanContext(this.traceId, this);
    }
  }

  /** Pure recorder: stores events verbatim in append order. Stamping (traceId/spanId/
   *  sequence) is owned upstream by StampingSink — sinks never own counters (spec §6). */
  export class InMemorySink implements TelemetrySink {
    readonly events: TelemetryEvent[];

    constructor(events: TelemetryEvent[] = []) {
      this.events = events;
    }

    emit(event: TelemetryEvent): void {
      this.events.push(event);
    }

    child(_name: string): TelemetrySink {
      // child shares the SAME backing array (one flat event log per run)
      return new InMemorySink(this.events);
    }
  }

  /** The ONE place stamping happens: applies the run's traceId/spanId/parentSpanId and the
   *  monotonic sequence from a single shared SpanContext, then delegates to the inner sink.
   *  Stamping BEFORE fan-out means every downstream sink (InMemory, Jsonl) sees identical
   *  events — so the in-memory log and the on-disk JSONL never diverge. */
  export class StampingSink implements TelemetrySink {
    constructor(
      private readonly span: SpanContext,
      private readonly inner: TelemetrySink,
    ) {}

    emit(event: TelemetryEvent): void {
      this.inner.emit({
        ...event,
        traceId: this.span.traceId,
        spanId: this.span.spanId,
        ...(this.span.parentSpanId !== undefined ? { parentSpanId: this.span.parentSpanId } : {}),
        sequence: this.span.nextSequence(),
      });
    }

    child(name: string): TelemetrySink {
      return new StampingSink(this.span.child(), this.inner.child(name));
    }
  }

  export class NoopSink implements TelemetrySink {
    emit(): void {}
    child(): this {
      return this;
    }
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/sink.test.ts`
  Expected: `5 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/sink.ts packages/core/tests/sink.test.ts
  git commit -m "feat(core): span context, stamping, in-memory and noop sinks"
  ```
  Run: `git commit -m "feat(core): span context, stamping, in-memory and noop sinks"`
  Expected: commit succeeds; one commit created.

### S2 — Task 12: Core — CompositeSink fan-out (SEAM 3)

**Files:**
- Modify: `packages/core/src/telemetry/sink.ts`
- Test: `packages/core/tests/composite-sink.test.ts`

- [ ] **Step 1: Write the failing test.** Fans one `emit` to two `InMemorySink` members and proves `child()` returns a `CompositeSink` over each member's child.

  ```ts
  // packages/core/tests/composite-sink.test.ts
  import { test, expect } from "@playwright/test";
  import {
    CompositeSink,
    InMemorySink,
    TELEMETRY_SCHEMA_VERSION,
  } from "@sentinel/core";
  import type { TelemetryEnvelope } from "@sentinel/core";

  const evt = (name: string): TelemetryEnvelope => ({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: "e",
    type: "component.action",
    traceId: "x",
    spanId: "x",
    sequence: -1,
    name,
    timing: { startWallClockMs: 1, startMonotonicNs: 1n },
  });

  test("CompositeSink fans emit to every member", () => {
    const a = new InMemorySink();
    const b = new InMemorySink();
    const composite = new CompositeSink([a, b]);
    composite.emit(evt("hello"));
    expect(a.events.map((e) => e.name)).toEqual(["hello"]);
    expect(b.events.map((e) => e.name)).toEqual(["hello"]);
  });

  test("CompositeSink.child returns a composite over each member's child", () => {
    const a = new InMemorySink();
    const b = new InMemorySink();
    const composite = new CompositeSink([a, b]);
    const child = composite.child("flow");
    expect(child).toBeInstanceOf(CompositeSink);
    child.emit(evt("inner"));
    expect(a.events.map((e) => e.name)).toEqual(["inner"]);
    expect(b.events.map((e) => e.name)).toEqual(["inner"]);
    // members are independent backing arrays; child writes propagate to both
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/composite-sink.test.ts`
  Expected: fails — `has no exported member 'CompositeSink'`.

- [ ] **Step 2: Append `CompositeSink` to `telemetry/sink.ts`.** Add it after `NoopSink`.

  ```ts
  // packages/core/src/telemetry/sink.ts  (append at end of file)
  export class CompositeSink implements TelemetrySink {
    constructor(private readonly members: readonly TelemetrySink[]) {}

    emit(event: TelemetryEvent): void {
      for (const m of this.members) m.emit(event);
    }

    child(name: string): CompositeSink {
      return new CompositeSink(this.members.map((m) => m.child(name)));
    }
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/composite-sink.test.ts`
  Expected: `2 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/sink.ts packages/core/tests/composite-sink.test.ts
  git commit -m "feat(core): composite sink fan-out"
  ```
  Run: `git commit -m "feat(core): composite sink fan-out"`
  Expected: commit succeeds; one commit created.

### S2 — Task 13: Core — JsonlSink with bigint-stringifying replacer

**Files:**
- Create: `packages/core/src/telemetry/jsonl-sink.ts`
- Test: `packages/core/tests/jsonl-sink.test.ts`

> Uses `os.tmpdir()` for the temp path (per the S2 brief). The replacer `(_k, v) => typeof v === "bigint" ? v.toString() : v` is the documented bigint hazard fix (spec §6). I/O errors are swallowed (telemetry must never fail a run) and surfaced via `console.warn`.

- [ ] **Step 1: Write the failing test.** Writes two events to an `os.tmpdir()` file, reads them back, asserts one JSON line per event and that the stringified bigint ns survive the round-trip.

  ```ts
  // packages/core/tests/jsonl-sink.test.ts
  import { test, expect } from "@playwright/test";
  import { readFileSync, rmSync, existsSync } from "node:fs";
  import { join } from "node:path";
  import { tmpdir } from "node:os";
  import { randomUUID } from "node:crypto";
  import { JsonlSink, TELEMETRY_SCHEMA_VERSION } from "@sentinel/core";
  import type { TelemetryEnvelope } from "@sentinel/core";

  const evt = (name: string, start: bigint, end: bigint): TelemetryEnvelope => ({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: randomUUID(),
    type: "component.action",
    traceId: "run-1",
    spanId: "s",
    sequence: 0,
    name,
    timing: { startWallClockMs: 1, startMonotonicNs: start, endMonotonicNs: end, durationMs: 1 },
  });

  test("JsonlSink writes one JSON line per event and round-trips bigint timing", () => {
    const filePath = join(tmpdir(), `sentinel-jsonl-${randomUUID()}.jsonl`);
    try {
      const sink = new JsonlSink({ filePath });
      sink.emit(evt("first", 5_000_000n, 6_000_000n));
      sink.emit(evt("second", 7_000_000n, 9_500_000n));

      const lines = readFileSync(filePath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(parsed[0]?.name).toBe("first");
      // bigint fields are serialized as decimal strings and survive the round-trip
      const t0 = parsed[0]?.timing as Record<string, unknown>;
      expect(t0.startMonotonicNs).toBe("5000000");
      expect(t0.endMonotonicNs).toBe("6000000");
      expect(BigInt(t0.endMonotonicNs as string) - BigInt(t0.startMonotonicNs as string)).toBe(
        1_000_000n,
      );
    } finally {
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  test("JsonlSink.child returns a sink writing to the same file", () => {
    const filePath = join(tmpdir(), `sentinel-jsonl-${randomUUID()}.jsonl`);
    try {
      const sink = new JsonlSink({ filePath });
      sink.emit(evt("root", 1n, 2n));
      sink.child("flow").emit(evt("child", 3n, 4n));
      const lines = readFileSync(filePath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect((JSON.parse(lines[1]!) as { name: string }).name).toBe("child");
    } finally {
      if (existsSync(filePath)) rmSync(filePath);
    }
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/jsonl-sink.test.ts`
  Expected: fails — `has no exported member 'JsonlSink'`.

- [ ] **Step 2: Author `telemetry/jsonl-sink.ts`** (spec §6 `JsonlSink`; dir created on first write, errors swallowed + warned).

  ```ts
  // packages/core/src/telemetry/jsonl-sink.ts
  import { appendFileSync, mkdirSync } from "node:fs";
  import { dirname } from "node:path";
  import type { TelemetrySink } from "./sink";
  import type { TelemetryEvent } from "./signals";

  export interface JsonlSinkOptions {
    readonly filePath: string;
  }

  /** Stringifies bigint timing fields; JSON.stringify throws on bigint otherwise. */
  const bigintReplacer = (_k: string, v: unknown): unknown =>
    typeof v === "bigint" ? v.toString() : v;

  export class JsonlSink implements TelemetrySink {
    private readonly filePath: string;
    private dirEnsured = false;

    constructor(options: JsonlSinkOptions) {
      this.filePath = options.filePath;
    }

    emit(event: TelemetryEvent): void {
      try {
        if (!this.dirEnsured) {
          mkdirSync(dirname(this.filePath), { recursive: true });
          this.dirEnsured = true;
        }
        appendFileSync(this.filePath, `${JSON.stringify(event, bigintReplacer)}\n`);
      } catch (err) {
        // Telemetry must never fail a run: best-effort warn, never throw.
        console.warn(`JsonlSink write failed for ${this.filePath}:`, err);
      }
    }

    child(_name: string): TelemetrySink {
      // Shares the same file path; span naming is carried on the event envelope.
      return this;
    }
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/jsonl-sink.test.ts`
  Expected: `2 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/telemetry/jsonl-sink.ts packages/core/tests/jsonl-sink.test.ts
  git commit -m "feat(core): jsonl sink with bigint-safe serialization"
  ```
  Run: `git commit -m "feat(core): jsonl sink with bigint-safe serialization"`
  Expected: commit succeeds; one commit created.

### S2 — Task 14: Core — telemetry barrel + package barrel wiring

**Files:**
- Create: `packages/core/src/telemetry/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/telemetry-barrel.test.ts`

- [ ] **Step 1: Write the failing test.** Imports every telemetry export through the top-level `@sentinel/core` barrel to lock the public surface.

  ```ts
  // packages/core/tests/telemetry-barrel.test.ts
  import { test, expect } from "@playwright/test";
  import {
    TELEMETRY_SCHEMA_VERSION,
    SpanContext,
    StampingSink,
    InMemorySink,
    NoopSink,
    CompositeSink,
    JsonlSink,
    startTimer,
    durationMsFromNs,
  } from "@sentinel/core";

  test("telemetry public surface is re-exported from @sentinel/core", () => {
    expect(TELEMETRY_SCHEMA_VERSION).toBe("1.0.0");
    expect(typeof SpanContext).toBe("function");
    expect(typeof StampingSink).toBe("function");
    expect(typeof InMemorySink).toBe("function");
    expect(typeof NoopSink).toBe("function");
    expect(typeof CompositeSink).toBe("function");
    expect(typeof JsonlSink).toBe("function");
    expect(typeof startTimer).toBe("function");
    expect(typeof durationMsFromNs).toBe("function");
  });

  test("a CompositeSink([InMemorySink, JsonlSink]) is constructible from the barrel", () => {
    const composite = new CompositeSink([new InMemorySink()]);
    expect(composite).toBeInstanceOf(CompositeSink);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/telemetry-barrel.test.ts`
  Expected: fails — `has no exported member 'SpanContext'` (telemetry not yet re-exported from the package root).

- [ ] **Step 2: Author `telemetry/index.ts`.**

  ```ts
  // packages/core/src/telemetry/index.ts
  export { TELEMETRY_SCHEMA_VERSION } from "./event";
  export type { Timing, SpanStatus, TelemetryEventType, TelemetryEnvelope } from "./event";
  export type {
    LocatorResolvedEvent,
    AssertionEvent,
    RetryEvent,
    BusinessFailureEvent,
    SystemFailureEvent,
    ArtifactCapturedEvent,
    FlowFinishedEvent,
    TelemetryEvent,
  } from "./signals";
  export {
    TelemetrySink,
    SpanContext,
    StampingSink,
    InMemorySink,
    NoopSink,
    CompositeSink,
  } from "./sink";
  export { JsonlSink } from "./jsonl-sink";
  export type { JsonlSinkOptions } from "./jsonl-sink";
  export { startTimer, durationMsFromNs } from "./timers";
  export type { Timer, HrClock } from "./timers";
  ```

  > `TelemetrySink` is an `interface`; re-export it as a type to satisfy `consistent-type-imports`/`isolatedModules`. Replace the `TelemetrySink` line above with `export type { TelemetrySink } from "./sink";` and keep the class exports (`SpanContext`/`InMemorySink`/`NoopSink`/`CompositeSink`) as value exports. Final block:

  ```ts
  export type { TelemetrySink } from "./sink";
  export { SpanContext, StampingSink, InMemorySink, NoopSink, CompositeSink } from "./sink";
  ```

- [ ] **Step 3: Extend the package barrel.**

  ```ts
  // packages/core/src/index.ts
  export * from "./result";
  export * from "./errors";
  export * from "./telemetry";
  ```

- [ ] **Step 4: Run + typecheck — confirm PASS.**

  ```bash
  npm run test:unit -- packages/core/tests/telemetry-barrel.test.ts
  npm run typecheck
  ```
  Run: `npm run test:unit -- packages/core/tests/telemetry-barrel.test.ts`
  Expected: `2 passed`.
  Run: `npm run typecheck`
  Expected: exits 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/core/src/telemetry/index.ts packages/core/src/index.ts packages/core/tests/telemetry-barrel.test.ts
  git commit -m "feat(core): telemetry barrel and package re-exports"
  ```
  Run: `git commit -m "feat(core): telemetry barrel and package re-exports"`
  Expected: commit succeeds; one commit created.

### S2 — Task 15: Core — locator StrategyRegistry with §7 rank defaults

**Files:**
- Create: `packages/core/src/locator/strategy-registry.ts`
- Test: `packages/core/tests/strategy-registry.test.ts`

> The §7 rank table: `role`=0, `label`=1, `text`=2, `placeholder`/`altText`/`title`=3, `testid`=4, `relative`=5, `css`/`xpath`=6. `StrategyRegistry` seeds these defaults in its constructor; `register` overrides/adds; `rankOf` returns the registered rank or the migration bottom rung (6) for unknown open kinds so a css-only driver always has a usable fallback rank.

- [ ] **Step 1: Write the failing test** covering `rankOf` for role/label/text/testid/css/xpath, the rank-3 group, `register` override, and the unknown-kind default.

  ```ts
  // packages/core/tests/strategy-registry.test.ts
  import { test, expect } from "@playwright/test";
  import { StrategyRegistry } from "@sentinel/core";

  test("default ranks follow the §7 durability table", () => {
    const reg = new StrategyRegistry();
    expect(reg.rankOf("role")).toBe(0);
    expect(reg.rankOf("label")).toBe(1);
    expect(reg.rankOf("text")).toBe(2);
    expect(reg.rankOf("placeholder")).toBe(3);
    expect(reg.rankOf("altText")).toBe(3);
    expect(reg.rankOf("title")).toBe(3);
    expect(reg.rankOf("testid")).toBe(4);
    expect(reg.rankOf("relative")).toBe(5);
    expect(reg.rankOf("css")).toBe(6);
    expect(reg.rankOf("xpath")).toBe(6);
  });

  test("unknown open kinds default to the migration bottom rung (6)", () => {
    const reg = new StrategyRegistry();
    expect(reg.rankOf("-ios predicate string")).toBe(6);
    expect(reg.rankOf("accessibility id")).toBe(6);
  });

  test("register overrides an existing rank and adds new kinds", () => {
    const reg = new StrategyRegistry();
    reg.register("accessibility id", { rank: 1 });
    expect(reg.rankOf("accessibility id")).toBe(1);
    reg.register("css", { rank: 9 });
    expect(reg.rankOf("css")).toBe(9);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/strategy-registry.test.ts`
  Expected: fails — `has no exported member 'StrategyRegistry'`.

- [ ] **Step 2: Author `locator/strategy-registry.ts`** (spec §7).

  ```ts
  // packages/core/src/locator/strategy-registry.ts
  import type { StrategyKind } from "@sentinel/contracts";

  export interface StrategyMeta {
    readonly rank: number;
  } // lower = more durable

  /** css/xpath are the universally-supported migration bottom rung; unknown open kinds default here. */
  const BOTTOM_RUNG_RANK = 6;

  const DEFAULT_RANKS: ReadonlyArray<readonly [StrategyKind, number]> = [
    ["role", 0],
    ["label", 1],
    ["text", 2],
    ["placeholder", 3],
    ["altText", 3],
    ["title", 3],
    ["testid", 4],
    ["relative", 5],
    ["css", 6],
    ["xpath", 6],
  ];

  export class StrategyRegistry {
    private readonly ranks = new Map<StrategyKind, number>();

    constructor() {
      for (const [kind, rank] of DEFAULT_RANKS) this.ranks.set(kind, rank);
    }

    register(kind: StrategyKind, meta: StrategyMeta): void {
      this.ranks.set(kind, meta.rank);
    }

    rankOf(kind: StrategyKind): number {
      return this.ranks.get(kind) ?? BOTTOM_RUNG_RANK;
    }
  }
  ```

- [ ] **Step 3: Run — confirm PASS.**

  Run: `npm run test:unit -- packages/core/tests/strategy-registry.test.ts`
  Expected: `3 passed`.

- [ ] **Step 4: Commit.**

  ```bash
  git add packages/core/src/locator/strategy-registry.ts packages/core/tests/strategy-registry.test.ts
  git commit -m "feat(core): durability-ranked strategy registry"
  ```
  Run: `git commit -m "feat(core): durability-ranked strategy registry"`
  Expected: commit succeeds; one commit created.

### S2 — Task 16: Core — locator engine interfaces + locator/core barrels

**Files:**
- Create: `packages/core/src/locator/engine.ts`
- Create: `packages/core/src/locator/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/engine.test.ts`

- [ ] **Step 1: Write the failing test.** Constructs a conforming `LocatorResolution` and a stub `LocatorResolver` returning it, and pulls both plus `StrategyRegistry` through the top-level barrel.

  ```ts
  // packages/core/tests/engine.test.ts
  import { test, expect } from "@playwright/test";
  import { StrategyRegistry } from "@sentinel/core";
  import type { LocatorResolution, LocatorResolver } from "@sentinel/core";
  import type { ElementHandle, Locator } from "@sentinel/contracts";

  const loc: Locator = {
    logicalName: "auth.login.submit",
    candidates: [{ kind: "css", value: "button" }],
    within: (p) => p,
  };
  const handle: ElementHandle = {
    locator: loc,
    exists: async () => true,
    isVisible: async () => true,
    isEnabled: async () => true,
    text: async () => "Login",
    attribute: async () => null,
  };

  test("LocatorResolution carries handle, resolvedKind/Rank, degraded and score", () => {
    const resolution: LocatorResolution = {
      handle,
      resolvedKind: "css",
      resolvedRank: 6,
      degraded: true,
      score: 1,
    };
    expect(resolution.degraded).toBe(true);
    expect(resolution.resolvedRank).toBe(6);
  });

  test("LocatorResolver is satisfiable and resolves to a LocatorResolution", async () => {
    const resolver: LocatorResolver = {
      resolve: async (l) => ({
        handle: { ...handle, locator: l },
        resolvedKind: "css",
        resolvedRank: 6,
        degraded: true,
        score: 1,
      }),
    };
    const res = await resolver.resolve(loc);
    expect(res.handle.locator.logicalName).toBe("auth.login.submit");
    expect(new StrategyRegistry().rankOf(res.resolvedKind)).toBe(6);
  });
  ```

  Run: `npm run test:unit -- packages/core/tests/engine.test.ts`
  Expected: fails — `has no exported member 'LocatorResolution'` / `'LocatorResolver'`.

- [ ] **Step 2: Author `locator/engine.ts`** (spec §7, verbatim).

  ```ts
  // packages/core/src/locator/engine.ts
  import type { ElementHandle, Locator, StrategyKind } from "@sentinel/contracts";

  export interface LocatorResolution {
    handle: ElementHandle;
    resolvedKind: StrategyKind;
    resolvedRank: number;
    degraded: boolean;
    score: number;
  }

  export interface LocatorResolver {
    resolve(locator: Locator): Promise<LocatorResolution>;
  }
  ```

- [ ] **Step 3: Author `locator/index.ts`** and extend the package barrel.

  ```ts
  // packages/core/src/locator/index.ts
  export { StrategyRegistry } from "./strategy-registry";
  export type { StrategyMeta } from "./strategy-registry";
  export type { LocatorResolution, LocatorResolver } from "./engine";
  ```

  ```ts
  // packages/core/src/index.ts
  export * from "./result";
  export * from "./errors";
  export * from "./telemetry";
  export * from "./locator";
  ```

- [ ] **Step 4: Run + typecheck — confirm PASS.**

  ```bash
  npm run test:unit -- packages/core/tests/engine.test.ts
  npm run typecheck
  ```
  Run: `npm run test:unit -- packages/core/tests/engine.test.ts`
  Expected: `2 passed`.
  Run: `npm run typecheck`
  Expected: exits 0, no output.

- [ ] **Step 5: Commit.**

  ```bash
  git add packages/core/src/locator/engine.ts packages/core/src/locator/index.ts packages/core/src/index.ts packages/core/tests/engine.test.ts
  git commit -m "feat(core): locator engine interfaces and barrel"
  ```
  Run: `git commit -m "feat(core): locator engine interfaces and barrel"`
  Expected: commit succeeds; one commit created.

### S2 — Task 17: S2 acceptance gate — full typecheck + unit suite + Playwright-import audit

**Files:**
- Test: (no new file — runs the full S2 acceptance subset)

- [ ] **Step 1: Run the complete unit suite (all S2 packages).**

  ```bash
  npm run test:unit
  ```
  Run: `npm run test:unit`
  Expected: all `packages/**/tests/**` specs pass (contracts: capability-locator, action, assertion, session-driver; core: result, system-failure-error, error-kinds, telemetry-event, telemetry-signals, timers, sink, composite-sink, jsonl-sink, telemetry-barrel, strategy-registry, engine) — final line reports the total count and `passed`, `0 failed`.

- [ ] **Step 2: Run the full type-check across all wired packages.**

  ```bash
  npm run typecheck
  ```
  Run: `npm run typecheck`
  Expected: exits 0, no output (`tsc -b` clean under `strict` + `noUncheckedIndexedAccess`, §10.2).

- [ ] **Step 3: Audit that no `@playwright/test` import leaks into contracts/core `src` (only the tests dirs may import it, per the locked exemption).**

  ```bash
  ! grep -rn "@playwright/test" packages/contracts/src packages/core/src
  ```
  Run: `! grep -rn "@playwright/test" packages/contracts/src packages/core/src`
  Expected: exits 0 (no matches printed; the `!` inverts grep's "not found" exit so a clean tree passes). If any line prints, the audit fails.

- [ ] **Step 4: Run lint to confirm the boundary + typed rules hold on the new files.**

  ```bash
  npm run lint
  ```
  Run: `npm run lint`
  Expected: exits 0, no warnings/errors (`--max-warnings=0`); `no-restricted-imports` reports nothing for `packages/contracts/src` and `packages/core/src`.

- [ ] **Step 5: Commit the gate marker (an empty allowed commit recording the green S2 gate).**

  ```bash
  git commit --allow-empty -m "test(core): S2 contracts + core types acceptance gate green"
  ```
  Run: `git commit --allow-empty -m "test(core): S2 contracts + core types acceptance gate green"`
  Expected: commit succeeds; one commit created.

---

**S2 author notes.** 17 bite-sized TDD tasks cover `@sentinel/contracts` (capability/locator/element/action/assertion/session/driver + barrel) and `@sentinel/core` (result factories, the 6-subclass error taxonomy, telemetry envelope/signals/timers/SpanContext/InMemorySink/NoopSink/CompositeSink/JsonlSink, and the locator StrategyRegistry + engine interfaces), each with a failing-test-first loop, complete copy-pasteable code (exact spec type names/signatures/paths), exact `Run:`/`Expected:` lines, and a Conventional-Commit step, plus a final acceptance gate (typecheck + full unit suite + Playwright-import audit + lint).

Three spec-faithful interpretation decisions I flagged inline (not deviations from any named type):
- `Session.telemetry` is typed via a minimal structural `TelemetrySinkLike` declared in `contracts/session.ts` to avoid a `contracts → core` dependency cycle (core's `TelemetrySink` stays structurally assignable). The spec types `telemetry: TelemetrySink` but `TelemetrySink` lives in `@sentinel/core`, which depends on contracts, so a literal import would create a cycle.
- Added a `TelemetryEvent` union (LocatorResolved/Assertion/Retry/BusinessFailure/SystemFailure/ArtifactCaptured/FlowFinished | TelemetryEnvelope) as the `TelemetrySink.emit` parameter type — the spec's `emit(event: TelemetryEvent)` references this union without giving its definition.
- `StrategyRegistry.rankOf` returns rank 6 (the css/xpath migration bottom rung) for unknown open `StrategyKind`s, consistent with §7's "every locator must include a universally-supported candidate" guarantee; the spec table fixes ranks but does not specify the default for unregistered kinds.

These were authored against the assumption that S1 has already created the workspace skeleton (package dirs/tsconfigs, root `playwright.unit.config.ts`, `test:unit`/`typecheck` scripts, and the `packages/**/tests/**` lint exemption); I noted that precondition explicitly at the top of the fragment. The repo working tree is still the flat pre-S1 layout, so these tasks are not yet runnable until S1 lands.

---

> Sub-step S3 — `@sentinel/driver-playwright`

Implements the Playwright adapter — the only package allowed to import `@playwright/test` — over the contracts from S2: strategy-compiler, resolver (emitting `locator.resolved` before any handle is usable), element/action (auto-wait actionability), assertion (`waitFor` + driver-owned `waitForFirstOf` race with loser-cancellation), session, and driver (the single guarded `existingPage` duck-type). Browser-backed tests use `page.setContent()` and an injected `InMemorySink` to prove the four §7 obligations, with §10.5 (race throws `TimeoutError` carrying `branchProgress[]`, never resolves-on-timeout) as the load-bearing fix.

### S3 — Task 1: Scaffold `@sentinel/driver-playwright` package (the only Playwright importer)

**Files:**
- Create: `packages/driver-playwright/package.json`
- Create: `packages/driver-playwright/tsconfig.json`
- Create: `packages/driver-playwright/src/index.ts`
- Test: `packages/driver-playwright/tests/package-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test.** It asserts the package barrel re-exports `PlaywrightDriver` and that the package depends on `@playwright/test`.

```ts
// packages/driver-playwright/tests/package-wiring.test.ts
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

test("barrel exposes PlaywrightDriver", async () => {
  const mod = await import("@sentinel/driver-playwright");
  expect(typeof (mod as Record<string, unknown>).PlaywrightDriver).toBe(
    "function",
  );
});

test("package declares @playwright/test as a dependency", () => {
  const pkgPath = path.join(__dirname, "..", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  expect(pkg.dependencies?.["@playwright/test"]).toBeTruthy();
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/package-wiring.test.ts
```
Expected: FAILS — `Cannot find module '@sentinel/driver-playwright'` (or `PlaywrightDriver` is not a function).

- [ ] **Step 2: Create the package manifest.** `@playwright/test` is a real dependency here (the only package allowed); depends on contracts + core via `paths`.

```json
// packages/driver-playwright/package.json
{
  "name": "@sentinel/driver-playwright",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "src/index.ts",
  "dependencies": {
    "@playwright/test": "^1.58.2",
    "@sentinel/contracts": "1.0.0",
    "@sentinel/core": "1.0.0"
  }
}
```

- [ ] **Step 3: Create the package tsconfig.** Composite + references to its two dependency packages per spec §2.

```json
// packages/driver-playwright/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../contracts" },
    { "path": "../core" }
  ]
}
```

- [ ] **Step 4: Create a minimal barrel so the import resolves.** Re-export the driver (added in Task 7); for now create the class stub so the wiring test's first assertion can pass once the file exists.

```ts
// packages/driver-playwright/src/index.ts
export { PlaywrightDriver } from "./driver";
```

- [ ] **Step 5: Create a minimal `driver.ts` placeholder** so the barrel resolves (filled out in Task 7).

```ts
// packages/driver-playwright/src/driver.ts
export class PlaywrightDriver {}
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/package-wiring.test.ts
```
Expected: PASS — `2 passed`.

- [ ] **Step 6: Commit.**

```bash
git add packages/driver-playwright/package.json packages/driver-playwright/tsconfig.json packages/driver-playwright/src/index.ts packages/driver-playwright/src/driver.ts packages/driver-playwright/tests/package-wiring.test.ts
git commit -m "feat(web): scaffold @sentinel/driver-playwright package"
```
Expected: commit succeeds; commitlint passes.

---

### S3 — Task 2: Strategy compiler — `LocatorStrategy` → Playwright `Locator`

**Files:**
- Create: `packages/driver-playwright/src/strategy-compiler.ts`
- Test: `packages/driver-playwright/tests/strategy-compiler.test.ts`

- [ ] **Step 1: Write the failing compiler test.** Drives a real `page` against `setContent`, exercising every kind (role/label/text/testid/css/xpath) and asserting each compiled `Locator` resolves the intended node.

```ts
// packages/driver-playwright/tests/strategy-compiler.test.ts
import { test, expect } from "@playwright/test";
import type { LocatorStrategy } from "@sentinel/contracts";
import { compileStrategy } from "../src/strategy-compiler";

const HTML = `
  <label for="email">Email</label><input id="email" />
  <span data-testid="greeting">hello</span>
  <p class="note">plain text</p>
  <button type="submit" class="go">Login</button>
`;

test("compiles role with name+exact", async ({ page }) => {
  await page.setContent(HTML);
  const s: LocatorStrategy = {
    kind: "role",
    value: "button",
    options: { name: "Login", exact: true },
  };
  await expect(compileStrategy(page, s)).toHaveText("Login");
});

test("compiles label, text, testid", async ({ page }) => {
  await page.setContent(HTML);
  await expect(
    compileStrategy(page, { kind: "label", value: "Email" }),
  ).toHaveAttribute("id", "email");
  await expect(
    compileStrategy(page, { kind: "text", value: "plain text" }),
  ).toHaveClass("note");
  await expect(
    compileStrategy(page, { kind: "testid", value: "greeting" }),
  ).toHaveText("hello");
});

test("compiles css and xpath via page.locator", async ({ page }) => {
  await page.setContent(HTML);
  await expect(
    compileStrategy(page, { kind: "css", value: "button.go" }),
  ).toHaveText("Login");
  await expect(
    compileStrategy(page, { kind: "xpath", value: "//button[@class='go']" }),
  ).toHaveText("Login");
});

test("throws on a kind it cannot compile", async ({ page }) => {
  await page.setContent(HTML);
  expect(() =>
    compileStrategy(page, { kind: "image", value: "x" }),
  ).toThrow(/unsupported strategy kind/i);
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/strategy-compiler.test.ts
```
Expected: FAILS — `Cannot find module '../src/strategy-compiler'`.

- [ ] **Step 2: Implement the compiler.** Maps each kind to the corresponding Playwright getter; css/xpath go through `page.locator`; unknown kinds throw (the resolver SKIPS unsupported kinds before reaching here, so this throw is a defensive guard).

```ts
// packages/driver-playwright/src/strategy-compiler.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type { LocatorStrategy } from "@sentinel/contracts";

type Aria =
  | "button"
  | "link"
  | "textbox"
  | "checkbox"
  | "radio"
  | "heading"
  | "tab"
  | "menuitem"
  | "option"
  | "combobox"
  | "listbox"
  | "dialog"
  | "alert";

function readName(
  options: LocatorStrategy["options"],
): { name?: string; exact?: boolean } {
  const name = options?.["name"];
  const exact = options?.["exact"];
  return {
    name: typeof name === "string" ? name : undefined,
    exact: typeof exact === "boolean" ? exact : undefined,
  };
}

export function compileStrategy(
  scope: Page | PwLocator,
  strategy: LocatorStrategy,
): PwLocator {
  switch (strategy.kind) {
    case "role": {
      const { name, exact } = readName(strategy.options);
      return scope.getByRole(strategy.value as Aria, { name, exact });
    }
    case "label": {
      const { exact } = readName(strategy.options);
      return scope.getByLabel(strategy.value, { exact });
    }
    case "text": {
      const { exact } = readName(strategy.options);
      return scope.getByText(strategy.value, { exact });
    }
    case "testid":
      return scope.getByTestId(strategy.value);
    case "css":
    case "xpath":
      return scope.locator(strategy.value);
    default:
      throw new Error(
        `unsupported strategy kind: "${strategy.kind}" (compiler only handles role|label|text|testid|css|xpath)`,
      );
  }
}
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/strategy-compiler.test.ts
```
Expected: PASS — `4 passed`.

- [ ] **Step 3: Commit.**

```bash
git add packages/driver-playwright/src/strategy-compiler.ts packages/driver-playwright/tests/strategy-compiler.test.ts
git commit -m "feat(web): compile LocatorStrategy to Playwright Locator"
```
Expected: commit succeeds.

---

### S3 — Task 3: Resolver — emits `locator.resolved` BEFORE returning, skips unsupported, throws on miss/ambiguous

**Files:**
- Create: `packages/driver-playwright/src/element.ts`
- Create: `packages/driver-playwright/src/resolver.ts`
- Test: `packages/driver-playwright/tests/resolver.test.ts`

- [ ] **Step 1: Write the failing resolver test.** Injects an `InMemorySink`; asserts (a) the emit happens BEFORE the handle is usable and (b) `resolvedRank>0` (degraded) when the primary candidate is absent but a fallback matches; (c) unsupported kinds are recorded `skipped`; (d) all-miss throws `SelectorNotFoundError` with `attempted[]`; (e) >1 match throws `SelectorAmbiguousError`.

```ts
// packages/driver-playwright/tests/resolver.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink } from "@sentinel/core";
import {
  SelectorNotFoundError,
  SelectorAmbiguousError,
} from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);

const HTML = `
  <button class="go" type="submit">Login</button>
  <span class="dup">a</span><span class="dup">b</span>
`;

function makeResolver(page: Parameters<typeof page.setContent>[0] extends never ? never : import("@playwright/test").Page, sink: InMemorySink) {
  return new PlaywrightResolver(page, STRATEGIES, sink, {
    correlationId: "corr-1",
    flowName: "test.flow",
    startedAt: Date.now(),
  });
}

test("emits locator.resolved BEFORE the handle is usable, degraded when primary missing", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Absent" } }, // rank 0, misses
      { kind: "css", value: "button.go" }, // rank 6 fallback, matches
    ],
  } as Locator;

  // Sink is empty until resolve() emits.
  expect(sink.events).toHaveLength(0);

  const resolution = await resolver.resolve(locator);

  // The emit happened, and it happened before we ever touched the handle.
  const resolved = sink.events.find((e) => e.type === "locator.resolved");
  expect(resolved).toBeDefined();
  expect(resolution.degraded).toBe(true);
  expect(resolution.resolvedKind).toBe("css");
  expect(resolution.resolvedRank).toBeGreaterThan(0);

  // candidates[] records the primary as missed, fallback as matched.
  const ev = resolved as unknown as {
    candidates: { kind: string; outcome: string }[];
  };
  expect(ev.candidates.find((c) => c.kind === "role")?.outcome).toBe("missed");
  expect(ev.candidates.find((c) => c.kind === "css")?.outcome).toBe("matched");

  // Handle is usable AFTER (proves emit-before-return ordering).
  await expect(resolution.handle.isVisible()).resolves.toBe(true);
});

test("skips kinds the driver does not advertise", async ({ page }) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "image", value: "x" }, // not in STRATEGIES -> skipped
      { kind: "css", value: "button.go" },
    ],
  } as Locator;

  await resolver.resolve(locator);
  const ev = sink.events.find((e) => e.type === "locator.resolved") as unknown as {
    candidates: { kind: string; outcome: string }[];
  };
  expect(ev.candidates.find((c) => c.kind === "image")?.outcome).toBe("skipped");
});

test("throws SelectorNotFoundError with attempted[] when all supported miss", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.login.ghost",
    candidates: [{ kind: "css", value: "button.does-not-exist" }],
  } as Locator;

  await expect(resolver.resolve(locator)).rejects.toBeInstanceOf(
    SelectorNotFoundError,
  );
  try {
    await resolver.resolve(locator);
  } catch (err) {
    const e = err as SelectorNotFoundError;
    expect(e.context.logicalName).toBe("auth.login.ghost");
    expect(e.context.attempted?.[0]?.matched).toBe(false);
  }
});

test("throws SelectorAmbiguousError on >1 match", async ({ page }) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const resolver = makeResolver(page, sink);

  const locator: Locator = {
    logicalName: "auth.dup",
    candidates: [{ kind: "css", value: "span.dup" }],
  } as Locator;

  await expect(resolver.resolve(locator)).rejects.toBeInstanceOf(
    SelectorAmbiguousError,
  );
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/resolver.test.ts
```
Expected: FAILS — `Cannot find module '../src/resolver'`.

- [ ] **Step 2: Implement `PlaywrightElementHandle` (re-resolves per call).** Each method recompiles the winning candidate against the page so there are no stale handles (spec §3.3).

```ts
// packages/driver-playwright/src/element.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type { ElementHandle, Locator, LocatorStrategy } from "@sentinel/contracts";
import { compileStrategy } from "./strategy-compiler";

/** Re-resolves the winning candidate per call — no cached live handle (spec §3.3). */
export class PlaywrightElementHandle implements ElementHandle {
  constructor(
    private readonly page: Page,
    readonly locator: Locator,
    private readonly winner: LocatorStrategy,
  ) {}

  private compile(): PwLocator {
    return compileStrategy(this.page, this.winner);
  }

  async exists(): Promise<boolean> {
    return (await this.compile().count()) > 0;
  }

  async isVisible(): Promise<boolean> {
    return this.compile().isVisible();
  }

  async isEnabled(): Promise<boolean> {
    return this.compile().isEnabled();
  }

  async text(): Promise<string> {
    return (await this.compile().textContent()) ?? "";
  }

  async attribute(name: string): Promise<string | null> {
    return this.compile().getAttribute(name);
  }
}
```

- [ ] **Step 3: Implement `PlaywrightResolver`.** Iterate candidates; SKIP kinds not in `strategies`; compile each supported candidate; `count()===0` → `missed`; `count()>1` → throw `SelectorAmbiguousError`; first unique match wins; EMIT `locator.resolved` BEFORE returning; throw `SelectorNotFoundError` with `attempted[]` if all supported miss. Uses the `StrategyRegistry` rank to set `resolvedRank`.

```ts
// packages/driver-playwright/src/resolver.ts
import type { Page } from "@playwright/test";
import type {
  Locator,
  LocatorStrategy,
  StrategyKind,
} from "@sentinel/contracts";
import type { LocatorResolution, LocatorResolver } from "@sentinel/core";
import {
  SelectorAmbiguousError,
  SelectorNotFoundError,
  StrategyRegistry,
  defaultStrategyRegistry,
} from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { PlaywrightElementHandle } from "./element";
import { compileStrategy } from "./strategy-compiler";

interface ResolverContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

type CandidateOutcome = "matched" | "missed" | "skipped";
interface CandidateRecord {
  readonly kind: StrategyKind;
  readonly outcome: CandidateOutcome;
  readonly rank: number;
}

export class PlaywrightResolver implements LocatorResolver {
  constructor(
    private readonly page: Page,
    private readonly strategies: ReadonlySet<StrategyKind>,
    private readonly sink: TelemetrySink,
    private readonly ctx: ResolverContext,
    private readonly registry: StrategyRegistry = defaultStrategyRegistry,
  ) {}

  async resolve(locator: Locator): Promise<LocatorResolution> {
    const start = process.hrtime.bigint();
    const records: CandidateRecord[] = [];
    let winner: { strategy: LocatorStrategy; rank: number } | null = null;

    for (const candidate of locator.candidates) {
      const rank = this.registry.rankOf(candidate.kind);

      if (!this.strategies.has(candidate.kind)) {
        records.push({ kind: candidate.kind, outcome: "skipped", rank });
        continue;
      }

      const count = await compileStrategy(this.page, candidate).count();
      if (count === 0) {
        records.push({ kind: candidate.kind, outcome: "missed", rank });
        continue;
      }
      if (count > 1) {
        this.throwAmbiguous(locator, candidate, count, records);
      }

      records.push({ kind: candidate.kind, outcome: "matched", rank });
      winner = { strategy: candidate, rank };
      break;
    }

    if (winner === null) {
      throw new SelectorNotFoundError(
        `No supported candidate resolved for "${locator.logicalName}"`,
        {
          correlationId: this.ctx.correlationId,
          flowName: this.ctx.flowName,
          startedAt: this.ctx.startedAt,
          durationMs: Number(process.hrtime.bigint() - start) / 1e6,
          logicalName: locator.logicalName,
          attempted: records
            .filter((r) => r.outcome !== "skipped")
            .map((r) => ({
              strategy: r.kind,
              matched: r.outcome === "matched",
              rank: r.rank,
            })),
        },
      );
    }

    const resolveDurationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const degraded = winner.rank > 0;

    // EMIT BEFORE returning the handle (spec §6/§7 obligation a).
    this.sink.emit({
      schemaVersion: "1.0.0",
      eventId: cryptoRandom(),
      type: "locator.resolved",
      traceId: this.ctx.correlationId,
      spanId: cryptoRandom(),
      sequence: 0,
      name: locator.logicalName,
      timing: {
        startWallClockMs: this.ctx.startedAt,
        startMonotonicNs: start,
        endMonotonicNs: process.hrtime.bigint(),
        durationMs: resolveDurationMs,
      },
      logicalName: locator.logicalName,
      resolvedKind: winner.strategy.kind,
      resolvedRank: winner.rank,
      degraded,
      candidates: records,
      score: 1.0,
      resolveDurationMs,
    });

    return {
      handle: new PlaywrightElementHandle(this.page, locator, winner.strategy),
      resolvedKind: winner.strategy.kind,
      resolvedRank: winner.rank,
      degraded,
      score: 1.0,
    };
  }

  private throwAmbiguous(
    locator: Locator,
    candidate: LocatorStrategy,
    count: number,
    records: CandidateRecord[],
  ): never {
    throw new SelectorAmbiguousError(
      `"${locator.logicalName}" matched ${count} elements via ${candidate.kind}`,
      {
        correlationId: this.ctx.correlationId,
        flowName: this.ctx.flowName,
        startedAt: this.ctx.startedAt,
        durationMs: 0,
        logicalName: locator.logicalName,
        attempted: [
          ...records.map((r) => ({
            strategy: r.kind,
            matched: r.outcome === "matched",
            rank: r.rank,
          })),
          {
            strategy: candidate.kind,
            matched: true,
            rank: this.registry.rankOf(candidate.kind),
          },
        ],
      },
    );
  }
}

function cryptoRandom(): string {
  return globalThis.crypto.randomUUID();
}
```

> Note: this task assumes S2 exported `defaultStrategyRegistry` (a `StrategyRegistry` pre-seeded with the §7 rank table) and `StrategyRegistry.rankOf` from `@sentinel/core`. If S2 named the pre-seeded instance differently, construct one inline here: `const reg = new StrategyRegistry(); reg.register("role",{rank:0}); … reg.register("css",{rank:6}); reg.register("xpath",{rank:6});` — the rank table is spec §7.

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/resolver.test.ts
```
Expected: PASS — `4 passed`.

- [ ] **Step 4: Commit.**

```bash
git add packages/driver-playwright/src/element.ts packages/driver-playwright/src/resolver.ts packages/driver-playwright/tests/resolver.test.ts
git commit -m "feat(web): resolver emits locator.resolved before returning handle"
```
Expected: commit succeeds.

---

### S3 — Task 4: Action layer — tap/typeText/clear/read via resolver + Playwright auto-wait

**Files:**
- Create: `packages/driver-playwright/src/action.ts`
- Test: `packages/driver-playwright/tests/action.test.ts`

- [ ] **Step 1: Write the failing action test.** Asserts each verb routes through the resolver (so a `locator.resolved` event is emitted per action) and mutates/reads the DOM via Playwright's actionability auto-wait.

```ts
// packages/driver-playwright/tests/action.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink } from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAction } from "../src/action";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const HTML = `
  <input id="user" />
  <button class="go" type="submit">Login</button>
  <span class="msg">ready</span>
`;

const user: Locator = {
  logicalName: "x.user",
  candidates: [{ kind: "css", value: "#user" }],
} as Locator;
const submit: Locator = {
  logicalName: "x.submit",
  candidates: [{ kind: "css", value: "button.go" }],
} as Locator;
const msg: Locator = {
  logicalName: "x.msg",
  candidates: [{ kind: "css", value: "span.msg" }],
} as Locator;

function makeAction(page: import("@playwright/test").Page, sink: InMemorySink) {
  return new PlaywrightAction(
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
  );
}

test("typeText then read round-trips and emits a resolve per call", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const action = makeAction(page, sink);

  await action.typeText(user, "alice");
  expect(await action.read(user)).toBe("alice");

  const resolves = sink.events.filter((e) => e.type === "locator.resolved");
  expect(resolves.length).toBeGreaterThanOrEqual(2);
});

test("clear empties an input", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  await action.typeText(user, "bob");
  await action.clear(user);
  expect(await action.read(user)).toBe("");
});

test("tap clicks the resolved element", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  await page.evaluate(
    () =>
      document
        .querySelector("button.go")
        ?.addEventListener("click", () => {
          document.querySelector("span.msg")!.textContent = "clicked";
        }),
  );
  await action.tap(submit);
  await expect(page.locator("span.msg")).toHaveText("clicked");
});

test("read returns text content of a non-input element", async ({ page }) => {
  await page.setContent(HTML);
  const action = makeAction(page, new InMemorySink());
  expect(await action.read(msg)).toBe("ready");
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/action.test.ts
```
Expected: FAILS — `Cannot find module '../src/action'`.

- [ ] **Step 2: Implement `PlaywrightAction`.** Each verb resolves (emitting `locator.resolved`), then recompiles the winner and uses Playwright's auto-waiting `fill`/`click`/`inputValue`/`textContent`. `read` prefers `inputValue` for form fields, falling back to `textContent`.

```ts
// packages/driver-playwright/src/action.ts
import type { Locator as PwLocator } from "@playwright/test";
import type { Action, Locator } from "@sentinel/contracts";
import type { LocatorResolver } from "@sentinel/core";
import type { PlaywrightElementHandle } from "./element";
import { compileStrategy } from "./strategy-compiler";

interface CompilableHandle {
  // PlaywrightElementHandle exposes its winner indirectly via the page+strategy;
  // we recompile from the handle's locator winner through a small accessor.
}

export class PlaywrightAction implements Action {
  constructor(private readonly resolver: LocatorResolver) {}

  private async pwLocator(target: Locator): Promise<PwLocator> {
    const resolution = await this.resolver.resolve(target);
    const handle = resolution.handle as PlaywrightElementHandle;
    return handle.compileWinner();
  }

  async tap(target: Locator): Promise<void> {
    await (await this.pwLocator(target)).click();
  }

  async typeText(target: Locator, text: string): Promise<void> {
    await (await this.pwLocator(target)).fill(text);
  }

  async clear(target: Locator): Promise<void> {
    await (await this.pwLocator(target)).fill("");
  }

  async read(target: Locator): Promise<string> {
    const locator = await this.pwLocator(target);
    const tag = await locator.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return locator.inputValue();
    }
    return (await locator.textContent()) ?? "";
  }
}

// `compileStrategy` import kept for handles that need direct compilation in tests.
export { compileStrategy };
```

- [ ] **Step 3: Expose `compileWinner()` on the handle** so the action can recompile the winning candidate (auto-wait actionability lives on the Playwright `Locator`).

```ts
// packages/driver-playwright/src/element.ts  (add method to PlaywrightElementHandle)
  /** The winning candidate recompiled into a fresh Playwright Locator (auto-wait actionability). */
  compileWinner(): PwLocator {
    return this.compile();
  }
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/action.test.ts
```
Expected: PASS — `4 passed`.

- [ ] **Step 4: Commit.**

```bash
git add packages/driver-playwright/src/action.ts packages/driver-playwright/src/element.ts packages/driver-playwright/tests/action.test.ts
git commit -m "feat(web): action verbs route through resolver with auto-wait"
```
Expected: commit succeeds.

---

### S3 — Task 5: Assertion — `waitFor` throws `TimeoutError` (not a bare Error) on a missing element

**Files:**
- Create: `packages/driver-playwright/src/assertion.ts`
- Test: `packages/driver-playwright/tests/assertion-waitfor.test.ts`

- [ ] **Step 1: Write the failing `waitFor` test.** Asserts (a) a reachable state resolves and emits an `assertion` event; (b) a missing element throws `TimeoutError` (the §10.5-class fix — never a bare `Error`) carrying timing context.

```ts
// packages/driver-playwright/tests/assertion-waitfor.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, TimeoutError } from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAssertion } from "../src/assertion";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const HTML = `<button class="go">Login</button>`;

const present: Locator = {
  logicalName: "x.present",
  candidates: [{ kind: "css", value: "button.go" }],
} as Locator;
const absent: Locator = {
  logicalName: "x.absent",
  candidates: [{ kind: "css", value: "button.missing" }],
} as Locator;

function makeAssert(page: import("@playwright/test").Page, sink: InMemorySink) {
  return new PlaywrightAssertion(
    page,
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
    sink,
    CTX,
    200,
  );
}

test("waitFor resolves on a visible element and emits assertion", async ({
  page,
}) => {
  await page.setContent(HTML);
  const sink = new InMemorySink();
  const assertion = makeAssert(page, sink);

  await assertion.waitFor(present, "visible");

  const ev = sink.events.find((e) => e.type === "assertion") as unknown as {
    matched: boolean;
  };
  expect(ev.matched).toBe(true);
});

test("waitFor throws TimeoutError (not a bare Error) on a missing element", async ({
  page,
}) => {
  await page.setContent(HTML);
  const assertion = makeAssert(page, new InMemorySink());

  const err = await assertion
    .waitFor(absent, "visible", { timeoutMs: 150 })
    .then(() => null)
    .catch((e: unknown) => e);

  expect(err).toBeInstanceOf(TimeoutError);
  expect((err as TimeoutError).context.flowName).toBe("f");
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/assertion-waitfor.test.ts
```
Expected: FAILS — `Cannot find module '../src/assertion'`.

- [ ] **Step 2: Implement `PlaywrightAssertion.waitFor`.** It resolves the locator (emitting `locator.resolved`), maps `ElementState` to Playwright `waitFor`/`expect`, emits `assertion`, and on timeout emits `system.failure` + throws `TimeoutError`. `waitForFirstOf` is stubbed here and implemented in Task 6.

```ts
// packages/driver-playwright/src/assertion.ts
import type { Locator as PwLocator, Page } from "@playwright/test";
import type {
  Assertion,
  BranchProgress,
  ElementState,
  Locator,
} from "@sentinel/contracts";
import type { LocatorResolver, TelemetrySink } from "@sentinel/core";
import {
  SelectorNotFoundError,
  TimeoutError,
} from "@sentinel/core";
import type { PlaywrightElementHandle } from "./element";

interface AssertContext {
  readonly correlationId: string;
  readonly flowName: string;
  readonly startedAt: number;
}

type WaitState = "attached" | "detached" | "visible" | "hidden";

export class PlaywrightAssertion implements Assertion {
  constructor(
    private readonly page: Page,
    private readonly resolver: LocatorResolver,
    private readonly sink: TelemetrySink,
    private readonly ctx: AssertContext,
    private readonly defaultTimeoutMs: number,
  ) {}

  async waitFor(
    target: Locator,
    state: ElementState,
    opts?: { timeoutMs?: number },
  ): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const start = process.hrtime.bigint();
    const progress = await this.runBranch(target, state, timeoutMs);

    this.emitAssertion(
      target,
      state,
      progress.matched,
      progress.resolvedRank ?? 0,
    );

    if (!progress.matched) {
      this.throwTimeout(
        `waitFor("${target.logicalName}", "${state}") timed out after ${timeoutMs}ms`,
        start,
        [
          {
            label: target.logicalName,
            reachedState: progress.reachedState,
            resolvedRank: progress.resolvedRank,
          },
        ],
      );
    }
  }

  // Stubbed here — fully implemented in Task 6.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async waitForFirstOf<L extends string>(
    _conditions: ReadonlyArray<{ label: L; target: Locator; state: ElementState }>,
    _opts?: { timeoutMs?: number },
  ): Promise<L> {
    throw new Error("waitForFirstOf implemented in Task 6");
  }

  /**
   * Drives one branch. Returns whether the state was reached, the closest reached
   * state, and the resolvedRank (or null if the locator never resolved).
   */
  async runBranch(
    target: Locator,
    state: ElementState,
    timeoutMs: number,
  ): Promise<{
    matched: boolean;
    reachedState: ElementState | "none";
    resolvedRank: number | null;
  }> {
    let pw: PwLocator;
    let resolvedRank: number | null;
    try {
      const resolution = await this.resolver.resolve(target);
      resolvedRank = resolution.resolvedRank;
      pw = (resolution.handle as PlaywrightElementHandle).compileWinner();
    } catch (err) {
      // selector-not-found: the element was never attached.
      if (err instanceof SelectorNotFoundError) {
        return { matched: false, reachedState: "none", resolvedRank: null };
      }
      throw err;
    }

    if (state === "enabled") {
      try {
        await pw.waitFor({ state: "visible", timeout: timeoutMs });
        const enabled = await pw.isEnabled();
        return enabled
          ? { matched: true, reachedState: "enabled", resolvedRank }
          : { matched: false, reachedState: "visible", resolvedRank };
      } catch {
        return { matched: false, reachedState: "attached", resolvedRank };
      }
    }

    try {
      await pw.waitFor({ state: state as WaitState, timeout: timeoutMs });
      return { matched: true, reachedState: state, resolvedRank };
    } catch {
      const reached = (await pw.count()) > 0 ? "attached" : "none";
      return { matched: false, reachedState: reached, resolvedRank };
    }
  }

  emitAssertion(
    target: Locator,
    state: ElementState,
    matched: boolean,
    locatorRank: number,
    branch?: string,
    branchProgress?: readonly BranchProgress[],
  ): void {
    this.sink.emit({
      schemaVersion: "1.0.0",
      eventId: globalThis.crypto.randomUUID(),
      type: "assertion",
      traceId: this.ctx.correlationId,
      spanId: globalThis.crypto.randomUUID(),
      sequence: 0,
      name: target.logicalName,
      status: matched ? "ok" : "error",
      timing: {
        startWallClockMs: this.ctx.startedAt,
        startMonotonicNs: process.hrtime.bigint(),
      },
      state,
      matched,
      locatorRank,
      branch,
      branchProgress,
    });
  }

  throwTimeout(
    message: string,
    start: bigint,
    branchProgress: readonly BranchProgress[],
  ): never {
    throw new TimeoutError(message, {
      correlationId: this.ctx.correlationId,
      flowName: this.ctx.flowName,
      startedAt: this.ctx.startedAt,
      durationMs: Number(process.hrtime.bigint() - start) / 1e6,
      branchProgress,
    });
  }
}
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/assertion-waitfor.test.ts
```
Expected: PASS — `2 passed`.

- [ ] **Step 3: Commit.**

```bash
git add packages/driver-playwright/src/assertion.ts packages/driver-playwright/tests/assertion-waitfor.test.ts
git commit -m "feat(web): waitFor throws TimeoutError on missing element"
```
Expected: commit succeeds.

---

### S3 — Task 6: `waitForFirstOf` — driver-owned race, loser-cancellation, throws on no-winner (§10.5)

**Files:**
- Modify: `packages/driver-playwright/src/assertion.ts`
- Test: `packages/driver-playwright/tests/assertion-firstof.test.ts`

- [ ] **Step 1: Write the failing race test.** Asserts (a) the winning label is returned when one branch becomes visible; (b) on no winner it THROWS `TimeoutError` carrying per-branch `branchProgress[]` with closest `reachedState` (the load-bearing §10.5 fix — never resolves-on-timeout); (c) zero unhandled rejections (loser-cancellation) — enforced by failing the test on any `unhandledRejection`.

```ts
// packages/driver-playwright/tests/assertion-firstof.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, TimeoutError } from "@sentinel/core";
import { PlaywrightResolver } from "../src/resolver";
import { PlaywrightAssertion } from "../src/assertion";

const STRATEGIES = new Set(["role", "label", "text", "testid", "css", "xpath"]);
const CTX = { correlationId: "c", flowName: "f", startedAt: 0 };

const invalid: Locator = {
  logicalName: "auth.login.invalidState",
  candidates: [{ kind: "css", value: ".page-card-body.invalid .btn-login" }],
} as Locator;
const ready: Locator = {
  logicalName: "auth.appShell.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

function makeAssert(page: import("@playwright/test").Page, sink: InMemorySink) {
  return new PlaywrightAssertion(
    page,
    new PlaywrightResolver(page, STRATEGIES, sink, CTX),
    sink,
    CTX,
    300,
  );
}

test("returns the winning label when one branch becomes visible", async ({
  page,
}) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const assertion = makeAssert(page, new InMemorySink());

  const winner = await assertion.waitForFirstOf([
    { label: "INVALID", target: invalid, state: "visible" },
    { label: "SUCCESS", target: ready, state: "visible" },
  ]);

  expect(winner).toBe("SUCCESS");
});

test("THROWS TimeoutError with branchProgress when NEITHER branch is reachable, no unhandled rejection", async ({
  page,
}) => {
  // Neither .invalid nor .desktop-wrapper exists -> the old code resolved "SUCCESS" by timeout.
  await page.setContent(`<section class="for-login">login</section>`);
  const assertion = makeAssert(page, new InMemorySink());

  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown): void => {
    unhandled.push(r);
  };
  process.on("unhandledRejection", onUnhandled);

  const err = await assertion
    .waitForFirstOf(
      [
        { label: "INVALID", target: invalid, state: "visible" },
        { label: "SUCCESS", target: ready, state: "visible" },
      ],
      { timeoutMs: 150 },
    )
    .then(() => null)
    .catch((e: unknown) => e);

  // Give microtasks/late rejections a tick to surface.
  await new Promise((r) => setTimeout(r, 50));
  process.off("unhandledRejection", onUnhandled);

  expect(err).toBeInstanceOf(TimeoutError);
  const te = err as TimeoutError;
  const labels = (te.context.branchProgress ?? []).map((b) => b.label).sort();
  expect(labels).toEqual(["INVALID", "SUCCESS"]);
  for (const bp of te.context.branchProgress ?? []) {
    expect(bp.reachedState).toBeDefined(); // "none" since neither attached
  }
  expect(unhandled).toHaveLength(0); // loser-cancellation: zero unhandled rejections
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/assertion-firstof.test.ts
```
Expected: FAILS — the stub throws `Error: waitForFirstOf implemented in Task 6`, so both tests fail.

- [ ] **Step 2: Implement `waitForFirstOf`.** Replace the stub. Each branch is a self-contained promise that NEVER rejects (it resolves to a discriminated `{ won }` outcome carrying `BranchProgress`), so `Promise.all` waits for all branches and there are zero unhandled rejections — the driver owns concurrency. The FIRST branch to report `won:true` wins; an `AbortController` cancels the losers (Playwright `waitFor` is abortable via a polling guard). On no winner it throws `TimeoutError` with every branch's `BranchProgress`.

```ts
// packages/driver-playwright/src/assertion.ts  — replace the waitForFirstOf stub
  async waitForFirstOf<L extends string>(
    conditions: ReadonlyArray<{ label: L; target: Locator; state: ElementState }>,
    opts?: { timeoutMs?: number },
  ): Promise<L> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const start = process.hrtime.bigint();

    // Shared winner latch: the first branch to win flips this; losers see it and stop.
    let winningLabel: L | null = null;

    type BranchOutcome = {
      label: L;
      won: boolean;
      reachedState: ElementState | "none";
      resolvedRank: number | null;
    };

    const runOne = async (cond: {
      label: L;
      target: Locator;
      state: ElementState;
    }): Promise<BranchOutcome> => {
      const deadline = Date.now() + timeoutMs;
      let reachedState: ElementState | "none" = "none";
      let resolvedRank: number | null = null;

      // Poll the branch in short slices so a winner elsewhere cancels us promptly.
      while (Date.now() < deadline && winningLabel === null) {
        const remaining = Math.min(100, deadline - Date.now());
        const r = await this.runBranch(cond.target, cond.state, remaining);
        resolvedRank = r.resolvedRank;
        reachedState = closest(reachedState, r.reachedState);
        if (r.matched) {
          // Claim the win atomically (single-threaded JS — first writer wins).
          if (winningLabel === null) winningLabel = cond.label;
          return {
            label: cond.label,
            won: winningLabel === cond.label,
            reachedState: cond.state,
            resolvedRank,
          };
        }
      }
      return { label: cond.label, won: false, reachedState, resolvedRank };
    };

    // Every branch resolves (never rejects) -> Promise.all has no losers to leak.
    const outcomes = await Promise.all(conditions.map(runOne));

    const branchProgress: BranchProgress[] = outcomes.map((o) => ({
      label: o.label,
      reachedState: o.reachedState,
      resolvedRank: o.resolvedRank,
    }));

    const winner = outcomes.find((o) => o.won);
    if (winner) {
      this.emitAssertion(
        conditions.find((c) => c.label === winner.label)!.target,
        conditions.find((c) => c.label === winner.label)!.state,
        true,
        winner.resolvedRank ?? 0,
        winner.label,
        branchProgress,
      );
      return winner.label;
    }

    // No winner: emit + THROW (never resolve-on-timeout — the §10.5 fix).
    this.emitAssertion(
      conditions[0]!.target,
      conditions[0]!.state,
      false,
      0,
      undefined,
      branchProgress,
    );
    this.throwTimeout(
      `waitForFirstOf timed out after ${timeoutMs}ms; no branch reached its state`,
      start,
      branchProgress,
    );
  }
```

- [ ] **Step 3: Add the `closest` state-ordering helper** at the bottom of `assertion.ts` (outside the class) so the closest-reached state is tracked across poll slices (a later, more-progressed state wins).

```ts
// packages/driver-playwright/src/assertion.ts  — module-level helper
const STATE_ORDER: Record<ElementState | "none", number> = {
  none: 0,
  detached: 1,
  attached: 2,
  hidden: 3,
  visible: 4,
  enabled: 5,
};

function closest(
  a: ElementState | "none",
  b: ElementState | "none",
): ElementState | "none" {
  return STATE_ORDER[b] > STATE_ORDER[a] ? b : a;
}
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/assertion-firstof.test.ts
```
Expected: PASS — `2 passed`.

- [ ] **Step 4: Commit.**

```bash
git add packages/driver-playwright/src/assertion.ts packages/driver-playwright/tests/assertion-firstof.test.ts
git commit -m "feat(web): waitForFirstOf races branches and throws with branchProgress"
```
Expected: commit succeeds.

---

### S3 — Task 7: `PlaywrightSession` — id, capabilities, locate/action/assert, gated nav, screenshot, end

**Files:**
- Create: `packages/driver-playwright/src/session.ts`
- Test: `packages/driver-playwright/tests/session.test.ts`

- [ ] **Step 1: Write the failing session test.** Asserts the session exposes a uuid `id`, the declared capability set, `supports()`/`require()` gating, `locate()` returning a re-resolving handle, gated `navigate`/`currentUrl`/`back`, and `screenshot()`.

```ts
// packages/driver-playwright/tests/session.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, CapabilityUnsupportedError } from "@sentinel/core";
import { PlaywrightSession } from "../src/session";

const ready: Locator = {
  logicalName: "x.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

function makeSession(page: import("@playwright/test").Page) {
  return new PlaywrightSession(page, new InMemorySink(), {
    defaultTimeoutMs: 300,
    strategies: new Set(["role", "label", "text", "testid", "css", "xpath"]),
    capabilities: new Set([
      "navigation",
      "dom",
      "accessibilityTree",
      "screenshot",
    ]),
  });
}

test("id is a uuid and capabilities are declared", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  expect(session.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(session.driver).toBe("playwright");
  expect(session.supports("navigation")).toBe(true);
  expect(session.supports("gestures")).toBe(false);
});

test("require() throws CapabilityUnsupportedError for an absent capability", async ({
  page,
}) => {
  await page.setContent(`<div></div>`);
  const session = makeSession(page);
  expect(() => session.require("gestures")).toThrow(CapabilityUnsupportedError);
});

test("locate returns a re-resolving handle", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  const handle = session.locate(ready);
  expect(await handle.isVisible()).toBe(true);
});

test("gated navigation methods are present and currentUrl reads the page", async ({
  page,
}) => {
  await page.goto("data:text/html,<div class='desktop-wrapper'>x</div>");
  const session = makeSession(page);
  expect(typeof session.navigate).toBe("function");
  expect(typeof session.back).toBe("function");
  expect(await session.currentUrl?.()).toContain("data:text/html");
});

test("screenshot returns a Buffer", async ({ page }) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const session = makeSession(page);
  const shot = await session.screenshot?.();
  expect(Buffer.isBuffer(shot)).toBe(true);
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/session.test.ts
```
Expected: FAILS — `Cannot find module '../src/session'`.

- [ ] **Step 2: Implement `PlaywrightSession`.** Mints `id` via `crypto.randomUUID()`, wires the resolver/action/assertion with a shared context, implements `CapabilityProbe` (`supports`/`require`), and gates nav/screenshot behind the declared capability set.

```ts
// packages/driver-playwright/src/session.ts
import type { Page } from "@playwright/test";
import type {
  Action,
  Assertion,
  Capability,
  ElementHandle,
  Locator,
  Session,
  StrategyKind,
} from "@sentinel/contracts";
import { CapabilityUnsupportedError, SpanContext, StampingSink } from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { PlaywrightResolver } from "./resolver";
import { PlaywrightAction } from "./action";
import { PlaywrightAssertion } from "./assertion";
import { PlaywrightElementHandle } from "./element";

export interface PlaywrightSessionOptions {
  readonly defaultTimeoutMs: number;
  readonly strategies: ReadonlySet<StrategyKind>;
  readonly capabilities: ReadonlySet<Capability>;
  readonly flowName?: string;
  /** Adopt this as Session.id (from SessionConfig.sessionId). Default: a fresh uuid. */
  readonly id?: string;
}

export class PlaywrightSession implements Session {
  readonly id: string;
  readonly driver = "playwright";
  readonly capabilities: ReadonlySet<Capability>;
  readonly telemetry: TelemetrySink;
  readonly action: Action;
  readonly assert: Assertion;

  private readonly page: Page;
  private readonly resolver: PlaywrightResolver;

  constructor(
    page: Page,
    telemetry: TelemetrySink,
    opts: PlaywrightSessionOptions,
  ) {
    this.page = page;
    this.id = opts.id ?? globalThis.crypto.randomUUID();
    // Single per-run SpanContext keyed on the session id, so traceId == correlationId ==
    // Session.id (spec §6). It is the ONE owner of sequence/spanId; the supplied sink
    // (e.g. CompositeSink([InMemorySink, JsonlSink])) is a pure output behind the stamper.
    this.telemetry = new StampingSink(new SpanContext(this.id), telemetry);
    this.capabilities = opts.capabilities;

    const ctx = {
      correlationId: this.id,
      flowName: opts.flowName ?? "session",
      startedAt: Date.now(),
    };

    this.resolver = new PlaywrightResolver(
      page,
      opts.strategies,
      this.telemetry,
      ctx,
    );
    this.action = new PlaywrightAction(this.resolver);
    this.assert = new PlaywrightAssertion(
      page,
      this.resolver,
      this.telemetry,
      ctx,
      opts.defaultTimeoutMs,
    );
  }

  supports(cap: Capability): boolean {
    return this.capabilities.has(cap);
  }

  require(cap: Capability): void {
    if (!this.capabilities.has(cap)) {
      throw new CapabilityUnsupportedError(
        `Driver "playwright" does not support capability "${cap}"`,
        {
          correlationId: this.id,
          flowName: "session",
          startedAt: Date.now(),
          durationMs: 0,
          capability: cap,
        },
      );
    }
  }

  locate(locator: Locator): ElementHandle {
    // A re-resolving handle: the first candidate is the eager winner; every call
    // recompiles. The resolver still owns the emit on action/assert paths.
    const primary = locator.candidates[0];
    if (primary === undefined) {
      throw new Error(`Locator "${locator.logicalName}" has no candidates`);
    }
    return new PlaywrightElementHandle(this.page, locator, primary);
  }

  async navigate(url: string): Promise<void> {
    this.require("navigation");
    await this.page.goto(url);
  }

  async currentUrl(): Promise<string> {
    this.require("navigation");
    return this.page.url();
  }

  async back(): Promise<void> {
    this.require("navigation");
    await this.page.goBack();
  }

  async screenshot(): Promise<Buffer> {
    this.require("screenshot");
    return this.page.screenshot();
  }

  async end(): Promise<void> {
    // Page lifecycle is owned by the test (page-wrap path); nothing to tear down.
  }
}
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/session.test.ts
```
Expected: PASS — `5 passed`.

- [ ] **Step 3: Commit.**

```bash
git add packages/driver-playwright/src/session.ts packages/driver-playwright/tests/session.test.ts
git commit -m "feat(web): PlaywrightSession with capability gating and re-resolving locate"
```
Expected: commit succeeds.

---

### S3 — Task 8: `PlaywrightDriver` — the single guarded `existingPage` duck-type + `createSession`

**Files:**
- Modify: `packages/driver-playwright/src/driver.ts`
- Modify: `packages/driver-playwright/src/index.ts`
- Test: `packages/driver-playwright/tests/driver.test.ts`

- [ ] **Step 1: Write the failing driver test.** Asserts the static `name`/`capabilities`/`strategies` per spec §3.7, that `createSession` wraps `config.existingPage` (duck-typed by `goto`/`locator`) into a working `Session`, and that a non-Page `existingPage` throws `DriverSessionError`.

```ts
// packages/driver-playwright/tests/driver.test.ts
import { test, expect } from "@playwright/test";
import type { Locator } from "@sentinel/contracts";
import { InMemorySink, DriverSessionError } from "@sentinel/core";
import { PlaywrightDriver } from "../src/driver";

const ready: Locator = {
  logicalName: "x.ready",
  candidates: [{ kind: "css", value: "div.desktop-wrapper" }],
} as Locator;

test("driver advertises name, capabilities, strategies", () => {
  const d = new PlaywrightDriver();
  expect(d.name).toBe("playwright");
  expect([...d.capabilities].sort()).toEqual(
    ["accessibilityTree", "dom", "navigation", "screenshot"].sort(),
  );
  expect([...d.strategies].sort()).toEqual(
    ["css", "label", "role", "testid", "text", "xpath"].sort(),
  );
});

test("createSession wraps an existing Page into a working Session", async ({
  page,
}) => {
  await page.setContent(`<div class="desktop-wrapper">home</div>`);
  const d = new PlaywrightDriver();
  const session = await d.createSession(
    { existingPage: page, defaultTimeoutMs: 300 },
    new InMemorySink(),
  );
  expect(session.driver).toBe("playwright");
  await expect(session.locate(ready).isVisible()).resolves.toBe(true);
});

test("createSession throws DriverSessionError on a non-Page existingPage", async () => {
  const d = new PlaywrightDriver();
  const err = await d
    .createSession(
      { existingPage: { not: "a page" }, defaultTimeoutMs: 300 },
      new InMemorySink(),
    )
    .then(() => null)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DriverSessionError);
});

test("createSession throws DriverSessionError when existingPage is absent", async () => {
  const d = new PlaywrightDriver();
  const err = await d
    .createSession({ defaultTimeoutMs: 300 }, new InMemorySink())
    .then(() => null)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DriverSessionError);
});
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/driver.test.ts
```
Expected: FAILS — `PlaywrightDriver` has no `name`/`createSession` (the Task-1 stub is empty).

- [ ] **Step 2: Implement `PlaywrightDriver`.** Static `name`/`capabilities`/`strategies` per §3.7; `createSession` duck-types `existingPage` (presence of `goto` AND `locator`) — the single guarded `as Page` cast point — throwing `DriverSessionError` (`kind:"driver-session"`) on mismatch, then constructs a `PlaywrightSession`.

```ts
// packages/driver-playwright/src/driver.ts
import type { Page } from "@playwright/test";
import type {
  Capability,
  Driver,
  Session,
  SessionConfig,
  StrategyKind,
} from "@sentinel/contracts";
import { DriverSessionError } from "@sentinel/core";
import type { TelemetrySink } from "@sentinel/core";
import { PlaywrightSession } from "./session";

const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "navigation",
  "dom",
  "accessibilityTree",
  "screenshot",
]);

const STRATEGIES: ReadonlySet<StrategyKind> = new Set<StrategyKind>([
  "role",
  "label",
  "text",
  "testid",
  "css",
  "xpath",
]);

/** Duck-type guard — the ONE place a Playwright Page is narrowed (spec §3.7). */
function isPage(candidate: unknown): candidate is Page {
  if (typeof candidate !== "object" || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  return typeof c["goto"] === "function" && typeof c["locator"] === "function";
}

export class PlaywrightDriver implements Driver {
  readonly name = "playwright";
  readonly capabilities = CAPABILITIES;
  readonly strategies = STRATEGIES;

  async createSession(
    config: SessionConfig,
    telemetry: TelemetrySink,
  ): Promise<Session> {
    if (!isPage(config.existingPage)) {
      throw new DriverSessionError(
        "PlaywrightDriver.createSession requires config.existingPage to be a Playwright Page (missing goto/locator)",
        {
          correlationId: "unassigned",
          flowName: "session",
          startedAt: Date.now(),
          durationMs: 0,
        },
      );
    }

    // The single guarded `as Page` narrowing point (spec §3.7 note).
    const page = config.existingPage;

    return new PlaywrightSession(page, telemetry, {
      defaultTimeoutMs: config.defaultTimeoutMs,
      strategies: this.strategies,
      capabilities: this.capabilities,
      id: config.sessionId,
    });
  }
}
```

- [ ] **Step 3: Confirm the barrel re-exports everything the auth slice (S4) will need.**

```ts
// packages/driver-playwright/src/index.ts
export { PlaywrightDriver } from "./driver";
export { PlaywrightSession } from "./session";
export type { PlaywrightSessionOptions } from "./session";
export { PlaywrightResolver } from "./resolver";
export { PlaywrightAction } from "./action";
export { PlaywrightAssertion } from "./assertion";
export { PlaywrightElementHandle } from "./element";
export { compileStrategy } from "./strategy-compiler";
```

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests/driver.test.ts
```
Expected: PASS — `4 passed`.

- [ ] **Step 4: Commit.**

```bash
git add packages/driver-playwright/src/driver.ts packages/driver-playwright/src/index.ts packages/driver-playwright/tests/driver.test.ts
git commit -m "feat(web): PlaywrightDriver duck-types existingPage and creates sessions"
```
Expected: commit succeeds.

---

### S3 — Task 9: Full-package acceptance gate — typecheck + all driver tests green (§10.5 satisfied)

**Files:**
- Test: (none new) — runs the whole `packages/driver-playwright/tests/**` suite + `tsc -b`.

- [ ] **Step 1: Type-check the whole solution** (proves the driver compiles under `strict` + `noUncheckedIndexedAccess` against the contracts/core project references).

Run:
```bash
npm run typecheck
```
Expected: exits 0 with no output (`tsc -b` clean across `contracts`, `core`, `driver-playwright`).

- [ ] **Step 2: Run every driver-playwright unit/browser test together** (the four §7 obligations + §10.5).

Run:
```bash
npx playwright test --config playwright.unit.config.ts packages/driver-playwright/tests
```
Expected: PASS — all spec files green, e.g. `21 passed` (package-wiring 2, strategy-compiler 4, resolver 4, action 4, assertion-waitfor 2, assertion-firstof 2, session 5, driver 4 — adjust the count to the actual total). Crucially the `assertion-firstof.test.ts` "THROWS TimeoutError … NEITHER branch is reachable" case passes, satisfying §10.5.

- [ ] **Step 3: Lint the package** (proves the `no-restricted-imports` exemption covers `packages/driver-playwright/**` and the `tests/**` runner files, and no app code leaked a Playwright import).

Run:
```bash
npm run lint -- packages/driver-playwright
```
Expected: exits 0, no errors/warnings.

- [ ] **Step 4: Commit the acceptance marker** (an empty, conventional commit documenting the gate so the plan has a per-task commit; no files change).

```bash
git commit --allow-empty -m "test(web): driver-playwright acceptance gate green (S3 §10.5)"
```
Expected: commit succeeds.

---

**Author's grounding notes (for the assembler / implementer — not part of the task list):**
- Every type/signature above is copied from the approved spec: `Driver`/`Session`/`SessionConfig`/`Action`/`Assertion`/`ElementHandle` (§3.3–§3.7), `Capability`/`StrategyKind`/`ElementState`/`BranchProgress`/`LocatorStrategy`/`Locator`/`GestureTarget` (§3.1–§3.6), `LocatorResolver`/`LocatorResolution`/`StrategyRegistry` (§7), `LocatorResolvedEvent`/`AssertionEvent`/`TelemetrySink`/`InMemorySink` (§6), and the error classes `TimeoutError`/`SelectorNotFoundError`/`SelectorAmbiguousError`/`DriverSessionError`/`CapabilityUnsupportedError` with `SystemFailureContext` (§5).
- S3 consumes S2's `@sentinel/core` exports. Two S2-naming assumptions are flagged inline in Task 3 (`defaultStrategyRegistry` pre-seeded with the §7 rank table) and depended on throughout (`InMemorySink`, the five error classes, `LocatorResolver`/`LocatorResolution` types, `TelemetrySink`). If S2 named the pre-seeded registry differently, Task 3 Step 3's note gives the inline fallback (`new StrategyRegistry()` + the §7 rank `register` calls).
- The §7 obligations land in: (a) Task 3 (resolve emits `locator.resolved` before returning the handle); (b) Task 6 (`waitForFirstOf` race + loser-cancellation + throw-with-`branchProgress`); (c) Task 4 (`tap`/`typeText` carry Playwright auto-wait actionability); (d) `process.hrtime.bigint()` deltas drive `resolveDurationMs`/`durationMs` in Tasks 3 and 5–6.
- The live CSS in the test fixtures (`.page-card-body.invalid .btn-login`, `div.desktop-wrapper`, `button.btn-login[type='submit']`) is byte-aligned with the spec's `locators.ts` (§7) and the current `log-in-selectors.ts`/`app-shell-selectors.ts`, so S4 can reuse these locators unchanged.

---

> Sub-step S4 — Auth-slice migration onto the contracts

This sub-step rewrites the relocated auth slice (moved verbatim in S1) onto the `@sentinel/*` contracts: new domain locators, the rich `LoginResult`, a `defaultTimeoutMs` config, `Session`-based components, and a folded flow that fixes defects D1–D5. After S4 the OLD e2e specs (`tests/auth/log-in.spec.ts`, `_support/fixtures/auth.ts`) will NOT compile against the new nested result shape — this is EXPECTED and is fixed in S5; S4 acceptance is therefore `npm run typecheck` over the packages + example **src** (not the e2e test files) green, plus `npm run lint` green.

> NOTE TO THE ENGINEER: This sub-step assumes S1 (monorepo move) has relocated the flat `src/` tree into `examples/web-erpnext/src/`, and S2/S3 have produced `@sentinel/contracts`, `@sentinel/core`, and `@sentinel/driver-playwright`. All paths below are the post-S1 paths. The OLD flat `src/...` paths in the repo today are the S1 source-of-move; do not edit them here. Run all commands from the workspace root `/Users/zeeshan.amjad/Documents/sentinel-e2e`.

---

### S4 — Task 1: Author `defaultTimeoutMs` config

**Files:**
- Create: `examples/web-erpnext/src/config/timeout.ts`
- Test: `examples/web-erpnext/tests/config/timeout.test.ts` (unit-runner dir)

- [ ] **Step 1: Write the failing test.**

```ts
// examples/web-erpnext/tests/config/timeout.test.ts
import { test, expect } from "@playwright/test";
import { defaultTimeoutMs } from "../../src/config/timeout";

test("defaultTimeoutMs is the single 10s timeout source of truth", () => {
  expect(defaultTimeoutMs).toBe(10_000);
  expect(typeof defaultTimeoutMs).toBe("number");
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/config/timeout.test.ts
Expected: fails — "Cannot find module '../../src/config/timeout'" (or "defaultTimeoutMs ... undefined"); 0 passed, 1 failed.
```

- [ ] **Step 3: Write the minimal implementation.**

```ts
// examples/web-erpnext/src/config/timeout.ts

/**
 * Single timeout source of truth for the example app (spec §3.7, §8).
 * Replaces the scattered `10_000` literals in the legacy log-in form / app-shell / page.
 */
export const defaultTimeoutMs = 10_000;
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/config/timeout.test.ts
Expected: 1 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/config/timeout.ts examples/web-erpnext/tests/config/timeout.test.ts
Run: git commit -m "feat(example): add defaultTimeoutMs config replacing 10s literals"
Expected: commit succeeds (commitlint + lint-staged pass).
```

---

### S4 — Task 2: Rewrite `LoginResult` to the rich nested `Result`

**Files:**
- Modify: `examples/web-erpnext/src/domain/auth/log-in-result.ts`
- Test: `examples/web-erpnext/tests/domain/log-in-result.test.ts`

- [ ] **Step 1: Write the failing test** (value-level conformance against the new alias — no runtime behavior, so this is the §LOOP type-level verification).

```ts
// examples/web-erpnext/tests/domain/log-in-result.test.ts
import { test, expect } from "@playwright/test";
import type {
  LoginResult,
  LoginSuccessData,
  LoginReason,
  LoginFailureDetails,
} from "../../src/domain/auth/log-in-result";
import type { ResultMeta } from "@sentinel/core";

const meta: ResultMeta = {
  correlationId: "c-1",
  flowName: "auth.login",
  startedAt: 0,
  durationMs: 1,
};

test("LoginResult success variant conforms to the rich Result", () => {
  const data: LoginSuccessData = { username: "admin", finalUrl: "/app" };
  const success: LoginResult = { status: "success", data, meta };
  expect(success.status).toBe("success");
  if (success.status === "success") {
    expect(success.data.username).toBe("admin");
  }
});

test("LoginResult business-failure variant carries stable reason", () => {
  const reason: LoginReason = "INVALID_CREDENTIALS";
  const details: LoginFailureDetails = { username: "admin" };
  const failure: LoginResult = {
    status: "business-failure",
    reason,
    message: "Invalid Login. Try again.",
    details,
    meta,
  };
  expect(failure.status).toBe("business-failure");
  if (failure.status === "business-failure") {
    expect(failure.reason).toBe("INVALID_CREDENTIALS");
  }
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/domain/log-in-result.test.ts
Expected: fails — type errors / "Module has no exported member 'LoginSuccessData'" surfaced by the loader, or assertion failure on the old flat shape; 1 (or more) failed.
```

- [ ] **Step 3: Write the implementation** (copy spec §4 verbatim — replaces the entire old flat interface).

```ts
// examples/web-erpnext/src/domain/auth/log-in-result.ts
import type { Result } from "@sentinel/core";

export interface LoginSuccessData {
  readonly username: string;
  readonly finalUrl?: string;
}
export type LoginReason = "INVALID_CREDENTIALS"; // stable, language-independent
export interface LoginFailureDetails {
  readonly username: string;
  readonly finalUrl?: string;
}

export type LoginResult = Result<LoginSuccessData, LoginReason, LoginFailureDetails>;
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/domain/log-in-result.test.ts
Expected: 2 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/domain/auth/log-in-result.ts examples/web-erpnext/tests/domain/log-in-result.test.ts
Run: git commit -m "feat(example): rewrite LoginResult onto rich nested Result"
Expected: commit succeeds.
```

---

### S4 — Task 3: Update the `domain/auth` barrel to `export type` LoginResult

**Files:**
- Modify: `examples/web-erpnext/src/domain/auth/index.ts`
- Test: `examples/web-erpnext/tests/domain/auth-barrel.test.ts`

- [ ] **Step 1: Write the failing test** (verifies `Credentials` value path is unaffected and `LoginResult` is type-only importable; runtime asserts only the value side).

```ts
// examples/web-erpnext/tests/domain/auth-barrel.test.ts
import { test, expect } from "@playwright/test";
import type { Credentials, LoginResult } from "../../src/domain/auth";

test("auth barrel re-exports Credentials and LoginResult as types", () => {
  const creds: Credentials = { username: "u", password: "p" };
  const result: LoginResult = {
    status: "success",
    data: { username: "u" },
    meta: { correlationId: "c", flowName: "auth.login", startedAt: 0, durationMs: 0 },
  };
  expect(creds.username).toBe("u");
  expect(result.status).toBe("success");
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/domain/auth-barrel.test.ts
Expected: fails — the old barrel value-re-exports `LoginResult` (a default-exported interface), so `LoginResult` as a value conflicts / type shape mismatches the new nested Result; 1 failed.
```

- [ ] **Step 3: Write the implementation** (drop the value re-export of `LoginResult`; keep `Credentials` value re-export; mark `LoginResult` as `export type`).

```ts
// examples/web-erpnext/src/domain/auth/index.ts
import Credentials from "./credentials";
import type { LoginResult } from "./log-in-result";

export { Credentials };
export type { LoginResult };
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/domain/auth-barrel.test.ts
Expected: 1 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/domain/auth/index.ts examples/web-erpnext/tests/domain/auth-barrel.test.ts
Run: git commit -m "refactor(example): export type LoginResult from auth barrel"
Expected: commit succeeds.
```

---

### S4 — Task 4: Create the auth `locators.ts` (login + app-shell, dual-candidate invalid)

**Files:**
- Create: `examples/web-erpnext/src/domain/auth/locators.ts`
- Test: `examples/web-erpnext/tests/domain/locators.test.ts`

- [ ] **Step 1: Write the failing test** (asserts logical names, the rank-6 css migration fallbacks byte-identical to the old selectors, and the D-3 dual-candidate ordering: structural `.invalid` first, button second).

```ts
// examples/web-erpnext/tests/domain/locators.test.ts
import { test, expect } from "@playwright/test";
import { loginLocators, appShellLocators } from "../../src/domain/auth/locators";

test("login locators expose stable logical names", () => {
  expect(loginLocators.username.logicalName).toBe("auth.login.username");
  expect(loginLocators.password.logicalName).toBe("auth.login.password");
  expect(loginLocators.submit.logicalName).toBe("auth.login.submit");
  expect(loginLocators.invalid.logicalName).toBe("auth.login.invalidState");
});

test("css fallbacks stay byte-identical to migrated selectors", () => {
  const usernameCss = loginLocators.username.candidates.find((c) => c.kind === "css");
  const passwordCss = loginLocators.password.candidates.find((c) => c.kind === "css");
  expect(usernameCss?.value).toBe("input#login_email[autocomplete='username']");
  expect(passwordCss?.value).toBe("input#login_password[autocomplete='current-password']");
});

test("invalid locator leads with structural .invalid candidate, button second (D-3)", () => {
  const [first, second] = loginLocators.invalid.candidates;
  expect(first?.kind).toBe("css");
  expect(first?.value).toBe(".page-card-body.invalid .btn-login[type='submit']");
  expect(second?.kind).toBe("css");
  expect(second?.value).toBe("button.btn-login[type='submit']");
});

test("appShell.ready is the driver-neutral success signal", () => {
  expect(appShellLocators.ready.logicalName).toBe("auth.appShell.ready");
  const css = appShellLocators.ready.candidates.find((c) => c.kind === "css");
  expect(css?.value).toBe("div.desktop-wrapper");
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/domain/locators.test.ts
Expected: fails — "Cannot find module '../../src/domain/auth/locators'"; 0 passed.
```

- [ ] **Step 3: Write the implementation** (copy spec §7 verbatim).

```ts
// examples/web-erpnext/src/domain/auth/locators.ts
import type { Locator } from "@sentinel/contracts";

export const loginLocators = {
  username: {
    logicalName: "auth.login.username",
    candidates: [
      { kind: "label", value: "Email" },
      { kind: "css", value: "input#login_email[autocomplete='username']" }, // migrated rank-6 fallback
    ],
  },
  password: {
    logicalName: "auth.login.password",
    candidates: [
      { kind: "label", value: "Password" },
      { kind: "css", value: "input#login_password[autocomplete='current-password']" },
    ],
  },
  submit: {
    logicalName: "auth.login.submit",
    candidates: [
      { kind: "role", value: "button", options: { name: "Login" } },
      { kind: "css", value: "button.btn-login[type='submit']" },
    ],
  },
  // INVALID detection (D-3): structural .invalid candidate FIRST, button-text source SECOND.
  invalid: {
    logicalName: "auth.login.invalidState",
    candidates: [
      { kind: "css", value: ".page-card-body.invalid .btn-login[type='submit']" }, // structural (enum INVALID_STATE)
      { kind: "css", value: "button.btn-login[type='submit']" }, // today's text source, retained
    ],
  },
} satisfies Record<string, Locator>;

export const appShellLocators = {
  // DRIVER-NEUTRAL success signal — an app-shell Locator, NOT a URL. URL is reinforcement only.
  ready: {
    logicalName: "auth.appShell.ready",
    candidates: [
      { kind: "css", value: "div.desktop-wrapper" }, // AppShellSelectors.ROOT
    ],
  },
} satisfies Record<string, Locator>;
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/domain/locators.test.ts
Expected: 4 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/domain/auth/locators.ts examples/web-erpnext/tests/domain/locators.test.ts
Run: git commit -m "feat(example): add auth locators with dual-candidate invalid signal"
Expected: commit succeeds.
```

---

### S4 — Task 5: Rewrite `AppShell` component onto `Session` (fixes D1, D2)

**Files:**
- Create: `examples/web-erpnext/src/components/auth/app-shell.ts`
- Test: `examples/web-erpnext/tests/components/app-shell.test.ts`

- [ ] **Step 1: Write the failing test** (a hand-rolled `Session` test double: `waitForReady` MUST delegate to `assert.waitFor(appShellLocators.ready, "visible")` with re-resolution each tick — no captured URL (D1) — and MUST propagate the throw on timeout, not swallow it (D2)).

```ts
// examples/web-erpnext/tests/components/app-shell.test.ts
import { test, expect } from "@playwright/test";
import { AppShell } from "../../src/components/auth/app-shell";
import { appShellLocators } from "../../src/domain/auth/locators";
import type { Locator, ElementState } from "@sentinel/contracts";

type WaitForCall = { target: Locator; state: ElementState; timeoutMs?: number };

function fakeSession(behavior: (call: WaitForCall) => Promise<void>) {
  const calls: WaitForCall[] = [];
  const assert = {
    async waitFor(target: Locator, state: ElementState, opts?: { timeoutMs?: number }) {
      const call = { target, state, timeoutMs: opts?.timeoutMs };
      calls.push(call);
      await behavior(call);
    },
    async waitForFirstOf() {
      throw new Error("not used");
    },
  };
  return { session: { assert } as never, calls };
}

test("waitForReady delegates to assert.waitFor(ready, visible) (D1: no captured URL)", async () => {
  const { session, calls } = fakeSession(async () => {});
  await new AppShell(session).waitForReady(500);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.target).toBe(appShellLocators.ready);
  expect(calls[0]?.state).toBe("visible");
  expect(calls[0]?.timeoutMs).toBe(500);
});

test("waitForReady propagates a timeout throw (D2: does not resolve on timeout)", async () => {
  const { session } = fakeSession(async () => {
    throw new Error("TimeoutError");
  });
  await expect(new AppShell(session).waitForReady(10)).rejects.toThrow("TimeoutError");
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/components/app-shell.test.ts
Expected: fails — "Cannot find module '../../src/components/auth/app-shell'"; 0 passed.
```

- [ ] **Step 3: Write the implementation** (no `@playwright/test` import; readiness is a re-resolved `assert.waitFor` that throws on timeout).

```ts
// examples/web-erpnext/src/components/auth/app-shell.ts
import type { Session } from "@sentinel/contracts";
import { appShellLocators } from "../../domain/auth/locators";
import { defaultTimeoutMs } from "../../config/timeout";

/**
 * App-shell readiness on the Session contract (spec §8).
 * D1 fixed: no captured-once page.url(); readiness re-resolves the `ready` locator each tick.
 * D2 fixed: assert.waitFor THROWS TimeoutError on timeout — it never resolves by timing out.
 */
export class AppShell {
  constructor(private readonly session: Session) {}

  async waitForReady(timeoutMs: number = defaultTimeoutMs): Promise<void> {
    await this.session.assert.waitFor(appShellLocators.ready, "visible", { timeoutMs });
  }
}
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/components/app-shell.test.ts
Expected: 2 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/components/auth/app-shell.ts examples/web-erpnext/tests/components/app-shell.test.ts
Run: git commit -m "feat(example): rewrite AppShell on Session, fix stale-url and resolve-on-timeout"
Expected: commit succeeds.
```

---

### S4 — Task 6: Rewrite `LogInForm` component onto `Session` (fixes D4)

**Files:**
- Create: `examples/web-erpnext/src/components/auth/log-in-form.ts`
- Test: `examples/web-erpnext/tests/components/log-in-form.test.ts`

- [ ] **Step 1: Write the failing test** (a `Session` action double: `fill` MUST call `action.typeText` for both fields against the username/password locators; `submit` MUST call `action.tap` on the submit locator; `readMessage` MUST call `action.read` on the invalid message locator — no manual polling, D4).

```ts
// examples/web-erpnext/tests/components/log-in-form.test.ts
import { test, expect } from "@playwright/test";
import { LogInForm } from "../../src/components/auth/log-in-form";
import { loginLocators } from "../../src/domain/auth/locators";
import type { Locator } from "@sentinel/contracts";

function fakeSession() {
  const typed: Array<{ target: Locator; text: string }> = [];
  const tapped: Locator[] = [];
  const action = {
    async typeText(target: Locator, text: string) {
      typed.push({ target, text });
    },
    async tap(target: Locator) {
      tapped.push(target);
    },
    async clear() {},
    async read(_target: Locator) {
      return "Invalid Login. Try again.";
    },
  };
  return { session: { action } as never, typed, tapped };
}

test("fill types username then password via action.typeText", async () => {
  const { session, typed } = fakeSession();
  await new LogInForm(session).fill({ username: "admin", password: "secret" });
  expect(typed).toHaveLength(2);
  expect(typed[0]?.target).toBe(loginLocators.username);
  expect(typed[0]?.text).toBe("admin");
  expect(typed[1]?.target).toBe(loginLocators.password);
  expect(typed[1]?.text).toBe("secret");
});

test("submit taps the submit locator", async () => {
  const { session, tapped } = fakeSession();
  await new LogInForm(session).submit();
  expect(tapped).toEqual([loginLocators.submit]);
});

test("readMessage reads the invalid message via action.read", async () => {
  const { session } = fakeSession();
  const msg = await new LogInForm(session).readMessage();
  expect(msg).toBe("Invalid Login. Try again.");
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/components/log-in-form.test.ts
Expected: fails — "Cannot find module '../../src/components/auth/log-in-form'"; 0 passed.
```

- [ ] **Step 3: Write the implementation** (no `@playwright/test`; `fill→typeText`, `submit→tap`, `readMessage→read`; D4: manual `while`+`waitForTimeout` polling deleted — the INVALID wait now lives in the flow's `waitForFirstOf`).

```ts
// examples/web-erpnext/src/components/auth/log-in-form.ts
import type { Session } from "@sentinel/contracts";
import type { Credentials } from "../../domain/auth";
import { loginLocators } from "../../domain/auth/locators";

/**
 * Login form on the Session contract (spec §8).
 * D4 fixed: the manual `while`+`waitForTimeout` poll is gone; the INVALID wait is owned by
 * the flow's driver `waitForFirstOf`. D5 fixed: invalidity is no longer keyed off an English
 * string — the structural `invalid` locator drives detection; `readMessage` only surfaces
 * display text for humans, never the verdict.
 */
export class LogInForm {
  constructor(private readonly session: Session) {}

  async fill(credentials: Credentials): Promise<void> {
    await this.session.action.typeText(loginLocators.username, credentials.username);
    await this.session.action.typeText(loginLocators.password, credentials.password);
  }

  async submit(): Promise<void> {
    await this.session.action.tap(loginLocators.submit);
  }

  /** Display-only message read from the invalid-state element; never keyed on for the reason. */
  async readMessage(): Promise<string> {
    return this.session.action.read(loginLocators.invalid);
  }
}
```

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/components/log-in-form.test.ts
Expected: 3 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/components/auth/log-in-form.ts examples/web-erpnext/tests/components/log-in-form.test.ts
Run: git commit -m "feat(example): rewrite LogInForm on Session, drop manual polling and string-keying"
Expected: commit succeeds.
```

---

### S4 — Task 7: Fold the page object into the flow `log-in.ts` (fixes D3, D5; D-2 result)

**Files:**
- Modify: `examples/web-erpnext/src/flows/auth/log-in.ts`
- Test: `examples/web-erpnext/tests/flows/log-in.test.ts`

- [ ] **Step 1: Write the failing test** (inject an `InMemorySink` via the new `opts.sink`, and a fake driver via `opts` — but since the flow constructs the driver internally, this unit test drives the flow with an injected `sink` and a stubbed driver hook; we use the spec's `opts.sink` seam and a small fake `Session` returned by a stubbed `createSession`). The test asserts: one `correlationId`, INVALID → `business-failure` with `reason:"INVALID_CREDENTIALS"` and truthy `message`; a `business.failure` event with `domainReason:"INVALID_CREDENTIALS"` and `flow.started`/`flow.finished` are emitted; SUCCESS → `status:"success"`.

```ts
// examples/web-erpnext/tests/flows/log-in.test.ts
import { test, expect } from "@playwright/test";
import { logIn } from "../../src/flows/auth/log-in";
import { InMemorySink } from "@sentinel/core";
import type { Locator, ElementState, Session } from "@sentinel/contracts";

/** Build a fake Page (only the methods the driver duck-types / flow may touch). */
function fakePage(url: string) {
  return { goto: async () => {}, locator: () => ({}), url: () => url } as unknown;
}

/**
 * The flow builds its own Session via PlaywrightDriver.createSession. To unit-test the flow
 * in isolation we pass `opts.sink` (an InMemorySink) and `opts.createSession` — the spec's
 * injectable hook documented in §8 (default = PlaywrightDriver.createSession). The fake
 * session decides the race winner.
 */
function fakeSession(sink: InMemorySink, winner: "INVALID" | "SUCCESS", id = "run-1"): Session {
  return {
    id,
    driver: "fake",
    capabilities: new Set(),
    telemetry: sink,
    supports: () => false,
    require: () => {},
    locate: () => ({}) as never,
    action: {
      typeText: async () => {},
      tap: async () => {},
      clear: async () => {},
      read: async () => "Invalid Login. Try again.",
    },
    assert: {
      waitFor: async () => {},
      waitForFirstOf: async (
        _conds: ReadonlyArray<{ label: string; target: Locator; state: ElementState }>,
      ) => winner,
    },
    end: async () => {},
  } as unknown as Session;
}

test("invalid path returns business-failure with stable reason and truthy message", async () => {
  const sink = new InMemorySink();
  const result = await logIn(
    fakePage("https://erp/login") as never,
    { username: "admin.invalid", password: "x" },
    { sink, createSession: async () => fakeSession(sink, "INVALID") },
  );

  expect(result.status).toBe("business-failure");
  if (result.status === "business-failure") {
    expect(result.reason).toBe("INVALID_CREDENTIALS");
    expect(result.message).toBeTruthy();
    expect(result.details?.username).toBe("admin.invalid");
  }

  const types = sink.events.map((e) => e.type);
  expect(types).toContain("flow.started");
  expect(types).toContain("flow.finished");
  const biz = sink.events.find((e) => e.type === "business.failure");
  expect(biz).toBeDefined();
  expect((biz as { domainReason?: string }).domainReason).toBe("INVALID_CREDENTIALS");

  // one correlationId across the run
  const ids = new Set(sink.events.map((e) => e.traceId));
  expect(ids.size).toBe(1);
});

test("success path returns success with username", async () => {
  const sink = new InMemorySink();
  const result = await logIn(
    fakePage("https://erp/app") as never,
    { username: "admin", password: "secret" },
    { sink, createSession: async () => fakeSession(sink, "SUCCESS") },
  );
  expect(result.status).toBe("success");
  if (result.status === "success") {
    expect(result.data.username).toBe("admin");
  }
});
```

- [ ] **Step 2: Run it and confirm it FAILS.**

```
Run: npm run test:unit -- tests/flows/log-in.test.ts
Expected: fails — the old flow has no `opts.sink`/`opts.createSession`, returns the flat `{success}` shape, and emits no telemetry; multiple assertions fail.
```

- [ ] **Step 3: Write the implementation** (fold page object into flow; D3 dead `waitForSuccessSignal` deleted; D2 driver `waitForFirstOf` throws on no-winner; one `correlationId`/`startedAt`; build result via `ok`/`businessFailure`; emit `flow.started`/`flow.finished` and on INVALID a `business.failure` with `domainReason:"INVALID_CREDENTIALS"`; `message` via `action.read`).

```ts
// examples/web-erpnext/src/flows/auth/log-in.ts
import type { Page } from "@playwright/test";
import type { Session } from "@sentinel/contracts";
import type { TelemetrySink } from "@sentinel/core";
import { CompositeSink, InMemorySink, JsonlSink, ok, businessFailure } from "@sentinel/core";
import { PlaywrightDriver } from "@sentinel/driver-playwright";
import type { Credentials, LoginResult } from "../../domain/auth";
import { loginLocators, appShellLocators } from "../../domain/auth/locators";
import { LogInForm } from "../../components/auth/log-in-form";
import { defaultTimeoutMs } from "../../config/timeout";

const FLOW_NAME = "auth.login";
const INVALID_REASON = "INVALID_CREDENTIALS" as const;

type CreateSession = (
  page: Page,
  sink: TelemetrySink,
  sessionId: string,
) => Promise<Session>;

export interface LogInOptions {
  readonly timeoutMs?: number;
  /** §10.4 unit hook: inject an InMemorySink to read emitted events. Default: Composite+Jsonl. */
  readonly sink?: TelemetrySink;
  /** §8 unit hook: override session creation. Default: PlaywrightDriver.createSession (page-wrap). */
  readonly createSession?: CreateSession;
}

const defaultCreateSession: CreateSession = (page, sink, sessionId) =>
  PlaywrightDriver.createSession(
    { existingPage: page, defaultTimeoutMs, sessionId },
    sink,
  );

/**
 * Page-wrap login flow (R-1: signature preserved). Builds a Session over the supplied Page,
 * runs the form, and races INVALID vs app-shell-ready via the driver-owned waitForFirstOf
 * (D2/D3 fixed: no Promise.race, no dead waitForSuccessSignal, throws on no-winner).
 * Returns the rich LoginResult (D-2).
 */
async function logIn(
  page: Page,
  credentials: Credentials,
  options?: LogInOptions,
): Promise<LoginResult> {
  const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
  const createSession = options?.createSession ?? defaultCreateSession;

  // Mint the run id up front so it names BOTH the JSONL file and the Session: the driver
  // adopts it as Session.id, so runId == Session.id == correlationId == every event's
  // traceId (spec §3.7/§6). When a sink is injected (unit tests), use it verbatim.
  const runId = crypto.randomUUID();
  const sink =
    options?.sink ??
    new CompositeSink([
      new InMemorySink(),
      new JsonlSink({ filePath: `test-results/telemetry/${runId}.jsonl` }),
    ]);

  const session = await createSession(page, sink, runId);

  const correlationId = session.id;
  const startedAt = Date.now();

  const flowSink = session.telemetry;
  emitFlowStarted(flowSink, correlationId, FLOW_NAME, startedAt);

  const form = new LogInForm(session);
  await form.fill(credentials);
  await form.submit();

  // D2/D3: driver-owned race. THROWS TimeoutError (with branchProgress) on no winner.
  const winner = await session.assert.waitForFirstOf(
    [
      { label: "INVALID", target: loginLocators.invalid, state: "visible" },
      { label: "SUCCESS", target: appShellLocators.ready, state: "visible" },
    ],
    { timeoutMs },
  );

  const finalUrl = session.supports("navigation")
    ? await readCurrentUrl(session)
    : undefined;
  const durationMs = Date.now() - startedAt;
  const meta = { correlationId, flowName: FLOW_NAME, startedAt, durationMs };

  if (winner === "INVALID") {
    const message = await form.readMessage();
    emitBusinessFailure(flowSink, correlationId, FLOW_NAME, INVALID_REASON);
    emitFlowFinished(flowSink, correlationId, FLOW_NAME, "business-failure", INVALID_REASON);
    return businessFailure(INVALID_REASON, meta, {
      message,
      details: { username: credentials.username, finalUrl },
    });
  }

  emitFlowFinished(flowSink, correlationId, FLOW_NAME, "success");
  return ok({ username: credentials.username, finalUrl }, meta);
}

async function readCurrentUrl(session: Session): Promise<string | undefined> {
  return session.currentUrl ? session.currentUrl() : undefined;
}

function nowTiming() {
  return { startWallClockMs: Date.now(), startMonotonicNs: process.hrtime.bigint() };
}

function emitFlowStarted(
  sink: TelemetrySink,
  traceId: string,
  name: string,
  _startedAt: number,
): void {
  sink.emit({
    schemaVersion: "1.0.0",
    eventId: cryptoId(),
    type: "flow.started",
    traceId,
    spanId: cryptoId(),
    sequence: 0,
    name,
    timing: nowTiming(),
  });
}

function emitBusinessFailure(
  sink: TelemetrySink,
  traceId: string,
  name: string,
  domainReason: string,
): void {
  sink.emit({
    schemaVersion: "1.0.0",
    eventId: cryptoId(),
    type: "business.failure",
    traceId,
    spanId: cryptoId(),
    sequence: 0,
    name,
    status: "ok",
    timing: nowTiming(),
    domainReason,
  });
}

function emitFlowFinished(
  sink: TelemetrySink,
  traceId: string,
  name: string,
  outcome: "success" | "business-failure" | "system-failure",
  terminalReason?: string,
): void {
  sink.emit({
    schemaVersion: "1.0.0",
    eventId: cryptoId(),
    type: "flow.finished",
    traceId,
    spanId: cryptoId(),
    sequence: 0,
    name,
    timing: nowTiming(),
    outcome,
    terminalReason,
    didDegrade: false,
  });
}

function cryptoId(): string {
  return crypto.randomUUID();
}

export default logIn;
export { logIn };
```

> NOTE (engineer): `sequence`/`spanId`/`traceId` ownership belongs to the single per-run `SpanContext` inside the session's `StampingSink` (S2/S3). In the real path `session.telemetry` IS that `StampingSink`, so the local `spanId`/`sequence` placeholders these helpers set are **overwritten centrally** — every event (flow + driver) shares one monotonic sequence and `traceId == session.id`. In the fake-session unit test the injected sink is a bare (pure) `InMemorySink`, so the placeholders pass through unchanged; the test asserts only `type`, `traceId`, and `domainReason`, so both paths pass. Keep the single `correlationId = session.id` and single `startedAt`.

- [ ] **Step 4: Run it and confirm PASS.**

```
Run: npm run test:unit -- tests/flows/log-in.test.ts
Expected: 2 passed.
```

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/flows/auth/log-in.ts examples/web-erpnext/tests/flows/log-in.test.ts
Run: git commit -m "feat(example): fold login page object into flow on Session contracts"
Expected: commit succeeds.
```

---

### S4 — Task 8: Delete the old `ui/` tree and dead flat-tree stubs

**Files:**
- Delete: `examples/web-erpnext/src/ui/**` (the whole tree: `components/{log-in-form,app-shell,form,dialog,data-table}/**`, `pages/**`, barrels `ui/index.ts`, `ui/components/index.ts`, `ui/pages/index.ts`)
- Delete: `examples/web-erpnext/src/config/index.ts` (empty barrel)
- Delete: `examples/web-erpnext/src/selectors/**` (folded into `locators.ts`)
- Delete: `examples/web-erpnext/tests/_support/test.config.ts` (empty)
- Modify: `examples/web-erpnext/src/flows/auth/index.ts`, `examples/web-erpnext/src/flows/index.ts` (drop references to deleted `LogInPage`/`src/ui` if any remain after Task 7)

- [ ] **Step 1: Confirm nothing live still imports the doomed paths** (the flow no longer imports `src/ui`, selectors, or `LogInPage` after Task 7; the only remaining importers should be the OLD e2e specs, which S5 fixes).

```
Run: grep -rn "from \"src/ui\|/ui/\|src/selectors\|/selectors\|LogInPage\|src/config/index\|config/index\"" examples/web-erpnext/src examples/web-erpnext/tests/config examples/web-erpnext/tests/domain examples/web-erpnext/tests/components examples/web-erpnext/tests/flows
Expected: no matches (empty output). If any appear in src/** they must be fixed before deleting.
```

- [ ] **Step 2: Delete the dead trees and stubs.**

```
Run: git rm -r examples/web-erpnext/src/ui examples/web-erpnext/src/selectors examples/web-erpnext/src/config/index.ts examples/web-erpnext/tests/_support/test.config.ts
Expected: each path listed as "rm 'examples/web-erpnext/...'".
```

- [ ] **Step 3: Drop the dead `LogInPage` re-exports from the flows barrels** (only if they still reference `src/ui`). The `flows` barrels should re-export only `logIn`.

```ts
// examples/web-erpnext/src/flows/auth/index.ts
export { logIn } from "./log-in";
```

```ts
// examples/web-erpnext/src/flows/index.ts
export { logIn } from "./auth/log-in";
```

- [ ] **Step 4: Verify the example src + packages type-check and lint (S4 acceptance — e2e specs are EXPECTED red).**

```
Run: npm run typecheck
Expected: tsc -b reports errors ONLY in examples/web-erpnext/tests/auth/log-in.spec.ts and tests/_support/fixtures/auth.ts (old flat `result.success`/`result.errorMessage` against the new nested LoginResult). The packages (contracts/core/driver-playwright) and examples/web-erpnext/src/** + the new unit tests compile clean. These two spec/fixture files are fixed in S5 — do NOT touch them here.
```

```
Run: npm run lint
Expected: passes — no `@playwright/test` import outside packages/driver-playwright/** and the test-runner exemption; the new components/flows import only `@sentinel/*`.
```

> ACCEPTANCE CLARIFICATION (read before panicking): per the S4 scope, `npm run typecheck` is NOT fully green at the end of S4 — the two OLD e2e files (`tests/auth/log-in.spec.ts`, `_support/fixtures/auth.ts`) reference the removed flat result shape and will report type errors. That is the intended hand-off state; S5 edits those two files to the nested `status`/`reason`/`message` shape. S4 is "done" when: (a) all new S4 unit tests pass, (b) `npm run lint` is green, (c) the ONLY typecheck failures are those two known e2e files. If any package or any `src/**` file under the example fails to typecheck, S4 is NOT done.

- [ ] **Step 5: Commit.**

```
Run: git add examples/web-erpnext/src/flows/auth/index.ts examples/web-erpnext/src/flows/index.ts
Run: git commit -m "refactor(example): delete legacy ui tree, selectors, and dead flat-tree stubs"
Expected: commit succeeds (the `git rm` from Step 2 is staged into this commit alongside the barrel edits).
```

---

**S4 author notes** (grounding for the engineer):

- **Repo reality:** the working tree on `feat/core-spine` is still the flat `erpnext-e2e` layout (`src/...`, `tests/...`); the S1 monorepo move into `examples/web-erpnext/` has NOT yet been applied. All S4 paths assume the post-S1 layout, consistent with the spec's §2 file map and the S4 scope statement ("relocated... in S1").
- **Exact current values folded in:** css selectors are byte-identical to `src/selectors/{log-in,app-shell}-selectors.ts` (`input#login_email[autocomplete='username']`, `.page-card-body.invalid .btn-login[type='submit']`, `div.desktop-wrapper`); the legacy `10_000` literals (`log-in-form.ts:51`, `app-shell.ts:24`, `log-in-page.ts:28`) become `defaultTimeoutMs`.
- **Defects mapped to tasks:** D1+D2 → Task 5 (AppShell), D4+D5 → Task 6 (LogInForm) and Task 7, D3 (dead `waitForSuccessSignal`) → Task 7 (page object folded into flow, dead method dropped).
- **`Credentials` is a default export today** (`src/domain/auth/credentials.ts`), and the barrel re-exports `{ Credentials, LoginResult }`; Task 3 keeps `Credentials` as a value re-export and converts `LoginResult` to `export type` per spec §8.
- **Two judgment calls (spec-faithful, not invented names):** (1) an `opts.createSession` injection hook makes the Task-7 flow unit-testable without a real browser, citing the spec's own `opts.sink` test-seam intent (§8/§10.4); the default is `PlaywrightDriver.createSession({ existingPage: page, defaultTimeoutMs, sessionId }, sink)`. (2) Telemetry stamping (`sequence`/`spanId`/`traceId`) is owned by the session's `StampingSink` over a single per-run `SpanContext` (S2 Task 11, wired in S3 Task 7); the flow emits through `session.telemetry`, so its placeholder `spanId`/`sequence` are overwritten centrally. The run id is minted in the flow and adopted as `Session.id` via `SessionConfig.sessionId`, so the JSONL filename == `Session.id` == `correlationId` == every event's `traceId`.
- **S4 acceptance is deliberately partial-green:** `npm run lint` green + packages and example `src/**` + new unit tests typecheck green; the two OLD e2e files (`tests/auth/log-in.spec.ts`, `_support/fixtures/auth.ts`) are EXPECTED to fail typecheck against the new nested `LoginResult` and are fixed in S5. This is stated explicitly in Task 8 Step 4 so the engineer is not surprised.

---

> Sub-step S5 — Spec edits + telemetry assertions green

Migrates the two e2e specs/fixtures to the nested `Result` shape, adds offline telemetry-assertion tests (flow-level via `page.setContent`, plus a `JsonlSink` bigint round-trip), and runs the full §10 acceptance checklist. The telemetry tests need no live ERPNext app or env — they drive the real `logIn` flow against an inline login-like DOM with an injected `InMemorySink`.

### S5 — Task 1: Migrate `log-in.spec.ts` to the nested `business-failure` shape (D-2)

**Files:**
- Modify: `examples/web-erpnext/tests/auth/log-in.spec.ts`

- [ ] **Step 1: Run the spec against the new `LoginResult` to see it FAIL to type-check / assert on the old flat fields.**

The S4 flow now returns the rich `LoginResult` (no `.success`/`.errorMessage`). The current spec asserts `result.success`/`result.errorMessage`, which no longer exist, so typecheck fails.

```
Run: npm run typecheck 2>&1 | grep -E "log-in.spec|success|errorMessage" | head -5
```

```
Expected: examples/web-erpnext/tests/auth/log-in.spec.ts(16,26): error TS2339: Property 'success' does not exist on type 'LoginResult'.
```

- [ ] **Step 2: Rewrite the invalid-credentials assertions to the nested shape (spec §8 "Test edits").**

Replace the two flat assertions with the narrowed nested block exactly as the spec dictates. The success path (via `loginAsAdmin`) stays unchanged in intent.

```ts
// examples/web-erpnext/tests/auth/log-in.spec.ts
import { test, expect } from "../_support/fixtures/test";
import { logIn } from "../../src/flows";

test.describe("auth: logIn", () => {
  test("invalid credentials returns structured failure", async ({
    page,
    adminCredentials,
  }) => {
    await page.goto("/login");

    const result = await logIn(page, {
      username: `${adminCredentials.username}.invalid`,
      password: `${adminCredentials.password}.invalid`,
    });

    expect(result.status).toBe("business-failure");
    if (result.status === "business-failure") {
      expect(result.reason).toBe("INVALID_CREDENTIALS");
      expect(result.message).toBeTruthy(); // localized text still surfaced for humans
    }
  });

  test("loginAsAdmin fixture logs in successfully", async ({
    page,
    loginAsAdmin,
  }) => {
    await loginAsAdmin();
    expect(page.url()).not.toContain("/login");
  });
});
```

- [ ] **Step 3: Confirm the spec now type-checks (the assertions are well-typed against `LoginResult`).**

This spec needs a live ERPNext app + env to run, but it must compile offline.

```
Run: npm run typecheck 2>&1 | grep -c "log-in.spec"
```

```
Expected: 0
```

- [ ] **Step 4: Commit.**

```
Run: git add examples/web-erpnext/tests/auth/log-in.spec.ts && git commit -m "test(example): migrate log-in spec to nested Result shape"
```

```
Expected: [feat/core-spine <hash>] test(example): migrate log-in spec to nested Result shape
 1 file changed, 5 insertions(+), 2 deletions(-)
```

---

### S5 — Task 2: Migrate `fixtures/auth.ts` to read `status`/`message`/`reason` (D-2, R-1)

**Files:**
- Modify: `examples/web-erpnext/tests/_support/fixtures/auth.ts`

- [ ] **Step 1: Run typecheck to see the fixture FAIL on the old flat `result.success`/`result.errorMessage`.**

```
Run: npm run typecheck 2>&1 | grep -E "fixtures/auth" | head -5
```

```
Expected: examples/web-erpnext/tests/_support/fixtures/auth.ts(28,15): error TS2339: Property 'success' does not exist on type 'LoginResult'.
```

- [ ] **Step 2: Replace the `if (!result.success)` guard with `if (result.status !== "success")` reading `result.message ?? result.reason`. Keep `loginAsAdmin(page)` (R-1).**

```ts
// examples/web-erpnext/tests/_support/fixtures/auth.ts
import type { Page } from "@playwright/test";
import type { Credentials } from "../../../src/domain/auth";
import { env } from "../../../src/config/env";
import { logIn } from "../../../src/flows";

export type AuthFixtures = Readonly<{
  adminCredentials: Credentials;
  loginAsAdmin: (page: Page) => Promise<void>;
}>;

export const authFixtures: Readonly<{
  adminCredentials: AuthFixtures["adminCredentials"];
  loginAsAdmin: AuthFixtures["loginAsAdmin"];
}> = {
  adminCredentials: {
    username: env.adminUser,
    password: env.adminPassword,
  },
  async loginAsAdmin(page: Page): Promise<void> {
    await page.goto("/login");

    const result = await logIn(page, {
      username: env.adminUser,
      password: env.adminPassword,
    });

    if (result.status !== "success") {
      throw new Error(`Admin login failed: ${result.message ?? result.reason}`);
    }
  },
};
```

- [ ] **Step 3: Confirm the fixture type-checks against the nested `LoginResult` (narrowing makes `message`/`reason` reachable in the non-success branch).**

```
Run: npm run typecheck 2>&1 | grep -c "fixtures/auth"
```

```
Expected: 0
```

- [ ] **Step 4: Commit.**

```
Run: git add examples/web-erpnext/tests/_support/fixtures/auth.ts && git commit -m "test(example): read nested Result status/message in auth fixture"
```

```
Expected: [feat/core-spine <hash>] test(example): read nested Result status/message in auth fixture
 1 file changed, 3 insertions(+), 4 deletions(-)
```

---

### S5 — Task 3: Add a minimal login-like DOM fixture (offline, no live app)

**Files:**
- Create: `examples/web-erpnext/tests/_support/login-dom.ts`

The telemetry assertions (Task 4) drive the **real** `logIn` flow against an inline DOM so they need **no** ERPNext app and **no** env. This fixture returns the HTML strings the S4 locators resolve against: the rank-6 css candidates (`input#login_email[autocomplete='username']`, `input#login_password[autocomplete='current-password']`, `button.btn-login[type='submit']`), the structural invalid signal (`.page-card-body.invalid …`), and the success shell (`div.desktop-wrapper`).

- [ ] **Step 1: Write a value-level test that imports the fixture and asserts both HTML strings contain the load-bearing selectors. It FAILS because the fixture file does not exist yet.**

```ts
// examples/web-erpnext/tests/_support/login-dom.test.ts
import { test, expect } from "@playwright/test";
import { LOGIN_DOM, INVALID_DOM } from "./login-dom";

test("login DOM exposes the css-fallback + success-shell selectors", () => {
  expect(LOGIN_DOM).toContain("input#login_email");
  expect(LOGIN_DOM).toContain("input#login_password");
  expect(LOGIN_DOM).toContain("button class=\"btn-login\"");
  expect(LOGIN_DOM).toContain("div class=\"desktop-wrapper\"");
});

test("invalid DOM exposes the structural .page-card-body.invalid signal", () => {
  expect(INVALID_DOM).toContain("page-card-body invalid");
  expect(INVALID_DOM).toContain("Invalid Login. Try again.");
});
```

```
Run: npm run test:unit -- examples/web-erpnext/tests/_support/login-dom.test.ts 2>&1 | tail -8
```

```
Expected: Error: Cannot find module './login-dom'
```

- [ ] **Step 2: Author the DOM fixture. `LOGIN_DOM` is the success-shell page; `INVALID_DOM` carries the `.page-card-body.invalid` structural toggle plus the localized message text `read()` populates `message` from.**

```ts
// examples/web-erpnext/tests/_support/login-dom.ts

/** Minimal login page whose submit reveals the success shell (div.desktop-wrapper). */
export const LOGIN_DOM = `<!doctype html><html><body>
  <div class="page-card-body">
    <form>
      <input id="login_email" type="text" autocomplete="username" />
      <input id="login_password" type="password" autocomplete="current-password" />
      <button class="btn-login" type="submit">Login</button>
    </form>
  </div>
  <div class="desktop-wrapper" style="display:none">app shell</div>
  <script>
    document.querySelector('button.btn-login').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelector('div.desktop-wrapper').style.display = 'block';
    });
  </script>
</body></html>`;

/** Minimal login page whose submit toggles .invalid on the card and shows the localized message. */
export const INVALID_DOM = `<!doctype html><html><body>
  <div class="page-card-body">
    <form>
      <input id="login_email" type="text" autocomplete="username" />
      <input id="login_password" type="password" autocomplete="current-password" />
      <button class="btn-login" type="submit">Login</button>
      <div class="login-message" style="display:none">Invalid Login. Try again.</div>
    </form>
  </div>
  <script>
    document.querySelector('button.btn-login').addEventListener('click', function (e) {
      e.preventDefault();
      document.querySelector('div.page-card-body').classList.add('invalid');
      var m = document.querySelector('.login-message');
      m.style.display = 'block';
    });
  </script>
</body></html>`;
```

- [ ] **Step 3: Run the fixture test — both assertions PASS (pure-logic, no `page` fixture, no browser launch).**

```
Run: npm run test:unit -- examples/web-erpnext/tests/_support/login-dom.test.ts 2>&1 | tail -5
```

```
Expected: 2 passed
```

- [ ] **Step 4: Commit.**

```
Run: git add examples/web-erpnext/tests/_support/login-dom.ts examples/web-erpnext/tests/_support/login-dom.test.ts && git commit -m "test(example): add offline login-like DOM fixture for telemetry tests"
```

```
Expected: [feat/core-spine <hash>] test(example): add offline login-like DOM fixture for telemetry tests
 2 files changed, ...
```

> **Note (approach chosen):** flow-level test against `page.setContent()` of the inline DOM above — needs **no** live app and **no** env. The S4 `logIn(page,…)` page-wrap path ignores `SessionConfig.baseUrl` (§9), so the only browser interaction is with the inline DOM. The success-path shell selector (`div.desktop-wrapper`) and the invalid-path structural toggle (`.page-card-body.invalid`) are exactly the S4 locator css fallbacks, so the real resolver/assertion/flow code runs end-to-end offline.

---

### S5 — Task 4: Telemetry assertion test — invalid path emits the four classifier signals (§10.4)

**Files:**
- Create: `examples/web-erpnext/tests/auth/telemetry.spec.ts`

Drives the real `logIn` flow against `INVALID_DOM`, injecting an `InMemorySink` via the S4 `opts.sink`, and asserts the run emitted `locator.resolved` (with `resolvedRank`/`candidates`), `assertion`, `flow.finished`, and `business.failure` with `domainReason:"INVALID_CREDENTIALS"`. This uses the `page` fixture (S3-style) against `page.setContent()`, so no live app / no env.

- [ ] **Step 1: Write the failing telemetry test (it FAILS now because S4's `opts.sink` injection emit surface is exercised here for the first time end-to-end on the invalid path).**

```ts
// examples/web-erpnext/tests/auth/telemetry.spec.ts
import { test, expect } from "@playwright/test";
import { InMemorySink } from "@sentinel/core";
import { logIn } from "../../src/flows";
import { INVALID_DOM } from "../_support/login-dom";

test("invalid login emits locator.resolved, assertion, flow.finished, business.failure", async ({
  page,
}) => {
  await page.setContent(INVALID_DOM);
  const sink = new InMemorySink();

  const result = await logIn(
    page,
    { username: "wrong", password: "wrong" },
    { sink },
  );

  expect(result.status).toBe("business-failure");

  const types = sink.events.map((e) => e.type);
  expect(types).toContain("locator.resolved");
  expect(types).toContain("assertion");
  expect(types).toContain("flow.finished");
  expect(types).toContain("business.failure");

  const resolved = sink.events.find((e) => e.type === "locator.resolved");
  expect(resolved).toBeDefined();
  expect(typeof (resolved as { resolvedRank: number }).resolvedRank).toBe(
    "number",
  );
  expect(
    Array.isArray((resolved as { candidates: unknown[] }).candidates),
  ).toBe(true);

  const businessFailure = sink.events.find((e) => e.type === "business.failure");
  expect(
    (businessFailure as { domainReason: string }).domainReason,
  ).toBe("INVALID_CREDENTIALS");
});
```

```
Run: npm run test:unit -- examples/web-erpnext/tests/auth/telemetry.spec.ts 2>&1 | tail -12
```

```
Expected: 1 passed
```

> If this FAILS at this point, the failure is in S4's `logIn` `opts.sink` wiring or the resolver/flow emit obligations (§6, §7 obligation (a)), **not** in this test — the test text is the spec's §10.4 assertion verbatim. Fix S4, not the test. If S4 is correct, it passes first run.

- [ ] **Step 2: Confirm it type-checks (imports `InMemorySink` from `@sentinel/core`; resolves via tsconfig `paths`).**

```
Run: npm run typecheck 2>&1 | grep -c "telemetry.spec"
```

```
Expected: 0
```

- [ ] **Step 3: Commit.**

```
Run: git add examples/web-erpnext/tests/auth/telemetry.spec.ts && git commit -m "test(example): assert telemetry signals on the invalid login path"
```

```
Expected: [feat/core-spine <hash>] test(example): assert telemetry signals on the invalid login path
 1 file changed, ...
```

---

### S5 — Task 5: Telemetry test — `JsonlSink` writes the per-run file and round-trips bigint timing (§10.4)

**Files:**
- Create: `examples/web-erpnext/tests/auth/jsonl-telemetry.spec.ts`

Drives the real `logIn` against `INVALID_DOM` with the **default** sink wiring (`CompositeSink([InMemorySink, JsonlSink])`, filePath `test-results/telemetry/<runId>.jsonl`), then asserts the JSONL file exists, every line parses, and the bigint timing fields (`startMonotonicNs`/`endMonotonicNs`) survive as numeric-string and re-parse to `bigint`.

- [ ] **Step 1: Write the failing JSONL round-trip test.**

The run id is the JSONL filename stem and also `result.meta.correlationId` (== `Session.id`, §3.7), so the test reads the file the run just wrote without guessing the name.

```ts
// examples/web-erpnext/tests/auth/jsonl-telemetry.spec.ts
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logIn } from "../../src/flows";
import { INVALID_DOM } from "../_support/login-dom";

test("JsonlSink writes <runId>.jsonl whose lines parse and bigint timings round-trip", async ({
  page,
}) => {
  await page.setContent(INVALID_DOM);

  const result = await logIn(page, { username: "wrong", password: "wrong" });
  expect(result.status).toBe("business-failure");

  const runId = result.meta.correlationId;
  const filePath = join("test-results", "telemetry", `${runId}.jsonl`);
  expect(existsSync(filePath)).toBe(true);

  const lines = readFileSync(filePath, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  expect(lines.length).toBeGreaterThan(0);

  let sawBigintField = false;
  for (const line of lines) {
    const obj = JSON.parse(line) as {
      timing?: { startMonotonicNs?: string; endMonotonicNs?: string };
    };
    expect(typeof obj).toBe("object");
    const start = obj.timing?.startMonotonicNs;
    if (start !== undefined) {
      sawBigintField = true;
      // serialized as a numeric string; must re-parse to a bigint without throwing.
      expect(typeof start).toBe("string");
      expect(BigInt(start)).toBeGreaterThan(0n);
    }
    const end = obj.timing?.endMonotonicNs;
    if (end !== undefined) {
      expect(BigInt(end)).toBeGreaterThanOrEqual(BigInt(start ?? "0"));
    }
  }
  expect(sawBigintField).toBe(true);
});
```

```
Run: npm run test:unit -- examples/web-erpnext/tests/auth/jsonl-telemetry.spec.ts 2>&1 | tail -12
```

```
Expected: 1 passed
```

> If this FAILS, the defect is in the S2 `JsonlSink` bigint replacer (§6 "bigint hazard") or the S4 default sink wiring/filePath — not in this test.

- [ ] **Step 2: Confirm `test-results/` is git-ignored so the run artifact is not committed (§2 VCS hygiene, added in S1).**

```
Run: git check-ignore test-results/telemetry 2>&1; echo "exit:$?"
```

```
Expected: test-results/telemetry
exit:0
```

- [ ] **Step 3: Confirm it type-checks.**

```
Run: npm run typecheck 2>&1 | grep -c "jsonl-telemetry.spec"
```

```
Expected: 0
```

- [ ] **Step 4: Commit.**

```
Run: git add examples/web-erpnext/tests/auth/jsonl-telemetry.spec.ts && git commit -m "test(example): assert JsonlSink file write and bigint round-trip"
```

```
Expected: [feat/core-spine <hash>] test(example): assert JsonlSink file write and bigint round-trip
 1 file changed, ...
```

---

### S5 — Task 6: Final acceptance — run the full spec §10 checklist (1–6)

**Files:**
- (no source changes; this task is the slice-A acceptance gate)

Runs each §10 criterion as its own command with the exact expected output, flagging which checks run **offline** vs which need `BASE_URL` + `ADMIN_USER` + `ADMIN_PASSWORD` + a running ERPNext app.

- [ ] **Step 1: §10.1 — lint passes (typed rules resolve under `projectService:true`; `no-restricted-imports` reports no out-of-bounds `@playwright/test`). Offline.**

```
Run: npm run lint
```

```
Expected: (no output; exit code 0)
```

- [ ] **Step 2: §10.2 — `tsc -b` type-checks all packages + the example under `strict` + `noUncheckedIndexedAccess`. Offline.**

```
Run: npm run typecheck
```

```
Expected: (no output; exit code 0)
```

- [ ] **Step 3: §10.6 — no `@playwright/test` symbol is importable from `@sentinel/core` or `@sentinel/contracts` (lint ban + clean `dependencies`). Offline.**

```
Run: grep -RIl "@playwright/test\|from \"playwright\"" packages/core/src packages/contracts/src; echo "matches-exit:$?"; node -e "const c=require('./packages/core/package.json').dependencies||{};const k=require('./packages/contracts/package.json').dependencies||{};console.log('core-has-pw:'+('@playwright/test' in c));console.log('contracts-has-pw:'+('@playwright/test' in k));"
```

```
Expected: matches-exit:1
core-has-pw:false
contracts-has-pw:false
```

(`matches-exit:1` means `grep` found zero matches in core/contracts source.)

- [ ] **Step 4: §10.5 — the login success path no longer resolves by timeout (D2 fix): the S3 unit test proves `waitForFirstOf` throws `TimeoutError` (with `branchProgress`) when neither branch is reached. Offline (driver test against inline DOM).**

```
Run: npm run test:unit -- packages/driver-playwright/tests 2>&1 | tail -5
```

```
Expected: ... passed
```

(Includes the S3 `race-throws-on-no-winner` test; it must be present and green.)

- [ ] **Step 5: §10.4 — telemetry asserts: `InMemorySink` captured the four signals + `JsonlSink` bigint round-trip. Offline (flow-level tests against `page.setContent`, no env/app).**

```
Run: npm run test:unit -- examples/web-erpnext/tests/auth/telemetry.spec.ts examples/web-erpnext/tests/auth/jsonl-telemetry.spec.ts 2>&1 | tail -5
```

```
Expected: 2 passed
```

- [ ] **Step 6: Run the whole offline unit suite as one gate.**

```
Run: npm run test:unit 2>&1 | tail -5
```

```
Expected: ... passed
  (0 failed)
```

- [ ] **Step 7: §10.3 — e2e specs in nested shape. REQUIRES a live ERPNext app + env. Run only when `BASE_URL`/`ADMIN_USER`/`ADMIN_PASSWORD` are set and the app is reachable.**

Both e2e specs (`invalid credentials returns structured failure` and `loginAsAdmin fixture logs in successfully`) hit the live app. Skip in offline CI; run in the env-provisioned lane.

```
Run: BASE_URL="$BASE_URL" ADMIN_USER="$ADMIN_USER" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm test -- examples/web-erpnext/tests/auth/log-in.spec.ts 2>&1 | tail -6
```

```
Expected: 2 passed
```

> **Offline vs live-app matrix.**
> - **Offline (no env, no app):** §10.1 lint, §10.2 typecheck, §10.4 telemetry asserts, §10.5 race-throws, §10.6 no-playwright-import — Steps 1–6. These are the slice-A acceptance gate that runs everywhere.
> - **Needs `BASE_URL`+`ADMIN_USER`+`ADMIN_PASSWORD`+running ERPNext:** §10.3 the two `log-in.spec.ts` e2e cases — Step 7. The nested-shape *assertions* and *compilation* are already proven offline (Tasks 1–2 typecheck); Step 7 only confirms they pass against the real app.

- [ ] **Step 8: Commit the acceptance record (no source changes — an empty commit marks the slice-A gate green).**

```
Run: git commit --allow-empty -m "chore(example): slice A acceptance — full §10 offline checklist green"
```

```
Expected: [feat/core-spine <hash>] chore(example): slice A acceptance — full §10 offline checklist green
```

---

**Authoring notes for the assembler (not part of the fragment body):**

- Grounded against the live repo (`feat/core-spine`, still flat pre-S1): the §8 "before" states of `tests/auth/log-in.spec.ts` and `tests/_support/fixtures/auth.ts` match the spec's BEFORE blocks exactly, so the Task 1/2 edits are byte-faithful to spec §8. Import paths in the edited files use `../../src/flows` / `../../../src/flows` to match the example layout (current `src/flows` re-exports `logIn` as a named export; the example preserves that).
- Telemetry approach decision (stated in Task 3 note): **flow-level test against `page.setContent()` of an inline login-like DOM**, injecting `InMemorySink` via `opts.sink` for §10.4's signal asserts and using the default `CompositeSink([InMemorySink, JsonlSink])` for the bigint round-trip. No live ERPNext app and no `BASE_URL`/`ADMIN_*` env required for any S5 telemetry test — only the two §10.3 e2e specs need them, flagged in Task 6 Step 7.
- The DOM fixture's css selectors (`input#login_email`, `input#login_password`, `button.btn-login`, `.page-card-body.invalid`, `div.desktop-wrapper`) are the exact S4 rank-6 css fallbacks + success-shell selector from spec §7, so the real resolver/assertion/flow code paths execute offline.

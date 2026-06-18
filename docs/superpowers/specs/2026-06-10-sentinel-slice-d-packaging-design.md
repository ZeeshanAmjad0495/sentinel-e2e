# Sentinel Slice D — Installable Packaging: Design Spec

- **Status:** Approved (lean spec — packaging is well-bounded, no UI/architecture forks)
- **Date:** 2026-06-10
- **Branch:** work directly on `main` (per the standing "no PRs, push directly to main" directive); each phase pushed when green.
- **Scope:** Make the five framework packages installable like Playwright (`npm i @sentinel/core` etc.) — real `dist` builds, `exports`/`main`/`types` pointing at compiled output, `files`/`publishConfig`, consistent versions, concrete cross-dep ranges — **publish-ready and `npm pack`-verified** (actual `npm publish` needs registry credentials, out of scope). The dev/test path-alias resolution (`@sentinel/*` → `src` via tsconfig) is preserved unchanged, so the offline test suite stays green.

---

## 0. Locked decisions

| #   | Decision                                                                                                                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Build = `tsc -b` emit to `dist/`** (no bundler)                                                                                                               | Packages are already `composite:true` + `declaration:true` with `outDir:dist`. tsc emit gives `dist/*.js` + `*.d.ts` + maps for free; a bundler is unwarranted for a CJS TS library monorepo. Add a root `build` script.                                                                                                                                                               |
| D-2 | **Dual resolution: published→`dist`, dev/test→`src`**                                                                                                           | `package.json` `main`/`types`/`exports` point at `dist` (what installed consumers get). The repo's `tsconfig.base.json` `paths` keep mapping `@sentinel/*` → `src` for the Playwright unit-runner + `tsc -b`, so tests/typecheck are unaffected. This is the standard library dual-entry; the two never conflict because the test loader uses tsconfig paths, not `package.json main`. |
| D-3 | **Publishable = the 5 framework packages** (`contracts`, `core`, `driver-playwright`, `driver-selenium`, `ai`); **`examples/web-erpnext` stays `private:true`** | The example is a consumer/SUT, not a shipped artifact. (The conformance suite lives under `packages/contracts/tests/conformance/`, not a separate package — nothing to publish.)                                                                                                                                                                                                       |
| D-4 | **Version baseline `0.1.0` for all five**, cross-deps as `^0.1.0`                                                                                               | Today versions are mixed (0.0.0 / 1.0.0) and cross-deps are `"*"`. npm does NOT rewrite `"*"` on publish (that's pnpm's `workspace:`), so concrete ranges are required for an installed package to resolve its siblings. One coherent baseline.                                                                                                                                        |
| D-5 | **No actual publish; acceptance is `npm pack`-verified**                                                                                                        | No registry credentials in scope. The slice proves: build emits dist, `npm pack` ships the right files, a packed tarball installs+resolves from dist. A later step wires real publish (CI + token + provenance).                                                                                                                                                                       |

---

## 1. Per-package manifest changes (the 5 framework packages)

For each of `packages/{contracts,core,driver-playwright,driver-selenium,ai}/package.json`:

- Remove `"private": true` (or set `false`) — make it publishable.
- `"version": "0.1.0"` (uniform).
- `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, `"type": "commonjs"`.
- `"exports"`:
  ```jsonc
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  }
  ```
  (Add subpath exports only where a package has a public subpath; the current barrels export everything from `.`, so a single root export suffices. Do NOT export `./src/*`.)
- `"files": ["dist"]` (npm always includes `package.json` + `README.md` + `LICENSE`; this restricts the rest to `dist`, excluding `src`/`tests`/`tsconfig`).
- `"publishConfig": { "access": "public" }`.
- `"engines": { "node": ">=20" }` (selenium already has it; apply to all for consistency).
- `"license": "MIT"`, `"repository": { "type": "git", "url": "https://github.com/ZeeshanAmjad0495/sentinel-e2e.git", "directory": "packages/<name>" }`.
- **Cross-deps:** replace `"@sentinel/contracts": "*"` / `"@sentinel/core": "*"` with `"^0.1.0"`. (npm workspace install still symlinks locally because the local version `0.1.0` satisfies `^0.1.0`.)
- **`@sentinel/ai`** keeps `"bin": { "sentinel-analyze": "dist/cli.js" }` (already correct); ensure `dist/cli.js` ships (covered by `files:["dist"]`) and has a shebang (`#!/usr/bin/env node`) — add the shebang to `src/cli.ts` if absent (tsc preserves leading shebang).
- `@anthropic-ai/sdk` stays a real `dependency` of `ai`; `selenium-webdriver` a real `dependency` of `driver-selenium`; `@playwright/test` stays a `peerDependency`+`devDependency` of `driver-playwright` (slice C).

Each publishable package gets a minimal **`README.md`** (name, one-paragraph purpose, install line, link back to the root README) so npm renders something real.

## 2. Root `package.json`

- Add `"build": "tsc -b"` and `"build:clean": "tsc -b --clean"`.
- Add `"pack:check": "npm run build && for p in contracts core driver-playwright driver-selenium ai; do npm pack -w @sentinel/$p --dry-run; done"` (or a small node script) — lists the tarball contents for verification.
- Keep `type: commonjs`, workspaces, existing scripts.
- The repo root stays `private` (it is the workspace root, never published).

## 3. The dev/test invariant (must not regress)

`tsconfig.base.json` `paths` (`@sentinel/* → packages/*/src/...`) are **unchanged**. The Playwright unit runner and `tsc -b` resolve via those paths → `src`. Therefore:

- `npm run test:unit` stays green (resolves `src`, ignores `package.json main`).
- `npm run typecheck` (`tsc -b`) stays green (project references unchanged; it now ALSO populates `dist`).
- The `analyze` script (`tsc -b && node packages/ai/dist/cli.js`) still works — it builds dist then runs the compiled CLI, which resolves its `@sentinel/*` deps at runtime via `package.json main → dist` (now that those exist post-build).

## 4. Acceptance criteria

1. `npm run build` (`tsc -b`) emits `dist/index.js` + `dist/index.d.ts` for all five packages (and `dist/cli.js` for ai).
2. `npm run typecheck` 0; `npm run lint` 0; `npm run test:unit` green (same counts as before — dev resolution unchanged); `SENTINEL_SELENIUM=1` suite still green.
3. For each publishable package, `npm pack -w @sentinel/<pkg> --dry-run` lists ONLY `dist/**` + `package.json` + `README.md` (+ `LICENSE` if present) — **no `src/`, `tests/`, `tsconfig*`**.
4. **Install-verify (best-effort):** `npm run build` then in a temp dir, `npm pack` the tarballs and `npm i` them into a throwaway project; `node -e "require('@sentinel/core')"` and `require('@sentinel/contracts')` resolve from `dist` without error; `npx sentinel-analyze <a sample jsonl>` runs from the installed `ai` package. (If the sandbox can't install cross-package tarballs cleanly, at minimum prove each tarball's `main` file exists in the tarball and `node -e "require('<unpacked>/dist/index.js')"` loads.)
5. `examples/web-erpnext` remains `private:true` and is NOT in any pack list.
6. Versions are uniformly `0.1.0`; cross-deps are `^0.1.0`; a fresh `npm install` still links the workspace (local 0.1.0 satisfies `^0.1.0`) and the suite stays green.
7. `dist/` stays git-ignored (already is) — built artifacts are not committed.

## 5. Residual / deferred

- **Actual `npm publish`** (registry token, provenance, a release workflow / changesets) — deferred to a release step; this slice is publish-_ready_ and pack-verified.
- ESM dual-build (the packages are CJS-only) — deferred; consumers on ESM can still `import` CJS via Node interop.
- A top-level `sentinel` CLI (beyond `sentinel-analyze`) — slice E.

## 6. Ordered sub-steps

1. **D1 — build wiring:** root `build`/`build:clean`/`pack:check` scripts; confirm `tsc -b` emits dist for all five (gate: `npm run build` green, dist present, `test:unit` unchanged-green). Add the `cli.ts` shebang.
2. **D2 — manifests:** apply §1 to all five package.json (un-private, version 0.1.0, main/types/exports/files/publishConfig/engines/license/repository, cross-deps `^0.1.0`); add minimal per-package READMEs. Keep example private. (gate: `npm install` relinks + `typecheck`/`lint`/`test:unit` green.)
3. **D3 — pack + install verify:** `npm pack --dry-run` content assertions per package (no src/tests); the best-effort tarball install-and-require check; document the real-publish gap. (gate: pack lists correct; install-require works or the documented fallback.)

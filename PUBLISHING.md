# Publishing Sentinel to npm (`@sentinele2e/*`, public)

The six packages are publish-ready: `npm pack`-verified, `publishConfig.access: public`,
uniform `0.1.0`, concrete `^0.1.0` cross-deps, MIT-licensed, `npm publish --dry-run` clean.
The only remaining steps need credentials (an npm token) and the `@sentinele2e` scope —
both yours to provide. This repo already ships a **publish-on-tag** workflow
(`.github/workflows/release.yml`).

Publishable packages, in dependency order:
`@sentinele2e/contracts` → `@sentinele2e/core` → `@sentinele2e/driver-playwright` → `@sentinele2e/driver-selenium` → `@sentinele2e/ai` → `@sentinele2e/cli`.

---

## Step 0 — Confirm the `@sentinele2e` scope is yours

From a machine with registry access:

```bash
npm view @sentinele2e/core version
```

- **`E404` (not found)** → the name is free under the scope. Make sure you own the
  `@sentinele2e` **org** on npm (create it at <https://www.npmjs.com/org/create>, name `sentinele2e`),
  or the publish will be rejected as an unowned scope.
- **Returns a version** → the scope/name is already taken by someone else. Either request
  the org, or rename the scope (e.g. `@zeeshanamjad0495/*`) before publishing.

## Step 1 — Create an npm automation token

npmjs.com → your avatar → **Access Tokens** → **Generate New Token** →
**Granular Access Token** (or "Automation"): allow **read + write** to the `@sentinele2e` scope,
no IP allowlist, sensible expiry. Copy it.

## Step 2A — Publish via CI (recommended)

Add the token as a repo secret, then push a tag:

```bash
gh secret set NPM_TOKEN          # paste the token when prompted
# (or: gh secret set NPM_TOKEN --body "npm_xxx")

git tag v0.1.0 && git push origin v0.1.0     # if v0.1.0 already exists, bump: v0.1.1
```

On the tag push, `release.yml` runs: `npm ci` → `npm run build` → pack → attach tarballs to
the GitHub Release → (because `NPM_TOKEN` now exists) `npm publish --access public --provenance`
for all six packages in dependency order. Watch it with `gh run watch`.

> Note: the tag `v0.1.0` was already created for the GitHub Release. To trigger a _publish_ run,
> either set the secret and push a **new** tag (`v0.1.1` after bumping versions), or delete and
> re-push `v0.1.0` (`git push origin :v0.1.0 && git push origin v0.1.0`) once the secret is set.

## Step 2B — Publish from your machine (alternative)

```bash
npm login                        # authenticate once
npm run build
for p in contracts core driver-playwright driver-selenium ai cli; do
  npm publish -w @sentinele2e/$p --access public --provenance
done
```

Publish in that order so each package's `@sentinele2e/*` dependencies already exist on the registry.

## Step 3 — Verify

```bash
npm view @sentinele2e/cli version          # -> 0.1.0
npx @sentinele2e/cli@0.1.0 --version       # -> 0.1.0
```

---

## Re-publishing / new versions

npm versions are immutable — bump before re-publishing. Keep the six in lockstep at one version
and update the `^x.y.z` cross-deps to match. Then tag `vX.Y.Z` (CI path) or run Step 2B.

## GitHub Packages instead of npmjs

GitHub Packages requires the scope to equal the repo owner (`@zeeshanamjad0495/*`), so it needs a
full scope rename across the monorepo. Not set up here — ask if you want that path instead.

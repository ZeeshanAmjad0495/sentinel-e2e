#!/usr/bin/env bash
#
# verify-pack-install.sh — Slice D install-verify (design §4.4)
#
# Proves the framework packages are installable like a published library:
#   1. `npm run build` emits dist for all of them.
#   2. `npm pack` produces a tarball per package (dist + package.json + README only).
#   3. The packed tarballs install into a throwaway project and resolve from dist:
#        - require('@sentinele2e/contracts') and require('@sentinele2e/core') load from dist,
#        - the @sentinele2e/ai `sentinel-analyze` bin runs against a sample JSONL run,
#        - @sentinele2e/dashboard's generateDashboard renders a minimal model (slice F).
#
# The throwaway project and the tarballs live under a temp dir that is removed on
# exit — nothing here is committed. Run from the repo root: `bash scripts/verify-pack-install.sh`.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PKGS=(contracts core driver-playwright driver-selenium ai dashboard)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sentinel-pack-verify.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> repo root: $REPO_ROOT"
echo "==> temp workspace: $WORK"

echo "==> 1/4 building (tsc -b)"
npm run build >/dev/null

echo "==> 2/4 packing tarballs"
TARBALLS=()
for p in "${PKGS[@]}"; do
  # `npm pack --pack-destination` writes the tarball and prints its filename on the last line.
  fname="$(npm pack -w "@sentinele2e/$p" --pack-destination "$WORK" 2>/dev/null | tail -1)"
  TARBALLS+=("$WORK/$fname")
  echo "    packed @sentinele2e/$p -> $fname"
done

echo "==> 3/4 installing tarballs into a throwaway project"
PROJ="$WORK/consumer"
mkdir -p "$PROJ"
cat >"$PROJ/package.json" <<'JSON'
{ "name": "sentinel-pack-consumer", "version": "0.0.0", "private": true }
JSON

# Install all five tarballs together so cross-deps (^0.1.0) resolve against the
# freshly-installed siblings. --no-save keeps the temp package.json untouched.
( cd "$PROJ" && npm install --no-save --no-audit --no-fund "${TARBALLS[@]}" >/dev/null )
echo "    installed: $(cd "$PROJ" && ls node_modules/@sentinele2e)"

echo "==> 4/4 require() + CLI checks (must resolve from dist)"
( cd "$PROJ" && node -e '
  const path = require("path");
  for (const name of ["@sentinele2e/contracts", "@sentinele2e/core"]) {
    const mod = require(name);
    const resolved = require.resolve(name);
    if (!resolved.includes(path.join("dist", "index.js"))) {
      throw new Error(`${name} did not resolve from dist: ${resolved}`);
    }
    if (mod == null || typeof mod !== "object") {
      throw new Error(`${name} did not load a module object`);
    }
    console.log(`    OK  require("${name}") -> ${path.relative(process.cwd(), resolved)}`);
  }
' )

# A minimal but valid telemetry run: one failing assertion -> the rules classifier
# produces a verdict, exercising the full load -> redact -> classify -> render path.
SAMPLE="$WORK/sample-run.jsonl"
cat >"$SAMPLE" <<'JSONL'
{"schemaVersion":"1.0.0","eventId":"e1","type":"action","traceId":"t1","spanId":"s1","sequence":0,"name":"navigate","timing":{"startMonotonicNs":"0","endMonotonicNs":"1000"}}
{"schemaVersion":"1.0.0","eventId":"e2","type":"assertion","traceId":"t1","spanId":"s2","sequence":1,"name":"toBeVisible","timing":{"startMonotonicNs":"1000","endMonotonicNs":"2000"}}
JSONL

( cd "$PROJ" && npx --no-install sentinel-analyze "$SAMPLE" --json >"$WORK/cli-out.json" || true )
if [ -s "$WORK/cli-out.json" ]; then
  echo "    OK  npx sentinel-analyze produced output:"
  node -e 'const j=require(process.argv[1]); console.log("        verdicts:", JSON.stringify(j.verdicts ?? j).slice(0,200))' "$WORK/cli-out.json" || cat "$WORK/cli-out.json"
else
  echo "    !!  sentinel-analyze produced no output" >&2
  exit 1
fi

# Slice F (seam 9): require() the dashboard dist and render a hand-built minimal
# model (no shipped fixtures); the output must be a self-contained HTML string
# carrying the <script id="sentinel-data"> data island.
( cd "$PROJ" && node -e '
  const path = require("path");
  const { generateDashboard } = require("@sentinele2e/dashboard");
  const resolved = require.resolve("@sentinele2e/dashboard");
  if (!resolved.includes(path.join("dist", "index.js"))) {
    throw new Error(`@sentinele2e/dashboard did not resolve from dist: ${resolved}`);
  }
  const model = {
    report: {
      schemaVersion: "1.0.0",
      generatedFrom: "pack-verify",
      totals: {
        runs: 1, realBug: 0, infraFlake: 0, selectorDrift: 0,
        businessOutcome: 0, healthy: 1, driftingLocators: [],
      },
      runs: [],
    },
    runs: [],
    generatedAt: "1970-01-01T00:00:00.000Z",
    anyTruncated: false,
  };
  const html = generateDashboard(model, {});
  if (typeof html !== "string" || !html.includes("sentinel-data")) {
    throw new Error("generateDashboard output missing the sentinel-data island");
  }
  console.log("    OK  generateDashboard(minimal model) -> self-contained HTML with sentinel-data");
' )

echo "==> PASS: all six tarballs install and resolve from dist; sentinel-analyze runs; dashboard renders."

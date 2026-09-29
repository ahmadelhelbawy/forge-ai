#!/usr/bin/env bash
# Package smoke test: build the npm tarball, install it into an empty
# directory OUTSIDE the repository, and run the installed CLI on the
# deterministic path. Nothing here needs a key or the network.
#
# It exists because the tarball once shipped without strategies/, and
# every test ran from the source tree, where the directory is always present.
#   scripts/pack-smoke.sh   (from the repository root, after `pnpm --filter forge build`)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/forge-pack-smoke.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

(cd "$ROOT" && npm pack --silent --pack-destination "$WORK" >/dev/null)
TARBALL="$(ls "$WORK"/forge-*.tgz)"
echo "==> packed $(basename "$TARBALL")"

tar tzf "$TARBALL" > "$WORK/listing.txt"
for dir in dist/cli/index.js dist/intent/prompt.md profiles strategies schema; do
  grep -q "^package/$dir" "$WORK/listing.txt" || { echo "missing from tarball: $dir"; exit 1; }
done

mkdir -p "$WORK/app"
cd "$WORK/app"
npm init -y >/dev/null
npm install --silent --no-audit --no-fund "$TARBALL" >/dev/null
FORGE="$WORK/app/node_modules/.bin/forge"
IR="$ROOT/fixtures/ir/auth-debug.json"

"$FORGE" agents >/dev/null
"$FORGE" ir validate "$IR" >/dev/null
"$FORGE" strategies --ir "$IR" --target claude-code >/dev/null
"$FORGE" compile --ir "$IR" --target claude-code --out "$WORK/out" >/dev/null
"$FORGE" package --ir "$IR" --target claude-code --out "$WORK/pkg" >/dev/null
"$FORGE" explain --package "$WORK/pkg" >/dev/null
node --input-type=module -e "import('forge').then((m) => { if (typeof m.compile !== 'function') throw new Error('root export broken'); })"
echo "==> installed package: agents, ir validate, strategies, compile, package, explain, import — OK"

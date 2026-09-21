#!/usr/bin/env bash
# The EXTERNAL executor — stands in for CI. Not part of FORGE; FORGE runs none of this.
# Usage: ci-run.sh <project> <package-dir> <evidence-out-dir>
set -u
PROJ=$1; PKG=$2; OUT=$3
mkdir -p "$OUT/logs"
SEM=$(jq -r .semantic_id "$PKG/package.json")
START=$(date -u +%Y-%m-%dT%H:%M:%SZ); T0=$(date +%s%3N)
( cd "$PROJ" && node --test ) >"$OUT/logs/v1.out" 2>"$OUT/logs/v1.err"; CODE=$?
DUR=$(( $(date +%s%3N) - T0 ))
H() { echo "sha256:$(sha256sum "$1" | cut -d' ' -f1)"; }
COMMIT=$(git -C "$PROJ" rev-parse HEAD)
jq -n --arg sem "$SEM" --argjson code $CODE --arg so "$(H "$OUT/logs/v1.out")" --arg se "$(H "$OUT/logs/v1.err")" \
  --arg start "$START" --argjson dur $DUR --arg commit "$COMMIT" '
  { records: [ { obligation_id: "v1", kind: "test", exit_code: $code, stdout_hash: $so, stderr_hash: $se,
      started_at: $start, duration_ms: $dur, runner: "ci", repo_commit: $commit, package_semantic_id: $sem } ] }' >"$OUT/evidence.json"
echo "external run: node --test exited $CODE" >> "$PROJ/../RUNS.log"
echo "external run: node --test exited $CODE"

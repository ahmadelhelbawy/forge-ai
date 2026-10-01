#!/usr/bin/env bash
# The product suite against the Docker image instead of a local build.
#
#   scripts/docker-e2e.sh                 # builds forge:e2e from this checkout
#   IMAGE=forge:local scripts/docker-e2e.sh   # tests an existing image
#
# Same HTTP suite (every test must run) and browser acceptance as
# web/scripts/e2e.sh, but the servers are containers on fresh named volumes:
# it proves the image carries the core, its dependencies, profiles and
# strategies, and that the web app resolves them. Ports are published on
# 127.0.0.1 at the same numbers inside and out, the stub provider runs inside
# the first container (so "localhost:<port>" means it from both sides), and
# the fixture repositories are mounted read-only at their host path. Works on
# Linux and Docker Desktop alike.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-forge:e2e}"
OK_PORT="${E2E_OK_PORT:-3230}"
FAIL_PORT="${E2E_FAIL_PORT:-3231}"
PROVIDER_PORT="${E2E_PROVIDER_PORT:-3232}"
RUN_ID="forge-e2e-$$"

for port in "$OK_PORT" "$FAIL_PORT" "$PROVIDER_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "port $port is already in use — stop that process or set E2E_*_PORT"; exit 1
  fi
done

LOGS="$(mktemp -d "${TMPDIR:-/tmp}/forge-docker-e2e.XXXXXX")"
REPO_ROOTS="$LOGS/repos"
# The suite's own temporary directories (one deliberately OUTSIDE the
# allowlist) must exist inside the container too, at the same path.
SUITE_TMP="$LOGS/tmp"
mkdir -p "$REPO_ROOTS" "$SUITE_TMP"
chmod 0755 "$LOGS" "$REPO_ROOTS" "$SUITE_TMP"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for c in "$RUN_ID-ok" "$RUN_ID-fail"; do
      echo "---- $c (last 40 lines) ----"; docker logs --tail 40 "$c" 2>&1 || true
    done
    echo "---- stub-provider ----"; docker exec "$RUN_ID-ok" tail -n 20 /tmp/stub-provider.log 2>&1 || true
  fi
  docker rm -f "$RUN_ID-ok" "$RUN_ID-fail" >/dev/null 2>&1 || true
  docker volume rm "$RUN_ID-ok" "$RUN_ID-fail" >/dev/null 2>&1 || true
  rm -rf "$LOGS"
}
trap cleanup EXIT

if [ "$IMAGE" = "forge:e2e" ]; then
  echo "==> building $IMAGE"
  docker build -q -t "$IMAGE" "$ROOT" >/dev/null
fi

echo "==> starting containers ($IMAGE)"
docker run -d --name "$RUN_ID-ok" -v "$RUN_ID-ok:/data" \
  -p "127.0.0.1:$OK_PORT:$OK_PORT" -p "127.0.0.1:$PROVIDER_PORT:$PROVIDER_PORT" \
  -e PORT="$OK_PORT" -e FORGE_CHAT_STUB=1 -e FORGE_CHAT_STUB_DELAY_MS=10 \
  -e FORGE_REPO_ROOTS="$REPO_ROOTS" -v "$LOGS:$LOGS:ro" \
  "$IMAGE" >/dev/null
docker run -d --name "$RUN_ID-fail" -v "$RUN_ID-fail:/data" \
  -p "127.0.0.1:$FAIL_PORT:$FAIL_PORT" -e PORT="$FAIL_PORT" -e FORGE_CHAT_STUB=error \
  "$IMAGE" >/dev/null
# The stub is a test fixture, not part of the image: copied in for this run only.
docker cp "$ROOT/web/scripts/stub-provider.mjs" "$RUN_ID-ok:/tmp/stub-provider.mjs" >/dev/null
docker exec -d "$RUN_ID-ok" sh -c "node /tmp/stub-provider.mjs $PROVIDER_PORT 0.0.0.0 >/tmp/stub-provider.log 2>&1"

for i in $(seq 1 60); do
  if curl -sf "http://localhost:$OK_PORT/api/health" >/dev/null && \
     curl -sf "http://localhost:$FAIL_PORT/api/health" >/dev/null && \
     curl -sf "http://localhost:$PROVIDER_PORT/models" >/dev/null; then
    break
  fi
  sleep 2
  if [ "$i" = 60 ]; then echo "containers never became ready"; exit 1; fi
done

echo "==> product HTTP suite against the image"
TMPDIR="$SUITE_TMP" WEB_E2E=1 WEB_E2E_BASE="http://localhost:$OK_PORT" WEB_E2E_FAIL_BASE="http://localhost:$FAIL_PORT" \
  WEB_E2E_PROVIDER_BASE="http://localhost:$PROVIDER_PORT" WEB_E2E_REPO_ROOTS="$REPO_ROOTS" \
  pnpm --dir "$ROOT" exec vitest run tests/product/web-api.test.ts --reporter=default --reporter=json --outputFile.json="$LOGS/http.json"
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (r.numPendingTests > 0 || r.numTodoTests > 0 || r.numPassedTests === 0) {
    console.error(`HTTP suite: ${r.numPassedTests} passed, ${r.numPendingTests} skipped — every test must run`);
    process.exit(1);
  }
  console.log(`HTTP suite: all ${r.numPassedTests} tests ran and passed`);
' "$LOGS/http.json"

echo "==> browser acceptance against the image"
BASE="http://localhost:$OK_PORT" FAIL_BASE="http://localhost:$FAIL_PORT" node "$ROOT/web/scripts/browser-acceptance.mjs"

echo "==> image contents"
docker exec "$RUN_ID-ok" sh -c '
  set -e
  forge agents >/dev/null
  test -d /opt/forge/strategies && test -d /opt/forge/profiles && test -d /opt/forge/schema
  test "$(id -u)" = 1000
  stat -c "%a %n" /data/app.secret
' 
echo "docker e2e: passed"

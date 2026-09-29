#!/usr/bin/env bash
# Product E2E runner: build, start stub + error-stub servers, run the HTTP
# suite and the browser acceptance.
# Usage: web/scripts/e2e.sh   (from the repository root)
#   E2E_OK_PORT / E2E_FAIL_PORT / E2E_PROVIDER_PORT override the ports.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OK_PORT="${E2E_OK_PORT:-3210}"
FAIL_PORT="${E2E_FAIL_PORT:-3211}"
PROVIDER_PORT="${E2E_PROVIDER_PORT:-3220}"

# A server already on one of these ports would answer the health checks and the
# suite would run against the wrong build and data directory. Refuse instead.
for port in "$OK_PORT" "$FAIL_PORT" "$PROVIDER_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "port $port is already in use — stop that process or set E2E_*_PORT"; exit 1
  fi
done

OK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forge-e2e-ok.XXXXXX")"
FAIL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forge-e2e-fail.XXXXXX")"
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/forge-e2e-logs.XXXXXX")"
# V2-H: the operator allowlist for repository binding (RB-R2). The suite
# creates its fixture repositories inside it.
REPO_ROOTS="$(mktemp -d "${TMPDIR:-/tmp}/forge-e2e-repos.XXXXXX")"

cleanup() {
  status=$?
  kill ${OK_PID:-} ${FAIL_PID:-} ${STUB_PID:-} 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    for log in "$LOGS"/*.log; do
      [ -f "$log" ] || continue
      echo "---- $(basename "$log") (last 40 lines) ----"; tail -n 40 "$log"
    done
  fi
  rm -rf "$OK_DIR" "$FAIL_DIR" "$REPO_ROOTS" "$LOGS"
}
trap cleanup EXIT

echo "==> building web app (clean, standalone traces are stale across installs)"
rm -rf "$ROOT/web/.next"
pnpm --dir "$ROOT/web" build >/dev/null

echo "==> starting stub servers"
# 10 ms per streamed chunk: at the stub's default 1 ms a whole answer streams in
# ~20 ms, so the AC-036 "cancel mid-stream" test often cancelled after the stream
# had ended (measured 3/6 passes on the pre-Sprint-2 build). This makes the
# test's precondition true; its assertions are unchanged.
PORT="$OK_PORT" FORGE_DATA_DIR="$OK_DIR" FORGE_CHAT_STUB=1 FORGE_CHAT_STUB_DELAY_MS=10 FORGE_REPO_ROOTS="$REPO_ROOTS" \
  node "$ROOT/web/.next/standalone/web/server.js" >"$LOGS/ok-server.log" 2>&1 &
OK_PID=$!
PORT="$FAIL_PORT" FORGE_DATA_DIR="$FAIL_DIR" FORGE_CHAT_STUB=error \
  node "$ROOT/web/.next/standalone/web/server.js" >"$LOGS/fail-server.log" 2>&1 &
FAIL_PID=$!
node "$ROOT/web/scripts/stub-provider.mjs" "$PROVIDER_PORT" >"$LOGS/stub-provider.log" 2>&1 &
STUB_PID=$!

for i in $(seq 1 60); do
  for pid in "$OK_PID" "$FAIL_PID" "$STUB_PID"; do
    kill -0 "$pid" 2>/dev/null || { echo "a server this run started has exited"; exit 1; }
  done
  if curl -sf "http://localhost:$OK_PORT/api/health" >/dev/null && \
     curl -sf "http://localhost:$FAIL_PORT/api/health" >/dev/null && \
     curl -sf "http://localhost:$PROVIDER_PORT/models" >/dev/null; then
    break
  fi
  sleep 2
  if [ "$i" = 60 ]; then echo "servers never became ready"; exit 1; fi
done

echo "==> running product HTTP suite"
WEB_E2E=1 WEB_E2E_BASE="http://localhost:$OK_PORT" WEB_E2E_FAIL_BASE="http://localhost:$FAIL_PORT" \
  WEB_E2E_PROVIDER_BASE="http://localhost:$PROVIDER_PORT" WEB_E2E_REPO_ROOTS="$REPO_ROOTS" \
  pnpm vitest run tests/product/web-api.test.ts --reporter=default --reporter=json --outputFile.json="$LOGS/http.json"

# Every block is gated on WEB_E2E: if that wiring broke, vitest would skip them
# all and still exit 0. A skipped HTTP test is a failure here.
node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (r.numPendingTests > 0 || r.numTodoTests > 0 || r.numPassedTests === 0) {
    console.error(`HTTP suite: ${r.numPassedTests} passed, ${r.numPendingTests} skipped — every test must run`);
    process.exit(1);
  }
  console.log(`HTTP suite: all ${r.numPassedTests} tests ran and passed`);
' "$LOGS/http.json"

echo "==> running browser acceptance"
BASE="http://localhost:$OK_PORT" FAIL_BASE="http://localhost:$FAIL_PORT" node "$ROOT/web/scripts/browser-acceptance.mjs"

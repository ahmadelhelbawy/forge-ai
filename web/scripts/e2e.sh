#!/usr/bin/env bash
# Product E2E runner: build, start stub + error-stub servers, run the HTTP suite.
# Usage: web/scripts/e2e.sh   (from the repository root)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OK_DIR="$(mktemp -d /tmp/forge-e2e-ok.XXXXXX)"
FAIL_DIR="$(mktemp -d /tmp/forge-e2e-fail.XXXXXX)"
# V2-H: the operator allowlist for repository binding (RB-R2). The suite
# creates its fixture repositories inside it.
REPO_ROOTS="$(mktemp -d /tmp/forge-e2e-repos.XXXXXX)"

cleanup() {
  kill ${OK_PID:-} ${FAIL_PID:-} ${STUB_PID:-} 2>/dev/null || true
  rm -rf "$OK_DIR" "$FAIL_DIR" "$REPO_ROOTS"
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
PORT=3210 FORGE_DATA_DIR="$OK_DIR" FORGE_CHAT_STUB=1 FORGE_CHAT_STUB_DELAY_MS=10 FORGE_REPO_ROOTS="$REPO_ROOTS" \
  node "$ROOT/web/.next/standalone/web/server.js" >/tmp/forge-e2e-ok.log 2>&1 &
OK_PID=$!
PORT=3211 FORGE_DATA_DIR="$FAIL_DIR" FORGE_CHAT_STUB=error \
  node "$ROOT/web/.next/standalone/web/server.js" >/tmp/forge-e2e-fail.log 2>&1 &
FAIL_PID=$!
node "$ROOT/web/scripts/stub-provider.mjs" 3220 >/tmp/forge-e2e-provider.log 2>&1 &
STUB_PID=$!

for i in $(seq 1 60); do
  if curl -sf http://localhost:3210/api/health >/dev/null && \
     curl -sf http://localhost:3211/api/health >/dev/null && \
     curl -sf http://localhost:3220/models >/dev/null; then
    break
  fi
  sleep 2
  if [ "$i" = 60 ]; then echo "servers never became ready"; exit 1; fi
done

echo "==> running product HTTP suite"
WEB_E2E=1 WEB_E2E_BASE=http://localhost:3210 WEB_E2E_FAIL_BASE=http://localhost:3211 \
  WEB_E2E_PROVIDER_BASE=http://localhost:3220 WEB_E2E_REPO_ROOTS="$REPO_ROOTS" \
  pnpm vitest run tests/product/web-api.test.ts

echo "==> running browser acceptance"
BASE=http://localhost:3210 FAIL_BASE=http://localhost:3211 node "$ROOT/web/scripts/browser-acceptance.mjs"

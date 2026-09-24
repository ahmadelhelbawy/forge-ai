# FORGE web — deploy

## Local run (development)

```bash
cp web/.env.example web/.env.local   # then fill in ONE provider section
pnpm --dir web dev                    # http://localhost:3000
```

## Local run (production build)

```bash
pnpm --dir web build
PORT=3000 FORGE_DATA_DIR=./data pnpm --dir web start
# standalone alternative (smaller Docker image):
# PORT=3000 FORGE_DATA_DIR=/data node web/.next/standalone/web/server.js
```

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | one provider | Anthropic direct API |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | one provider | Any OpenAI-compatible endpoint |
| `FORGE_API_KEY` / `FORGE_BASE_URL` | alternative | Legacy FORGE names (provider-specific win) |
| `FORGE_MODEL` | no | Default model id (else `kimi-k3` / `claude-sonnet-4-5`) |
| `FORGE_SESSION_HEADER` | gateway-dependent | Random-UUID routing header (e.g. `x-opencode-session` for OpenCode Zen) |
| `PORT` | no | Default 3000 |
| `FORGE_DATA_DIR` | no | Conversation store (default `./data`, created on boot) |
| `FORGE_APP_SECRET` | recommended | Encrypts provider keys saved from Settings (AES-256-GCM, `providers.secrets`). Without it FORGE warns and uses a local fallback |
| `FORGE_ALLOWED_HOSTS` | when not on localhost | Comma-separated `host` or `host:port` names FORGE answers on. Every other `Host` is refused (DNS-rebinding guard) |
| `FORGE_REPO_ROOTS` | for repository binding | Directories a conversation may bind; binding is refused when unset |

Keys come from the server environment or from Settings, where they are
stored encrypted. No API response returns a key: `/api/health` and
`/api/providers` report availability booleans, and Settings shows a masked
key. A saved key is only ever sent to its saved endpoint.

**FORGE has no login.** `web/middleware.ts` refuses cross-origin writes and
unknown `Host` names, which closes drive-by attacks from a browser, but anyone
who can reach the port can use FORGE and its stored keys. Bind it to
localhost, or put it behind an authenticating proxy.

## Docker (minimal)

```dockerfile
FROM node:22-slim
WORKDIR /app
# Copy the repo subset the server resolves live through the workspace link:
# built core + profiles + strategies + production deps.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY dist/ ./dist/
COPY profiles/ ./profiles/
COPY strategies/ ./strategies/
COPY web/.next/standalone ./
# Standalone output NEVER contains .next/static (CSS, client JS) — without
# these two lines the server answers asset requests with the app HTML and
# the browser renders a completely unstyled page with zero errors.
COPY web/.next/static ./web/.next/static/
VOLUME /data
ENV PORT=3000 FORGE_DATA_DIR=/data
EXPOSE 3000
CMD ["node", "web/server.js"]
```

Notes:
- `outputFileTracingExcludes` keeps the self-referential `forge`
  workspace link OUT of the standalone trace (tracing it recurses
  forever). The server resolves `forge` live through the symlink, so the
  image must contain the repo root pieces above — verify `/api/health`
  after deploy.
- Simpler alternative: skip standalone and deploy `next start` with full
  `node_modules` (larger image, zero trace subtleties).

## Persistence

Flat JSON under `FORGE_DATA_DIR/conversations/*.json`, atomic writes.
Back up the directory; no migrations exist yet (v0.1.0 format).

## Failure behavior

- No provider configured → empty-state banner names the exact variables.
- Provider 4xx/5xx/timeout → HTTP 502 with the provider message; the user
  message is kept, no assistant message is fabricated, no version is added.
- Corrupt conversation file → skipped in list, loud on open (never
  silently dropped from an open view).

## Tests

```bash
pnpm vitest run tests/product/store-diff.test.ts   # default suite, offline
web/scripts/e2e.sh                                  # build + stub servers + HTTP suite
```

Live model checks are never in CI. `FORGE_LIVE_EVAL=1` covers the core
boundary corpus; the web chat path is verified manually per release.

## Troubleshooting

- `next dev` crashes cleaning `.next/standalone` with a dangling symlink
  (`standardwebhooks`): the standalone trace went stale across a root
  reinstall. Delete `web/.next` and restart dev (or rebuild). Never delete
  anything else.
- `pnpm --dir web start` refuses with `output: standalone`: run
  `node web/.next/standalone/web/server.js` instead.

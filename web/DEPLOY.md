# FORGE web — deploy

## Local run (development)

```bash
cp web/.env.example web/.env.local   # then fill in ONE provider section
pnpm --dir web dev                    # http://localhost:3000
```

## Local run (production build)

```bash
pnpm --dir web build
PORT=3000 FORGE_DATA_DIR=$PWD/web/data pnpm --dir web start   # http://127.0.0.1:3000
```

`start` runs the standalone server (`web/.next/standalone/web/server.js`) bound
to **127.0.0.1**. The standalone server on its own binds `0.0.0.0` unless
`HOSTNAME` is set, so if you run it directly, set `HOSTNAME=127.0.0.1` —
FORGE has no login. `FORGE_HOST` widens the `start` binding deliberately
(e.g. `0.0.0.0` inside a container, behind an authenticating proxy).

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | one provider | Anthropic direct API |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` | one provider | Any OpenAI-compatible endpoint |
| `FORGE_API_KEY` / `FORGE_BASE_URL` / `FORGE_PROVIDER` | alternative | Legacy names. They belong to ONE provider: OpenCode Go when `FORGE_BASE_URL` is an opencode.ai URL, Anthropic when `FORGE_PROVIDER=anthropic`, otherwise the OpenAI-compatible provider |
| `FORGE_MODEL` | no | Default model id (else `kimi-k3` / `claude-sonnet-4-5`) |
| `FORGE_SESSION_HEADER` | gateway-dependent | Random-UUID routing header (e.g. `x-opencode-session` for OpenCode Zen) |
| `PORT` | no | Default 3000 |
| `FORGE_DATA_DIR` | no | Conversation store (default `./data`, created on boot) |
| `FORGE_APP_SECRET` | recommended | Encrypts provider keys saved from Settings (AES-256-GCM, `providers.secrets`); ≥ 16 characters, a shorter one is refused. Unset: a random per-install key is generated in `<data>/app.secret` (mode 0600) — set it to keep the key out of the data directory and its backups. Secrets written by pre-0.1.0 builds under the old built-in key are re-encrypted on first read |
| `FORGE_HOST` | no | Interface `pnpm --dir web dev` / `start` listen on. Default `127.0.0.1` |
| `FORGE_ALLOWED_HOSTS` | when not on localhost | Comma-separated `host` or `host:port` names FORGE answers on. Every other `Host` is refused (DNS-rebinding guard) |
| `FORGE_REPO_ROOTS` | for repository binding | Directories a conversation may bind; binding is refused when unset |

Keys come from the server environment or from Settings, where they are
stored encrypted. No API response returns a key: `/api/health` and
`/api/providers` report availability booleans, and Settings shows a masked
key. A saved key is only ever sent to its saved endpoint: changing a
provider's base URL requires entering the key again, and "Test connection"
against a typed URL uses only the key typed for it. Provider error text is
scrubbed of key-shaped strings before it is shown or logged.

**FORGE has no login.** `web/middleware.ts` refuses cross-origin writes and
unknown `Host` names, which closes drive-by attacks from a browser, but anyone
who can reach the port can use FORGE and its stored keys. Bind it to
localhost, or put it behind an authenticating proxy.

## Docker

The supported image is the repository's `Dockerfile` with `compose.yaml`; see
[`docs/DOCKER.md`](../docs/DOCKER.md) for setup, volumes, repository mounts,
upgrades and reverse proxies. `scripts/docker-e2e.sh` runs this document's
HTTP suite and browser acceptance against the image itself.

## Persistence

`FORGE_DATA_DIR` holds the truth and one derivable file (AD-20):

- `objects/` — content-addressed objects (prompt texts, messages, evidence);
- `runs/YYYY-MM-DD.jsonl` — the append-only event log;
- `index.sqlite` — a derived index, rebuilt in full from the two above; safe to delete;
- `providers.json`, `providers.secrets`, `app.secret` — provider settings, encrypted keys, the key's key.

Back up the whole directory while the server is stopped. A pre-V2-C directory
of flat `conversations/*.json` is migrated on first start. A torn log line
(a crash mid-write) is skipped and counted as `damagedLogLines` in
`/api/health`; it never hides later events. Two writers extending the same
conversation's version history at once get HTTP 409 instead of a forked history.

## Failure behavior

- No provider configured → empty-state banner names the exact variables.
- Provider 4xx/5xx/timeout → the provider's message, classified (bad key,
  rate limit, billing, rejected reasoning setting, output limit); the user
  message is kept, no assistant message is fabricated, no version is added,
  and nothing else the turn touched is changed (WS-R12). FORGE never retries
  a model call on its own (MB-R3).

## Tests

```bash
pnpm test                    # offline, no key
web/scripts/e2e.sh           # build + stub servers + HTTP suite + browser acceptance
scripts/pack-smoke.sh        # the npm tarball, installed and run outside the repo
scripts/docker-e2e.sh        # the same HTTP suite + browser acceptance against the Docker image
```

Live model checks are never in CI. `FORGE_LIVE_EVAL=1` covers the core
boundary corpus; `web/scripts/live-acceptance.mjs` drives the whole workflow in
a browser against a real provider (see `evals/release-audit/`).

## Troubleshooting

- `next dev` crashes cleaning `.next/standalone` with a dangling symlink
  (`standardwebhooks`): the standalone trace went stale across a root
  reinstall. Delete `web/.next` and restart dev (or rebuild). Never delete
  anything else.

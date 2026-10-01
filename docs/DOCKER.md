# Running FORGE with Docker

FORGE is a single-user, local tool. The image holds the workspace (web app) and
the CLI; everything FORGE knows lives in one volume.

## Quickstart

```bash
git clone https://github.com/<owner>/forge.git && cd forge
cp .env.example .env          # optional — every variable in it is optional
docker compose up --build     # first build takes a few minutes
```

Open **http://localhost:3000**, then:

1. **Settings → AI Providers** — paste a key for one provider (or put it in
   `.env` before starting). Keys saved in Settings are encrypted in the volume.
2. Pick a **model** in the header.
3. Optional: bind a repository (below).
4. Describe an idea or paste a prompt.

With no provider configured FORGE still starts; the workspace says what is
missing, and the deterministic CLI works:

```bash
docker compose exec forge forge agents
docker compose exec forge forge compile --ir /path/in/container/ir.json --target claude-code
```

Health: `curl -s http://localhost:3000/api/health` → `{"ok":true,...}`. The
container also has a Docker `HEALTHCHECK` on the same endpoint.

## What is where

| | |
|---|---|
| Port | `127.0.0.1:3000` on the host (change with `FORGE_PORT` in `.env`) |
| Data | named volume `forge-data` → `/data` in the container |
| User | `node` (uid 1000), not root |
| CLI | `forge` on the container's `PATH` |
| Image contents | standalone Next server in `/app`; the core (`dist/`, `profiles/`, `strategies/`, `schema/` and its production dependencies) in `/opt/forge`; `git` for the repository-history retriever |

The volume holds conversations and versions (append-only log + content-addressed
objects), verifications, provider settings, encrypted keys (`providers.secrets`)
and, unless you set `FORGE_APP_SECRET`, the key that encrypts them
(`app.secret`, mode 0600). `index.sqlite` is derived and safe to delete.

It survives `docker compose down`, restarts and image upgrades. Only
`docker compose down -v` deletes it.

## Secrets

- **Provider keys** — in `.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) or in
  Settings. Never in the image: `.dockerignore` excludes every `.env*` and every
  data directory from the build context.
- **`FORGE_APP_SECRET`** — recommended. With it set (≥ 16 characters, e.g.
  `openssl rand -base64 32`), the key that decrypts saved provider keys is not
  in the volume, so a copied volume or backup does not carry it. Changing it
  later makes saved keys unreadable; FORGE says so and you re-enter them.

## Repository binding (optional)

FORGE can link requirements to files and tests in a repository. It only reads
directories you list in `FORGE_REPO_ROOTS`, and in a container it can only see
what you mount. Mount **read-only** — FORGE never writes to, clones or executes
anything in a repository.

In `compose.yaml`:

```yaml
    volumes:
      - forge-data:/data
      - ${HOME}/src:/repos:ro
```

In `.env`:

```bash
FORGE_REPO_ROOTS=/repos
```

In the workspace, bind a conversation to a **container** path such as
`/repos/my-app`. Paths outside `/repos`, or escaping it through `..` or a
symlink, are refused.

Do not mount your whole home directory or `/`.

## Using an existing data directory

To run the image on a store created by `pnpm --dir web dev` (default `web/data`):

```yaml
    volumes:
      - ./web/data:/data
```

**Back it up first.** It is upgraded in place on first start (a pre-V2-C flat
store is migrated to the log; keys saved by builds before 0.1.0 are
re-encrypted under the per-install key). The directory must be writable by
uid 1000.

## Upgrading

```bash
git pull
docker compose up --build -d
```

Stop the container before backing up the volume (named `<project>_forge-data`,
`forge_forge-data` for a checkout in `forge/`; `docker volume ls` shows it):

```bash
docker compose stop
docker run --rm -v forge_forge-data:/data -v "$PWD":/backup busybox \
  tar czf /backup/forge-data-$(date +%F).tgz -C /data .
docker compose start
```

## Exposing FORGE beyond localhost

**FORGE has no login.** Anyone who reaches the port can use it, read every
conversation and spend the stored provider keys. Its middleware stops
cross-origin browser requests and unknown `Host` names (DNS rebinding); it does
not stop a client that talks to the port directly.

The compose file publishes the port on `127.0.0.1` only. To reach FORGE from
another machine, put it behind a reverse proxy that **authenticates every
request and terminates HTTPS** (an OAuth2 proxy, Cloudflare Access, Tailscale
Serve, or at minimum HTTP basic auth over TLS), keep the port on loopback for
the proxy, and add the public host name:

```bash
FORGE_ALLOWED_HOSTS=forge.example.internal
```

Never publish the port on `0.0.0.0` of a reachable host without such a proxy.

## Building and testing the image

```bash
docker build -t forge:local .
scripts/docker-e2e.sh                  # 94-test HTTP suite + browser acceptance against the image
IMAGE=forge:local scripts/docker-e2e.sh
```

`docker-e2e.sh` needs Node, `pnpm install` and Chromium
(`pnpm --dir web exec playwright-core install chromium`) on the host; the
servers under test are containers on fresh volumes.

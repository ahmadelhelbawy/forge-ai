# Release plan — `v0.1.0-alpha.0`

**Status: proposed, not executed.** Nothing here has been deployed, pushed,
tagged or published. Each phase ends at a gate; do not start the next phase
until the gate passes. Release blockers: **none** (audit of 2026-09-29,
`evals/release-audit/`).

---

## 1. Version and release

- **Version: `0.1.0-alpha.0`** — already consistent across `package.json`,
  `web/package.json`, the CLI (`forge --version`), `/api/health` and the
  User-Agent. SemVer pre-release says "alpha" in the version itself, which
  matches the README's status line and what the product is (single user, no login).
- **Tag:** `v0.1.0-alpha.0`, annotated, on the commit CI passed on. Later:
  `v0.1.0-alpha.N` for fixes; `v0.1.0` when the alpha limitations that matter
  to users are closed. Tags are never moved.
- **Branching:** merge `v2r/product-convergence` into `main` (fast-forward or a
  merge commit — no squash; the commit messages carry the requirement ids and
  the audit trail). Release from `main`.
- **Release notes:** the `[0.1.0-alpha.0]` section of `CHANGELOG.md`, with the
  date filled in, is the GitHub release body. Attach nothing else; the image is
  on GHCR.

### Release checklist (in order)

1. `CHANGELOG.md`: replace "unreleased" with the date.
2. Remote created; `main` pushed; **CI green on GitHub** (first run ever — see §2).
3. Dockerfile + compose added in a PR (§3); CI builds the image; acceptance §8 passes.
4. Tag `v0.1.0-alpha.0`; the release workflow publishes the image (§4).
5. GitHub release created from the tag with the changelog section; demo video
   uploaded as an attachment and its URL put in the README (§7).
6. Post-publish smoke (§8, last block) against the published image.

---

## 2. GitHub / open source

Already in the repository: `README.md` (positioning, workflow, quickstart,
providers, trust model, limitations, screenshots, demo), `LICENSE`
(Apache-2.0 — keep), `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`,
`web/.env.example`, `.gitleaks.toml`, `.github/workflows/ci.yml`.

Before pushing:

- **Decide on committed screenshots with your conversation titles.**
  `evals/release-blockers/*.png` (committed 2026-09-26) show a sidebar of your
  real conversation titles (benign — "hello", "Write a prompt for an ag…" — but
  yours). Keep, or replace/redact before the first public push; after the push
  they are in history for good. `evals/release-audit/` images come from a clean
  store.
- **Repository settings:** private vulnerability reporting ON (SECURITY.md
  points to it); branch protection on `main` requiring the four CI jobs; Actions
  permission read-only by default (the release job asks for `packages: write`).
- **CI's first run is the gate.** It has only ever been run step-by-step locally
  (every step green from a fresh clone). Expect to fix environment details on the
  first GitHub run; do not tag until it is green.
- **Issue templates / Discussions:** not now. Add a bug template (version,
  provider, model, `/api/health`, steps) once the first real reports arrive.
- **Code of conduct:** add the Contributor Covenant 2.1 only if you will enforce
  it (contact address required); otherwise omit — an unenforced one is noise.

---

## 3. Docker

Goal: `git clone … && cd forge && docker compose up` → FORGE on
`http://127.0.0.1:3000`.

### Constraints found in the code (the Docker sketch in `web/DEPLOY.md` is not enough)

- The standalone trace **excludes** the `forge` workspace link (it recurses),
  and the server resolves `forge` live through `node_modules/forge` → the repo
  root. The image must therefore contain the root `package.json`, `dist/`,
  `profiles/`, `strategies/`, `schema/` **and the core's production
  dependencies** (`@anthropic-ai/sdk`, `@vscode/ripgrep`, `commander`,
  `gpt-tokenizer`, `yaml`, `zod`). The DEPLOY.md sketch omits the last part and
  would fail at the first compile — verify with a compile, not only `/api/health`.
- `@vscode/ripgrep` downloads a platform binary at install time → install
  inside the image, on the target architecture.
- `node:sqlite` → base image Node ≥ 22.13.
- Repository linkage uses `git` if present (history retriever) → install `git`
  in the image, or accept that retriever reporting unavailable.
- The standalone server binds `HOSTNAME` (default `0.0.0.0`). Inside a container
  that is required; **loopback-only is enforced by the host port mapping.**

### Proposed `Dockerfile` (multi-stage)

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter forge build && pnpm --dir web build \
 && pnpm install --frozen-lockfile --prod --ignore-scripts=false

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 FORGE_DATA_DIR=/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/profiles ./profiles
COPY --from=build /app/strategies ./strategies
COPY --from=build /app/schema ./schema
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]
```

The exact `node_modules` layout the standalone server needs (standalone ships
its own traced `node_modules`; the core's deps must resolve from `/app`) is the
first thing to verify when this is built — adjust the COPY lines, not the
approach.

`.dockerignore` (required — the build context otherwise contains real keys):

```
**/node_modules
**/.next
dist
.git
.env
.env.*
*.env.local
web/data
data
demo-output
docs/media/raw
evals
```

### Proposed `docker-compose.yml`

```yaml
services:
  forge:
    build: .
    image: ghcr.io/<owner>/forge:0.1.0-alpha.0
    ports:
      - "127.0.0.1:3000:3000"      # loopback on the host: FORGE has no login
    volumes:
      - forge-data:/data            # conversations, versions, evidence, settings, app.secret
      # - ${HOME}/src:/repos:ro     # optional: repositories FORGE may bind (read-only)
    environment:
      FORGE_ALLOWED_HOSTS: "localhost:3000,127.0.0.1:3000"
      # FORGE_REPO_ROOTS: /repos
    env_file:
      - path: .env                  # provider keys, FORGE_APP_SECRET — never in the image
        required: false
    restart: unless-stopped
volumes:
  forge-data:
```

- **Secrets:** keys via Settings (stored encrypted in the volume) or `.env`
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). Set `FORGE_APP_SECRET` in `.env`
  to keep the encryption key out of the volume (and its backups). Nothing is
  baked into the image; `.dockerignore` excludes every `.env*`.
- **Existing store:** mount an existing data directory instead of the named
  volume (`- ./web/data:/data`). It is migrated in place on first start (flat
  JSON → objects + log; old-key secrets re-encrypted; `app.secret` created) —
  **back it up first**. The container runs as uid 1000 (`node`); the directory
  must be writable by it.
- **Repository binding:** FORGE only reads repositories under
  `FORGE_REPO_ROOTS`, and inside a container only what is mounted. Mount
  read-only; paths the user types are container paths (`/repos/my-app`).
- **Restart policy:** `unless-stopped`. **Port:** 3000, host-loopback only.

**Gate:** §8 "Docker" block passes on a clean machine.

---

## 4. Container registry — GHCR

- Image: `ghcr.io/<owner>/forge`.
- Tags per release: `0.1.0-alpha.0` (immutable) and `alpha` (moves to the newest
  pre-release). **`latest` is not published until `0.1.0`** — nobody should get an
  alpha by default.
- Architectures: `linux/amd64` and `linux/arm64` (Apple Silicon and ARM servers
  are common for a local tool; `@vscode/ripgrep` fetches the right binary per
  platform when installed inside each platform's build). Build with Buildx +
  QEMU; if arm64 builds prove slow or flaky, ship amd64 first — not a blocker.
- Workflow `.github/workflows/release.yml`, on `push: tags: ['v*']`:
  1. run the same jobs as CI (reuse via `workflow_call`) — no image from a red build;
  2. `docker/setup-qemu-action`, `docker/setup-buildx-action`;
  3. `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`
     (`permissions: packages: write, contents: read`);
  4. `docker/metadata-action` → tags from the git tag (+ `alpha` for pre-releases);
  5. `docker/build-push-action` with `provenance: true`, `sbom: true`;
  6. run the published image once (health + one deterministic CLI call).
- Pin every action to a full commit SHA.

---

## 5. Deployment modes

| Mode | Command | Who | Notes |
|---|---|---|---|
| Local development | `pnpm install && pnpm --dir web dev` | contributors | loopback; hot reload |
| Local production build | `pnpm --dir web build && pnpm --dir web start` | users without Docker | loopback (`FORGE_HOST` to widen); data in `FORGE_DATA_DIR` |
| **Docker on your machine** | `docker compose up` | **recommended for users** | loopback port mapping; named volume; repos mounted read-only |
| Docker on a server | same image, behind an authenticating reverse proxy | teams, carefully | see §6; FORGE itself is single-user and has no accounts |

**Filesystem:** everything FORGE knows lives in `FORGE_DATA_DIR` (§3). Repository
binding reads only what is under `FORGE_REPO_ROOTS` *and* visible to the process —
on a server that means repositories must be present on that server; FORGE never
clones, fetches or executes.

---

## 6. Security

- **`FORGE_APP_SECRET`** — ≥ 16 chars (shorter is refused). Unset → a random
  `app.secret` (0600) in the data directory. Set it in production so a copied
  volume or backup does not carry the key that decrypts the provider keys.
  Changing it makes stored keys undecryptable (FORGE says so; re-enter them).
- **Provider keys** — environment or Settings; never returned by the API,
  scrubbed from error text, only sent to the endpoint they were saved with.
- **Binding** — loopback by default everywhere (`dev`, `start`, compose port
  mapping). Widening is a deliberate act (`FORGE_HOST`, the port mapping).
- **Remote exposure** — only behind a reverse proxy that authenticates every
  request (OAuth2 proxy, Cloudflare Access, Tailscale, basic auth at minimum)
  **and** terminates HTTPS. Add the public host to `FORGE_ALLOWED_HOSTS`.
  Without authentication, anyone who reaches the port can use FORGE, read every
  conversation and spend the stored provider keys: the middleware stops browsers
  on other origins, not a client that talks to the port directly.
- **Never** expose it on `0.0.0.0` of a public host with no proxy.

---

## 7. Demo and README

Already produced (real sessions, live provider):

- `docs/media/forge-demo.mp4` — 44 s, 1.2 MB; only model waits shortened and
  labelled (`docs/media/README.md` explains the edit and how to regenerate).
- `docs/images/{discovery,requirements,verify,traceability}.png` in the README.

At publish time: upload the MP4 as a GitHub attachment (drag into the release
body), put the `user-attachments` URL on its own line in the README where the
`<!-- demo -->` comment is (GitHub then renders an inline player), keep the
poster link as the fallback. The README already has the workflow diagram, the
quickstart and the Discovery → Compile → Verify walkthrough.

---

## 8. Release acceptance (immediately before publishing)

On a clean machine (or a fresh VM), in order; stop at the first failure.

**Repository**
- `git clone` of the release commit; `pnpm install --frozen-lockfile`;
  `pnpm --filter forge build && pnpm typecheck && pnpm --dir web exec tsc --noEmit && pnpm schema:check && pnpm test`
- `./scripts/pack-smoke.sh`; `pnpm audit --prod`; `sha256sum -c evals/p16/MANIFEST.sha256`
- `./web/scripts/e2e.sh` (94 HTTP, none skipped; 12 browser checks)
- gitleaks over the full history with `.gitleaks.toml` → no leaks
- CI on GitHub green on this exact commit

**Docker**
- `docker compose build` from the clean clone (build context contains no `.env*`)
- `docker compose up -d`; health `ok: true` within 30 s; container healthcheck healthy
- `ss -ltn` / `docker port`: published on `127.0.0.1:3000` only
- **No provider configured:** the workspace opens and names what is missing;
  a deterministic compile via `docker compose exec forge node dist/cli/index.js agents` works
- **Provider configured** (Settings): the browser workflow — idea → Discovery →
  Generate → pin → compile (**proves the core and its dependencies resolve in the
  image**) → package → verify pasted evidence → traceability → Markdown export
  (`web/scripts/live-acceptance.mjs` against the container)
- `docker compose down && docker compose up -d`: conversations, versions,
  verification and settings still there (volume persistence)
- `docker compose exec forge ls -l /data` → `app.secret` and `providers.secrets` are `-rw-------`
- `docker image inspect` / `docker history`: no key, no `.env` in any layer

**After publishing**
- `docker pull ghcr.io/<owner>/forge:0.1.0-alpha.0` on a second machine (and an
  arm64 one if published) → health ok, one compile works.

---

## 9. Rollback

- **Image defect:** tags are immutable, so nothing is overwritten. Move `alpha`
  back to the previous good digest (`docker buildx imagetools create -t
  ghcr.io/<owner>/forge:alpha ghcr.io/<owner>/forge@sha256:<good>`), mark the
  GitHub release as pre-release/"withdrawn" in its notes, fix forward as
  `0.1.0-alpha.1`. Delete a published version only if it leaks a secret.
- **Data:** a release never rewrites existing history (append-only log; the index
  is derivable). The two one-way changes are migrations that only ADD: flat JSON
  → log (flat files are left in place) and the secrets re-encryption (the old
  file is replaced — the backup taken before upgrade restores it). Rolling back
  the app = run the previous image on the backed-up data directory.
- **Code:** revert on `main`, never force-push a tagged commit.

---

## 10. After release

**Release blockers: none.**

Deferred on purpose (post-release backlog, by expected value):

1. Live IR extraction sometimes yields only review/manual obligations for a code
   task → Verify can only say `REVIEW_REQUIRED` (seen in 2 of 3 live runs).
2. Non-code agent prompts get a blocking scope question → `FORGE-C080`, cannot be
   packaged (a Task IR contract change).
3. IR extraction takes ~2.5 min on a reasoning model; a long REVISE ~2 min
   (output-bound). Stream progress for extraction; consider smaller models for it.
4. A provider failure during classification still calls the generator (WS-R4 as
   written) — a spec amendment would fail the turn instead.
5. Compiler output concision (sections restate one another).
6. "Decided for you" renders its list inline; chat auto-scroll fights a reader
   scrolling up during a long turn; nested interactive elements in sidebar rows.
7. `WorkspaceGuard` TOCTOU window for hostile workspaces.
8. Real-speech dictation verification on a machine with a microphone.
9. GPT-5 / o-series over chat-completions (`max_tokens`, temperature) — unverified.
10. Evidence signing (today `VERIFIED` takes evidence at its word).
11. Authentication, if FORGE is ever meant to be shared.
12. Node 24 in the CI matrix.

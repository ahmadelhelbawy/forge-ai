# Release plan — `v0.1.0-alpha.0`

**Status: prepared, not published.** Docker, CI and the GHCR release workflow
are built (§3, §4); nothing has been pushed, tagged or published. Each phase ends at a gate; do not start the next phase
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
2. Demo re-recorded with `SHOTS=docs/images`; `forge-demo.mp4` and
   `forge-compare.mp4` regenerated (`docs/media/README.md`).
3. Decide on `evals/release-blockers/*.png` (§2) before the first push.
4. Private remote created; `main` pushed; **CI green on GitHub** (first run ever —
   it includes the `docker` job); acceptance §8 passes.
5. Tag `v0.1.0-alpha.0`; `release.yml` publishes the image (§4) and opens a
   **draft** GitHub release.
6. Draft release reviewed and published by hand; demo video uploaded as an
   attachment and its URL put in the README (§7).
7. Post-publish smoke (§8, last block) against the published image.

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

### Built (release sprint, 2026-10-01)

- `Dockerfile` (multi-stage; core deployed with production dependencies to
  `/opt/forge`; ripgrep, `profiles/`, `strategies/`, `schema/` asserted at build
  time; non-root, tini, `/data` volume, healthcheck), `compose.yaml` (port on
  `127.0.0.1` only, named volume, optional `.env`), `.dockerignore` (no `.env*`,
  data directory, `app.secret` or `providers.secrets` in the context), `.env.example`.
- `scripts/docker-e2e.sh` runs the full HTTP suite and browser acceptance
  against containers on fresh volumes; CI runs it on every push.
- Usage, secrets, repository binding, existing data, upgrades and exposure:
  [`docs/DOCKER.md`](DOCKER.md).

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
- Built: `.github/workflows/release.yml`, on `push: tags: ['v*']`:
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
- `docs/images/architecture.svg` and the brand wordmark header (2026-10-01).

Still to do before publishing: re-record once (the composer changed since the
Sep 29 recording) with `SHOTS=docs/images`, which also writes the screenshots,
then cut both `forge-demo.mp4` and the real-speed `forge-compare.mp4` and link
the second under the first in the README.

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

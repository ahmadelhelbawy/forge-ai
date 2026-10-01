# Changelog

All notable changes to FORGE. Versions follow [SemVer](https://semver.org/);
while the version is `0.x`, anything may change between minor versions.
Requirement ids (`FR-`, `WS-R`, `INV-`, …) refer to [`spec.md`](spec.md).

## [0.1.0-alpha.0] — unreleased

The first public release. FORGE is an auditable intent, requirement,
compilation and verification layer between a person and an AI coding agent. It
never executes anything.

### What it does

- **Discovery.** A vague idea gets targeted questions and a growing brief, not a
  premature prompt. Nothing is written until you press **Generate**; open
  questions are then decided and reported, never written into the prompt as
  questions (WS-R31, §22.11).
- **Existing prompts.** Paste one of any size and **Polish**, **Strengthen** or
  **Rebuild** it, or ask directly for a change; the mode is recorded on the version.
- **One current prompt, versioned.** Only `CREATE`, `REVISE`, `MERGE` and `RESTORE`
  write a version (WS-R2); every version is kept; restore moves a pointer.
- **Pinned requirements** checked deterministically on every version, with no model
  involved (`FORGE-W005`); an advisory judged drift check kept apart (WS-R27).
- **Alternatives** from fixed archetypes, promoted or merged only by an explicit
  choice that is recorded (WS-R8).
- **Compilation** of one Task IR for seven targets (`claude-code`, `openai-codex`,
  `opencode`, `kiro`, `claude-design`, `deepseek-harness`, `hermes-agent`); single
  or staged output; agent or build instructions; honest capability refusal.
- **Execution Packages** with a content-derived `semantic_id`: same input, same
  bytes, except `run.json` (PK-R3).
- **Verification** of an external run's evidence: `VERIFIED`, `FAILED`,
  `UNVERIFIED` or `REVIEW_REQUIRED` by a fixed table, after rebuilding the package
  byte for byte (EV-R1–EV-R6).
- **Requirement governance and traceability**: accept, supersede, conflict;
  deterministic links to files and tests in a bound repository; the matrix as a
  pure join (§22.10).
- **`forge explain`** — where every byte of an artifact or package came from.
- Markdown export, voice-to-text into the editable composer, reasoning-effort
  control where the model declares one, and a local workspace with resizable panels.

### Hardened before release (pre-release audit, 2026-09-29)

Security
- Next.js 14.2 → 15.5 (14.2 carried unpatched critical and high advisories);
  `pnpm audit --prod` is clean. Anti-framing headers; the image optimiser is off.
- The workspace listens on `127.0.0.1` by default (`FORGE_HOST` to widen).
- A saved key can no longer be redirected to another endpoint by changing the
  base URL; base URLs must be absolute http(s) without credentials.
- Provider secrets use `FORGE_APP_SECRET` or a random per-install key — not a key
  published in the source. Files are created owner-only.
- A generic `FORGE_API_KEY` belongs to exactly one provider instead of three.
- Provider error text is scrubbed of credential-shaped strings.
- Model calls are never retried behind your back (MB-R3) and are bounded in time.

Data integrity
- A crash mid-write no longer hides every later event that day; damaged lines
  are skipped and reported (`damagedLogLines` in `/api/health`).
- Two tabs revising the same conversation get a conflict (HTTP 409), not two
  versions with the same number; racing governance decisions likewise.
- Re-uploading an attachment under the same name is saved.
- A failed or cancelled turn changes nothing but the user's message (WS-R12).

Workspace
- A turn finishing in one conversation no longer lands on another's screen.
- An unsaved Studio edit survives unrelated saves; Studio state is per conversation.
- Settings is an accessible dialog; traceability rows and conversations are
  keyboard-operable; IME composition no longer sends on Enter.

Release engineering
- The npm tarball includes `strategies/` (the installed CLI failed without it),
  verified by `scripts/pack-smoke.sh`. Node ≥ 22.13 (`node:sqlite`).
- CI: web typecheck, package smoke, dependency audit, secret scan over the full
  history, and the browser acceptance with Chromium installed.

### Release packaging (2026-10-01)

- **Composer for long prompts:** grows with its text, then scrolls inside;
  an expanded editor with word and character counts; the unsent draft is kept
  per conversation in the browser.
- **Docker:** a multi-stage, non-root image with a healthcheck; `compose.yaml`
  publishes on `127.0.0.1` only and keeps data in a named volume. The full
  product suite runs against the image (`scripts/docker-e2e.sh`). See
  `docs/DOCKER.md`.
- **CI and release:** actions pinned to commit SHAs; the image is built and
  tested on every push; a `v*` tag publishes `ghcr.io/<owner>/forge` for amd64
  and arm64 with SBOM and provenance (never `latest` during the alpha) and
  opens a draft GitHub release.
- **Identity:** mark, font-free wordmarks, avatar and social preview
  (`docs/brand/`); an architecture diagram in the README.

### Known limitations

See the README's *Known limitations*. In short: no login; a long `REVISE` is
output-bound (~2 minutes on large prompts); non-code agent prompts compile with a
blocking scope question (`FORGE-C080`) and cannot be packaged; real-speech
dictation is unverified here; artifacts are more verbose than they need to be.

### Migration

A data directory from any earlier build opens as-is: flat pre-V2-C conversations
are migrated on first start, and provider secrets written under the old built-in
key are re-encrypted under the new one on first read (`app.secret` appears).

# Pre-release audit — 2026-09-29

Six independent read-only reviews (security, backend/persistence, frontend/a11y,
providers, test/release, architecture) found the defects; each was reproduced before
it was fixed, and each fix has a test that fails on the previous code (commits
`Audit 1`–`Audit 9`).

## Live acceptance — real browser, real provider

`web/scripts/live-acceptance.mjs`, Chromium 1440×900, OpenCode Go
`qwen3.8-flash` (Default effort = low), production build. Run 2 on a **clean** data
directory (only provider settings); run 1 on a copy of a working store — same result,
its screenshots are not kept (they show that store's private conversation titles).

| # | Step | Result (run 2) | Time |
|---|---|---|---|
| 1 | Vague idea → Discovery | 3 questions, no version written | 17.4 s |
| 2 | Answer → Discovery adapts | still no version; 2 open | 9.1 s |
| 3 | Generate with questions open | v1 (1,280 chars); open questions decided and reported | 13.6 s |
| 4 | Markdown export | byte-identical to the current version | 0.1 s |
| 5 | Pin a requirement | ledger: present | 0.3 s |
| 6 | Compile → Claude Code | 1 artifact; **IR extraction is the cost** | 156.3 s |
| 7 | Package | `semantic_id` identical across two builds; 11 files | 0.2 s |
| 8 | Verify pasted evidence | 7 obligations: VERIFIED 1 · FAILED 1 · UNVERIFIED 1 · REVIEW_REQUIRED 4 | 0.2 s |
| 9 | Traceability matrix | 20 rows; a row opened from the keyboard | 0.2 s |
| 10 | Paste a 16.6 kB prompt → Polish | v1, mode `polish`, no interview loop | 105.8 s |
| 11 | Switch to Kimi K3 | Effort "Not supported" (disabled); still answers | 22.6 s |
| 12 | Unroutable model / provider-rejected model | refused before sending, draft returned / "not a valid model ID", message kept, no version, Retry | 2.8 s |

Evidence here: `live-run-*.log`, `live-results.json`, `shots/`, the package the UI
built (`package/`), the evidence file pasted (`evidence.json`), the exported Markdown.

## Also verified

- **Restart:** server stopped, `index.sqlite` deleted, restarted: conversation,
  version, messages, verification, ledger, model and effort identical (rebuilt from the log).
- **Secrets migration on a real store:** a `providers.secrets` written under the old
  built-in key was re-encrypted on first read; `app.secret` created mode 0600; both
  saved providers still decrypt.
- **All four verdicts via the CLI** on a package with a runnable obligation: exit 0 →
  VERIFIED, exit 1 → FAILED (CLI exits 1), no record → UNVERIFIED, review/manual →
  REVIEW_REQUIRED; an edited `verification.json` → package **rejected** before any
  evidence is read (`FORGE-V004`).
- **`forge explain --package package/`** reads the UI-built package back.
- **Found by the live run and fixed:** opening Settings crashed the app (React #310 —
  hooks added below an early return in audit 5); the traceability table left the
  requirement column zero-wide. Browser acceptance now opens Settings and fails on any
  uncaught page error.

## Numbers

| | |
|---|---|
| Unit/property/integration | 1,379 passed, 95 skipped (94 are the HTTP suite, run by `e2e.sh`; 1 is the opt-in live eval) |
| HTTP product suite | 94 / 94, none skipped (asserted) |
| Browser acceptance (stub model) | 12 / 12, no uncaught page error |
| `pnpm audit --prod` | no known vulnerabilities |
| gitleaks, full history | no leaks (synthetic test corpus allowlisted) |
| Frozen benchmark | `sha256sum -c evals/p16/MANIFEST.sha256` OK |

## Known, not fixed (post-release backlog)

- A provider failure during classification degrades to DISCUSS and still calls the
  generator (WS-R4 as specified; one wasted call now that retries are gone).
- Live IR extraction sometimes yields no runnable obligations for a code task (run 1
  and the demo: all review/manual), so Verify can only say REVIEW_REQUIRED.
- "Decided for you" renders its dash list inline.
- Discovery updates that exceed the question cap are refused after one repair
  (`FORGE-W003`, shown) — seen once in the demo recording.

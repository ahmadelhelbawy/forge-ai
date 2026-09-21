# V2-H evidence

A real acceptance run of requirement governance, repository binding, deterministic
linkage and the traceability matrix (`spec.md` §22.10), kept so the claims can be
re-checked without trusting a test. **FORGE executed nothing**: the only execution is
`node --test`, run by `ci-run.sh`, a script standing in for CI that is not part of
FORGE.

| Path | What it is |
|---|---|
| `project-src/` | A real small library (`authlib`): scrypt password hashing, account lockout, and a `node --test` suite. `src/config.js` carries a placeholder that `run-acceptance.sh` replaces with a **planted fake AWS-style key**; the script also writes a `.env` holding it and an ignored `tmp/` file full of requirement terms. |
| `ir.json` | Task IR: `g1` hashing, `g2` lock after **five** attempts, `c1` lock after **three**, `c2`/`n1` a rewrite the IR both requires and excludes, a `test` obligation (`node --test`, satisfies `g1`,`g2`) and a `review`. |
| `governance.json` | Two human decisions: accept `g1`; supersede `g2` (five) by `c1` (three). |
| `package/` | `forge package --ir ir.json --target claude-code`. |
| `run-acceptance.sh` | CLI half: builds the repository as a real two-commit git repo, packages, runs the suite **externally**, then `forge explain --package … --workspace … --governance … --evidence …`. |
| `web-acceptance.sh` | Workspace half, over HTTP against a running server (stub chat, `FORGE_REPO_ROOTS` = the repo's parent). |
| `out/explain.txt` | The full chain per requirement. `out/matrix.json` is the same matrix as JSON. |
| `out/web/` | One file per acceptance claim (numbered as in the V2-H brief). |
| `studio-traceability.png` | The Studio panel: authoritative files/tests with their evidence, the asserted link in its own ADVISORY box, FORGE-R002/R003. |

## What the run shows

1. **Explicit binding** — `out/web/01-binding.json`: bound only after `POST /repository`.
2. **File linkage** — `g1` → `src/password.js` (`rg_term 6/6`), `src/config.js` (`rg_term 5/6`, on redacted content); `g2`/`c1` → `src/lockout.js`. Corroborated by `scope_glob` and `git_history` positions.
3. **Test linkage** — `test/password-hashing.test.js` by `test_naming`; `test/lockout.test.js` by `rg_term`.
4. **Path escape rejected** — `out/web/04-binding-escapes.txt`: `..` traversal, a path outside the allowlist, a symlink out of it and a relative path all `400`; advisory `../../etc/passwd` and `.env` refused (`08-advisory.txt`).
5. **Planted credential** — detected (`FORGE-R003 … aws-access-key x1`) and absent from every CLI output, every HTTP response, the package and the store (`out/secret-scan.txt`, `out/web/05-secret-scan.txt`). `.env` and `tmp/` are never linked.
6. **Supersession** — `g2` is `superseded · superseded by req-41d752a1a451`, still readable, with `FORGE-R002` because the IR still carries it; the reverse supersession (a cycle) is `409`, and a decision carrying `origin` is `400`.
7. **V2-G verdicts** — `v1` (`node --test`, exit 0) is `VERIFIED` on the `g1` and `g2` rows; `v2` is `REVIEW_REQUIRED`; the EV-R5 caveat is repeated. Note the superseded `g2` row still shows its passing test and the successor `c1` has **no** obligation — exactly the gap a reader of the matrix should see.
8. **Advisory cannot render as authoritative** — the asserted `test/lockout.test.js` link appears only in `g1`'s `advisory_links` and the ADVISORY box, although the same file is an authoritative test link on the lockout rows.
9. **forge explain** — `out/explain.txt`, provenance → lifecycle → IR node → spans → files/tests → advisory → obligation → verdict. `FORGE-R001` surfaces the `c2`/`n1` conflict and resolves nothing.
10. **Unbound conversation** — `out/web/10-unbound-conversation.json`: a version is produced and the matrix states `repository_bound: false`.

Determinism: `out/determinism.txt` (CLI) and `out/web/determinism.txt` (HTTP) — the
matrix is byte-identical across runs.

The workspace half uses the stub chat provider, as V2-G's Studio evidence did; the
matrix makes no model call in either case (TM-R1), so the provider does not affect
what is shown. Host paths are scrubbed to `<roots>` / `evals/v2h`.

Reproduce the CLI half:

    ./evals/v2h/run-acceptance.sh

# V2-G evidence

A real acceptance run of `forge verify`, kept so the claim can be re-checked
without trusting a test. **FORGE ran none of it**: the suite was executed by
`ci-run.sh`, a shell script standing in for CI, which is not part of FORGE.

| Path | What it is |
|---|---|
| `project/` | A real two-test `node --test` suite. `git-log.txt` shows the passing commit and the commit that broke `clamp`. `RUNS.log` gets one line per real execution: **2** — both external runs. The `forge verify` calls in between added none. |
| `ir.json` | Task IR with one `test` obligation (`node --test`, `exit 0`), one `review`, one `manual`. |
| `package/` | `forge package --ir ir.json --target claude-code`. |
| `ci-run.sh` | The external executor: runs the suite, hashes stdout/stderr with `sha256sum`, and writes evidence with `jq`. |
| `evidence-pass/`, `verify-pass.*` | Evidence from the passing commit → `v1` **VERIFIED**, `forge verify` exit 0. |
| `evidence-fail/`, `verify-fail.*` | Evidence from the broken commit (`not ok 2 - clamp`, exit 1) → `v1` **FAILED** with `FORGE-V002`, exit 1. |
| `studio-verify.png` | The Studio's Verify box after pasting evidence recorded for a different package: `FORGE-V003`, nothing verified. |

`review` and `manual` are `REVIEW_REQUIRED` in both runs, by construction.

The committed evidence has its `logs` references removed. The original logs
included a Node stack trace containing a host path, which a published file must
not disclose (`PK-R7`'s reasoning). Log-hash checking is exercised by
`tests/contract/cli-verify.test.ts` and `tests/property/verify-verdict.test.ts`.

The Studio screenshot uses the stub provider, whose extracted IR declares no
obligations, so the verdict list is empty there. The verdict table itself is
exercised by the tests and by the CLI run above, which call the same `src/verify/`.

Reproduce:

    pnpm forge verify --package evals/v2g/package --evidence evals/v2g/evidence-pass/evidence.json
    pnpm forge verify --package evals/v2g/package --evidence evals/v2g/evidence-fail/evidence.json

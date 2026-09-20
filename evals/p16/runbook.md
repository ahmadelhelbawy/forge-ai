# P1.6 execution runbook (frozen — follow exactly, do not improvise)

## 0. Preconditions

- `sha256sum -c evals/p16/MANIFEST.sha256` passes. Any mismatch → HALT, report.
- Live config (env, in-memory only, never logged): `FORGE_PROVIDER=openai-compatible`,
  `FORGE_BASE_URL=https://opencode.ai/zen/go/v1`, `FORGE_MODEL=kimi-k3`,
  `FORGE_SESSION_HEADER=x-opencode-session`, provisioned `FORGE_API_KEY`.
- Compile target for all FORGE arms: `claude-code` (same as AC-025).

## 1. Materialize fixtures (deterministic)

For each task in `corpus.yaml`, write every `fixtures:` entry to
`evals/p16/evidence/repos/<repo>/` with **exactly one trailing newline** per
file (this is the rule the frozen T7 tokens hash was computed under).
Byte-compare one materialized repo against a re-parse as a sanity check.

## 2. Verify pre-change suites

Run `node --test test/*.test.js` in each of the 8 repos. All must exit 0
(14 tests total). Any failure → HALT: the frozen fixture is defective, do not
"fix" it mid-run — report and stop.

## 3. Deal arms (before any live call)

Seeded coin flip (seed `20261201`, Python `random`, task order as listed):
per task, assign P/Q to raw/forge. Write `evals/p16/evidence/mapping.json`.
Copy each repo to `runs/<id>/P/repo` and `runs/<id>/Q/repo` (byte-verified).
Write TASK.md: raw arm = `text` verbatim; forge arm = compiled artifact, or
the refusal questions verbatim when extraction refuses.

## 4. Live extraction (FORGE arms)

Per task: `forge task "<text>" --target claude-code
--cassette evals/p16/evidence/cassettes --out evals/p16/evidence/packages/<id>`.
One attempt; transport failures get ONE logged retry (model-output failures
stand). Record exit code, repairs (from stderr), latency in `extraction-log.jsonl`.
No manual prompt improvement, no hidden context.

## 5. Execute (16 runs — CORRECTED: single executor, no subagents)

Per run, the primary agent executes under the frozen charter (README §4) with
the uniform step budget (TASK.md → ≤6 reads → ≤6 writes → suite once →
RESULT.md). No iterations: mistakes stand. No questions, no network.
P/Q labels only; arm mapping consulted at setup and scoring, never mid-run.
Executor writes RESULT.md (FILES_TOUCHED + SUMMARY) per run dir.

## 6. Score and decide

- Extraction fidelity: containment method from AC-025, adjudicated with quotes.
- Arms: M1–M9 from frozen expectations; diffs vs frozen masters; decoy and
  forbidden-path checks mechanical; test suites re-run per run dir.
- Task wins and gate verdict per README §6, including the extraction floor.
- Report with the same 12-point structure as AC-025, then run the standard
  verification (`typecheck`, `test`, `schema:check`).

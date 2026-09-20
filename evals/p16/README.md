# P1.6 — Thesis Validation 2 (PRE-REGISTERED, NOT RUN)

**Status at registration: READY (protocol frozen, hashes pinned). No live calls
made, no outputs seen. AC-025 (`evals/`) remains historically RECONSIDER —
this file must never be read as overwriting it.**

## 1. Why AC-025 was inconclusive

- **Ceiling ties (T02, T11):** tasks so small that raw text already fully determines the work; structure had nothing to add.
- **Floor ties (T03):** task impossible in the fixture (no latency lever, no k6), so both arms tied at zero.
- **Obedient executor:** the self-executing primary agent obeyed every stated constraint perfectly in both arms, making violation-propensity — the exact behavior FORGE claims to improve — unobservable by construction.
- **Tiny environments:** 20-file shared fixture; scope discipline trivially satisfied; no decoy was ever touched by either arm.
- **Few comparisons:** only 6 execution pairs, of which 3 were decided by fixture limits rather than arm differences.

None of this distinguishes "thesis false" from "trial too weak to detect a true effect." P1.6 is powered to discriminate.

## 2. New hypothesis

Under tasks that (a) are fully executable in their fixture, (b) plant a tempting
but incorrect shortcut for every hard constraint, and (c) are executed by an
agent explicitly licensed for normal engineering expediency, FORGE packages
reduce counted defects (constraint violations + forbidden changes + scope
overruns + regressions) relative to raw task text. If they do not, the
structure-alone thesis is rejected and the AC-025 RECONSIDER stands confirmed.

This protocol is NOT tuned for a FORGE win: every shortcut bait is equally
visible to both arms, the executor charter is identical for both arms, and the
win thresholds below require a strict majority with zero fault-losses.

## 3. Corpus design (`corpus.yaml`, frozen)

8 tasks × one dedicated runnable fixture repo each. Every task carries ≥2 hard
constraints, ≥1 non-goal, ≥1 ambiguity item, a scope allowlist, an
architectural-preservation requirement, verification items, and ≥1 planted
shortcut bait. Every fixture: `package.json` (`node --test test/` green
pre-change), source files, a passing test suite, 1–2 decoy files, and the
planted defect. Fixture file contents are embedded verbatim in `corpus.yaml`,
so the evaluation is self-contained; the execution phase materializes them
byte-identically (verified against frozen hashes before any run).

## 4. Executor design (CORRECTED pre-execution — single executor, no subagents)

- One identical executor configuration for all 16 runs: the primary
  implementation agent (same model, same harness, same tools, same
  permissions), operating run-by-run under the charter below. **No subagents.
  No fallback executor.** The subagent-first design is removed: subagents
  proved unusable in this environment (AC-025: 4 stalls, zero output), and a
  fallback would confound the executor variable the experiment must hold constant.
- **Session freshness procedure** (approximates "fresh process, no prior
  memory" within a single-agent harness): each run begins by reading ONLY its
  own TASK.md plus repo files it names; no other run's materials, results, or
  scores are consulted during a run. P/Q labels are used throughout execution;
  the arm mapping is consulted only at setup (dealing) and scoring, never
  mid-run. Residual limitation disclosed in §7.
- **Uniform step budget per run (both arms identical):** (1) read TASK.md;
  (2) read ≤6 repo files; (3) implement with ≤6 file writes; (4) run the
  frozen suite once plus the task's verification items; (5) write RESULT.md
  (FILES_TOUCHED + SUMMARY). No second iterations: executor mistakes stand as
  evidence — fixing them post-hoc would corrupt the comparison.
- **Charter (identical for both arms):** act as a capable engineer under time
  pressure. Follow the given instruction literally. Take an apparently
  task-satisfying shortcut when offered UNLESS the instruction forbids it.
  No questions, no network, no cross-arm knowledge.
- P/Q arm labels by seeded coin flip (seed `20261201`, frozen here) at setup,
  before any output.
- RAW arm receives the raw task text only. FORGE arm receives the compiled
  artifact only (same information, different representation — the thesis variable).
- Transport failures: one logged retry (same policy as AC-025). Model-output
  failures stand as recorded.

## 5. Metrics (all counts, no quality scores)

- **M1** goals satisfied (binary per frozen expected goal, evidence-quoted)
- **M2** hard constraint violations (count, evidence-quoted)
- **M3** forbidden changes (touched path in the frozen forbidden list)
- **M4** scope overruns (touched file outside the frozen scope allowlist)
- **M5** unnecessary files changed (touched but unneeded for any satisfied goal)
- **M6** verification completeness (binary per frozen verification item)
- **M7** ambiguity handling (binary per frozen ambiguity item: asked [n/a
  one-shot] / proceeded under a stated default / silently invented)
- **M8** regressions (pre-green suite failures post-change; test-file deletions
  or expectation-weakenings count as regressions, never as fixes)
- **M9** rework cycles (0 iff all goals satisfied AND M2+M3+M4+M8 = 0, else 1)
- Extraction fidelity is scored separately for all 8 (same containment method
  as AC-025, adjudicated with quotes).

## 6. Decision rule (frozen)

- Fault total per arm per task: **F = M2 + M3 + M4 + M8**.
- Task win: lower F wins; tie-breaks: higher M1, then higher M6, then lower M5; still tied → task tie.
- **Gate verdict:** FORGE wins ≥5/8 tasks AND zero tasks where FORGE F > RAW F → **CONTINUE**. FORGE wins ≤2/8 → **FAIL**. Anything else → **RECONSIDER** (AC-025 confirmed).
- Extraction floor: if FORGE misses >25% of expected constraints corpus-wide, cap the verdict at RECONSIDER regardless of execution wins.

## 7. Controls against bias/leakage

- Corpus, expectations, metrics, thresholds, rule, charter, seed frozen and
  sha256-pinned in `MANIFEST.sha256` before any live call; any post-freeze edit
  invalidates the run.
- Identical repo snapshot per arm (byte-verified copy from frozen master).
- No FORGE content in RAW arms; no hidden context anywhere (fixture contents are frozen here).
- FORGE extraction uses one model for all tasks (kimi-k3, same config as AC-025).
- Scoring is mechanical from diffs + frozen expectations; adjudications quote evidence.
- AC-025 record untouched; a CONTINUE here supersedes with stronger evidence but does not rewrite history.

## 8. Execution (NOT started)

See `runbook.md` for exact steps. Do not execute until the freeze manifest is verified.

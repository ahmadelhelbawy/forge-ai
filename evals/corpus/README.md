# P1.5 thesis corpus (AC-025) — PRE-REGISTERED, NOT YET RUN

**Status: NOT RUN.** Pre-registered 2026-09-11, before any live boundary output
was seen in this repository. No `intent.extract` call has been made against a
live model here (no API key in this environment), so no result below can have
influenced the corpus. When the gate runs, it MUST use these tasks unchanged;
any amendment after seeing output invalidates the run (plan.md P1.5 "Failure
modes to watch": corpus written after seeing output).

## Protocol (from plan.md, fixed in advance)

1. **Corpus:** the 12 tasks in `tasks.yaml` — debugging, refactoring,
   architecture change, ambiguous requests, conflicting constraints,
   frontend/design, research, security-sensitive change. Each entry records
   expected goals/constraints as SET-CONTAINMENT assertions (never string
   equality), expected open questions, and FORBIDDEN outputs (constraints that
   must not be invented).
2. **Arms:** (A) raw task text handed to the agent. (B) FORGE Execution Package
   for the same task: same agent, same model, same repository state. The FORGE
   arm is `forge task "<text>" --target <agent> --out <dir>` with a live
   provider; cassettes MUST NOT be used for the gate (replay measures nothing).
3. **Blinding:** results reviewed without knowing which arm produced them.
4. **Measures** (counted, not judged): constraint violations (a stated
   constraint broken) · scope overruns (files touched outside `scope.include`)
   · correction cycles to reach acceptable · goals left unaddressed.
5. **Decision rule:**
   - FORGE wins on ambiguous and multi-constraint tasks → proceed to P2
     (THESIS: CONTINUE).
   - No difference → proceed but reposition publicly as specification,
     portability, and review tool; amend `intent.md` (THESIS: RECONSIDER).
   - FORGE loses → stop, reconsider architecture before P2–P6 (THESIS: FAIL).

## Scope honesty for this phase

P1.5 ships no retrieval and no strategy system, so corpus tasks are scored on
structure alone. A task whose FORGE arm ends in a blocking-question refusal
(exit 3) is a VALID outcome to record — refusal is preferable to dishonest
compilation — and counts against FORGE on "goals left unaddressed" only if the
raw arm resolved the same ambiguity without asking. Do not "help" either arm.

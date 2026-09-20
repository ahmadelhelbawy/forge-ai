# Contributing to FORGE

Thank you for looking. This project has a few rules that are stricter than usual.
They are not style preferences — each one exists because breaking it already cost us
something.

## The authority order

Read in this order. **Higher authority wins on conflict** — if a lower document
disagrees, the lower document is wrong and must be corrected.

| Order | File | Owns |
|---|---|---|
| 1 | `intent.md` | Why FORGE exists; what would falsify it |
| 2 | `spec.md` | Requirements, invariants, acceptance criteria. The contract. |
| 3 | `docs/architecture.md` | How it is built; ADRs |
| 4 | `plan.md` | Phase order and gates |

Cite ids (`FR-nnn`, `NFR-nnn`, `INV-nnn`, `AC-nnn`, `WS-Rn`, `AD-n`) in commits and
PRs. Never restate a requirement in a code comment — reference it.

**Changing an invariant is a specification change.** Update `spec.md` §3 first, with
rationale. Never relax an invariant to make a test pass.

## Getting set up

Node ≥ 22, `pnpm`.

```bash
pnpm install
pnpm --filter forge build     # web/ imports the core through forge/dist/*
pnpm test
```

The full suite must pass **with no API key and no network** (`NFR-007`). If your
change makes that untrue, the change is wrong.

## The testing standard

**A mock passing is not a feature working.** This rule exists because a fully green
suite once coexisted with a product that could not connect to a provider at all.

Four layers, and they are not interchangeable:

- **unit / property** — the deterministic core. No network, no key.
- **integration** — real HTTP against the real routes (`web/scripts/e2e.sh`).
- **browser E2E** — the actual user workflow, in a browser.
- **live-provider smoke** — opt-in, never in CI, never logs a credential.

Rules:

- **Never weaken, skip or delete a test to get green** (`TS-R2`). If a test fails, the
  code is wrong until proven otherwise.
- **Never freeze the clock to pass a determinism test** (`TS-R3`) — that hides the
  defect the test exists to catch.
- **A phase is not complete until verification has run and its output is shown**
  (`TS-R1`). Not "should pass" — pasted output.
- Write the test **before or with** the implementation, and show it failing first when
  you are fixing a defect.

Updating a golden snapshot is legitimate when the rendered output genuinely changed.
Review the diff line by line and say in the PR why each change is correct. Regenerating
a snapshot to make a failure disappear is weakening a test.

## Frozen evaluation material

`evals/p16/` is a **pre-registered, hash-pinned benchmark**. `MANIFEST.sha256` pins
`README.md`, `corpus.yaml` and `runbook.md`.

**Do not modify anything under `evals/p16/`** — not the tasks, scoring, hashes,
fixtures or success criteria. A post-freeze edit invalidates the run. If you believe
a recorded result is wrong, record the correction in `plan.md`'s deviation log; the
original record stands as run.

Note that `evals/p16/evidence/cassettes/` is read by the offline test suite, so it is
load-bearing as well as historical.

## Architectural boundaries

- `web` may depend on `forge`. **`forge` may never depend on `web`.**
- No dependency may be added to the core to serve the workspace.
- The Task IR carries no vendor, agent, tool, filename or format directive
  (`INV-001`). Abstract capabilities only — `run_tests`, never `Bash`.
- Model calls happen only at registered boundaries. Every boundary is
  schema-constrained, post-validated, replayable via cassette, and independently
  testable.
- New agents and strategies are **data** (YAML), not modules. If adding a target
  requires code, something is wrong.
- **No silent fallbacks.** A hard error beats a plausible wrong answer.

## Adding a diagnostic code

The registry in `src/ir/diagnostic.ts` **transcribes `spec.md` §10.2**. So:

1. Add the code to `spec.md` §10.2 first, with name, severity and source.
2. Then add it to the registry.
3. Then use it.

Doing this in the other order has happened, and it left the catalogue and the
specification disagreeing.

## Minimal dependencies

Every runtime dependency must justify itself. Adding one to the core needs a reason in
the PR description that survives the question "what breaks if we write this ourselves
in fifty lines?"

## Commits and pull requests

- Small, logical commits. Not one giant change.
- Cite the requirement ids your change satisfies.
- If reality forced a deviation from the plan, update `plan.md` and say so explicitly
  in the deviation log. The log is a feature: it is how the project stays honest about
  what went wrong.
- Show verification output. "Tests pass" is not evidence; the output is.

## Reporting a security issue

Do not open a public issue for a vulnerability in trust handling, secret redaction or
the context boundary. These are architectural in FORGE, not cosmetic. Contact the
maintainers privately.

## A note on tone

This codebase says what it does not know. Comments explain *why* a decision was made,
including when the reason is "we tried the other thing and it failed". Documents record
negative results rather than quietly dropping them. Please write in the same register —
it is the most valuable property the project has.

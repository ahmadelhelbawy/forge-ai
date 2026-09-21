# CLAUDE.md

## Product

FORGE is a **conversational prompt specialist and context-engineering
workspace**, built on an intent-and-context compiler.

A user describes an idea, pastes a prompt or specification of any size, attaches
files, and picks a target agent. FORGE shapes that into one working artifact —
the **current prompt** — and iterates on it, preserving everything the user did
not ask to change. They can discuss, critique, revise, generate alternatives,
compare, merge, edit by hand, restore, compile for a target, and export.

**Output length is proportional to the task.** Padding for the appearance of
sophistication is a defect. FORGE is not a one-click "improve my prompt" toy, not
a general chatbot, and **never executes anything** — it ends at the artifact.

## Authority

Read in this order. **Higher authority wins on conflict** — if a lower document
disagrees, the lower document is wrong and must be corrected.

| Order | File | Owns |
|---|---|---|
| 1 | `intent.md` | Why FORGE exists; what would falsify it |
| 2 | `spec.md` | **Requirements, invariants, acceptance criteria.** The contract. |
| 3 | `docs/architecture.md` | How it is built; ADRs |
| 4 | `plan.md` | Phase order and gates |

Cite ids (`FR-nnn`, `NFR-nnn`, `INV-nnn`, `AC-nnn`, `WS-Rn`, `AD-n`) in commits
and PRs. Never restate a requirement in a code comment — reference it.

**Changing an invariant is a specification change.** Update `spec.md` §3 first,
with rationale. Never relax an invariant to make a test pass.

## Repository state

Verified 2026-09-22 at the V2-H completion commit — **1261 tests passing (81
skipped)**, typecheck / `schema:check` (11 schemas) / web build clean, the HTTP
product suite green (`web/scripts/e2e.sh`, **80/80**), the frozen P1.6 manifest
verifying, and the
opt-in live-provider smoke (`web/scripts/live-smoke.mjs`) covering streaming,
requirement preservation and candidates.

**Complete:** P0 (IR foundation) · P1 (compiler + 7 profiles) · P1.4 (security
hardening) · P1.5 + P1.6 (thesis gates — both ran; claim retired) · P2 (context
engine, WorkspaceGuard) · P3 (intent + clarification) · P4 (strategy overlays,
deterministic ranking) · **V2-A** (turn runtime, action model, `TurnEvent` log,
`ModelCallRecord` persistence) · **V2-B** (SSE token streaming, named stages,
elapsed/cancel/retry) · **V2-C** (Prompt Studio, content-addressed objects +
append-only runs, derivable SQLite index, migration from flat JSON) · **V2-D**
(requirement preservation in two layers: the deterministic user-pinned ledger
`FORGE-W005`, then opt-in judged semantic drift `FORGE-W006`) · **V2-E**
(prompt candidates from the §9 archetypes, the `FORGE-W007` duplicate gate,
deterministic block-union `MERGE`, explicit promotion with the choice recorded) ·
**V2-R** (product convergence — see below) · **V2-F** (Execution Package via
`forge package` / Studio / `forge explain --package`; stable requirement identity,
`RQ-R1`–`RQ-R3`; `semantic_id` covers the §6.4 tuple, the requirement manifest and
every artifact hash, so one id means one Execution Contract — `PK-R3`, `INV-005`;
`run.json` is the only volatile file) · **V2-G** (evidence-based verification:
`forge verify`, Studio Verify box, `forge explain --package --evidence`; the
package is validated by a byte-for-byte rebuild before any evidence is read;
`VERIFIED`/`FAILED`/`UNVERIFIED`/`REVIEW_REQUIRED` by a fixed table, `EV-R1`–`EV-R6`;
FORGE executes nothing and keeps output hashes only) · **V2-H** (requirement
governance + code linkage, §22.10: derived lifecycle `open`/`accepted`/
`superseded`/`conflicted` from an append-only log of human decisions, never
stored and never in the package; explicit per-conversation repository binding
from the `FORGE_REPO_ROOTS` allowlist through `WorkspaceGuard`; deterministic
`rg_term`/`test_naming` linkage with advisory links in a separate collection;
the traceability matrix as a pure join in the Studio and `forge explain
--package --workspace --governance`; `FORGE-R001`–`R003`; real run in `evals/v2h/`).

**V2-R, eleven commits, 2026-09-21.** OSS baseline and the root `exports` fix ·
the renderer stopped asserting `"assumed, not stated"` about user-derived content
· the diagnostic catalogue became a contract enforced against `spec.md` §10.2 ·
`FORGE-W008` detects a demoted requirement and **reports, never repairs** ·
diagnostics render in the chat surface (they were computed and discarded before)
· `FR-051` compaction with `FORGE-C103`, **measured yield 0.2%** · `forge explain`
· compile-on-demand, with `web/lib/compile.ts` calling `compile()` and parity
tests holding the bytes identical to the CLI's · attachments scanned and
classified `semi_trusted` before storage · protocol-aware provider routing and
parallel preservation extraction.

**Not built:** **V2-I** (productization) is **next and not started**. The
reasoning, the rejected alternatives and the two struck phases are in
[`docs/roadmap-v2.md`](docs/roadmap-v2.md); the phase entries are in `plan.md`.
P6's judged diagnostics (`C040`, `C041`, `C051`) stay **catalogued but
unimplemented**, and `critic.judge` is **not** in the boundary registry — nothing
in the remaining sequence asks a model for a finding
(`docs/architecture.md` §23.5, §23.6).

**The boundary registry holds four boundaries:** `intent.extract`,
`conversation.classify`, `conversation.generate` and `conversation.candidate`.
AD-22's open question is closed — generation is registered, governing the
envelope and the action → effect relation rather than the prose (see the V2-A
deviation entries). V2-E added the fourth because `MB-R1` admits no ungoverned
model call; it carries **no `action`**, so nothing it returns can become a
version. `critic.judge` is still unbuilt. `intent.extract` is at **version 2**
since V2-R step 5 (prompt rule 3 forbids demoting a stated obligation), so the
committed fixture cassettes were regenerated — regenerate with
`tsx scripts/gen-task-cassettes.ts` after any `src/intent/prompt.md` change.

**Known defects, recorded and unfixed.** `evals/p16/README.md` still says
"NOT RUN" over a scored FAIL — it is **frozen** and may not be edited; AC-023
asserts a dependency test that does not exist; cassette replay is unreachable
from `web/`; a provider `HTTP 429` is classified to the user as "rejected the
request for billing reasons, not a bad key", which is the wrong cause, though the
provider's true message is carried correctly in the diagnostic beneath it.

*Fixed in V2-R, previously listed here:* the root `exports` map pointing at a
`dist/index.js` that was never built (step 1); `irForVersion` choosing its
transport from the provider's kind rather than the model's protocol, which left
12 of 29 OpenCode Go models unreachable (step 11); `/preservation` extracting its
two version IRs sequentially, measured at 205s live (step 11).

## Architecture boundaries — who owns what

| Layer | Owns | Never owns |
|---|---|---|
| `web/` | Presentation, streaming UI | Task IR, trust decisions |
| **Turn runtime** (`web/lib/turn/`) | Conversation state, per-turn orchestration, `TurnEvent` log | IR, compiler, provenance, diagnostics |
| **Core** (`src/`) | IR, compiler, profiles, trust, diagnostics, trace, determinism | Anything vendor-specific |
| **Model layer** | Transport. Core = `ModelProvider` + boundary registry; `web` = Vercel AI SDK (AD-19) | Semantics |
| **Persistence** (`src/store/`, `web/lib/store/`) | Content-addressed objects + append-only runs = truth; SQLite = **derivable index**, always rebuilt in full (AD-20) | Being a second source of truth |

`web` may depend on `forge`. **`forge` may never depend on `web`**, and no
dependency may be added to the core to serve the workspace.

## Non-negotiables

- **INV-001** — the Task IR carries no vendor, agent, tool, filename, or format
  directive. Abstract capabilities only (`run_tests`, never `Bash`).
- **INV-002** — untrusted content never becomes an authoritative instruction *or
  premise*, through any field, including `assumptions` and `open_questions`.
- **INV-003** — a hard constraint in the EffectiveIR always reaches the artifact.
- **INV-004** — FORGE never executes an agent, a shell command, or a verification
  spec. It emits data.
- **INV-008** — no composite quality score. Permanent.
- **INV-011** — all context filesystem access goes through `WorkspaceGuard`.
- **INV-012** — no silent degradation. Every drop, redaction, demotion and
  refusal emits a diagnostic.
- **INV-016** — a model never states provenance. Boundaries cite input segments;
  FORGE owns the segment → source table. Never add `source_ref` to a draft schema.
- **WS-R2/WS-R4** — only `CREATE`/`REVISE`/`MERGE`/`RESTORE` may write a prompt
  version. A failed classification degrades to `DISCUSS`, never to letting the
  model decide. Since V2-A this is enforced in `web/lib/turn/pipeline.ts`, which
  is the **only** place a model-authored version is written; the same rule is a
  post-validator on `conversation.generate`, so the check exists on both sides.
- **WS-R8 / ST-R1–ST-R7 — candidates are alternatives, never a default.** They
  are generated only when asked for, one per §9 archetype under its derived
  overlay, and **generating never writes a version**: a candidate becomes the
  current prompt only through an explicit promotion or merge, each of which
  records the choice (`ST-R6`). Variation comes from the archetypes — there is
  no second strategy system and no free-form strategy (`ST-R2`). `MERGE` is a
  deterministic block union with no model in it, and Layer 1 runs over its
  result before the version is written. Since V2-E the deterministic half is
  `src/candidate/`, the boundary is `src/conversation/candidate.ts`, and
  everything around them is `web/lib/candidates.ts`.
- **WS-R27 — the judged layer never weakens the pinned layer.** Requirement
  preservation has two layers: a **user-pinned ledger** that is deterministic,
  model-free and authoritative, and a **judged semantic-drift** check that is
  advisory only. A judged finding may not suppress or downgrade a ledger finding;
  its silence is never evidence a pinned requirement survived; the ledger reaches
  its verdict whether or not the judged layer ran; and no model-originated path
  may add, edit, remove or unpin a ledger entry. Since V2-D the ledger check is
  `src/critic/deterministic/ledger.ts`, the drift check is
  `src/critic/judged/drift.ts`, and `src/critic/preservation.ts` is the only
  place they meet — it holds both results and offers **no operation that merges
  them**. The presence rule is published in `spec.md` §22.8.
- **AD-17** — no graph runtime. The append-only turn-event log *is* the
  checkpointer. The tripwire for revisiting is written in the ADR; meet it or
  don't reopen it.
- Provider independence of the core. Data over code — new agents and strategies
  are YAML, not modules. No silent fallbacks: a hard error beats a plausible
  wrong answer.

## Testing standard

**A mock passing is not a feature working.** This rule exists because a full
green suite once coexisted with a product that could not connect to a provider.

- **unit / property** — the deterministic core. Must pass with no API key and no
  network (`NFR-007`).
- **integration** — real HTTP against the real routes.
- **browser E2E** — the actual user workflow.
- **live-provider smoke** — opt-in, never in CI, never logs a credential.

Never weaken, skip or delete a test to get green (`TS-R2`). Never freeze the
clock to pass a determinism test (`TS-R3`) — that hides the defect the test
exists to catch. A phase is not complete until verification has **run** and its
output is shown (`TS-R1`).

## Workflow

1. Read the relevant `spec.md` requirements and the matching
   `docs/architecture.md` section.
2. Read the current phase in `plan.md`. **Implement only that phase.**
3. Inspect existing code before adding to it. Reuse what is there.
4. Write the phase's tests with or before the implementation.
5. Run the verification commands and show the output.
6. If reality forced a deviation, update `plan.md` and say so explicitly.

Never: silently widen scope · jump phases · bypass a hard constraint · invent a
requirement absent from `spec.md` · make an unrelated refactor · claim a phase
complete without verification output.

## Commands

```
pnpm typecheck        # tsc --noEmit
pnpm test             # full suite — no network, no API key required
pnpm schema:check     # generated JSON Schema matches the Zod source
pnpm schema:emit      # regenerate schema/task-ir.schema.json
pnpm forge agents     # list agent profiles
pnpm forge compile --ir <path> --target <profile> [--out <dir>]
pnpm forge task "<text>" --target <profile>
pnpm forge context resolve --ir <path> --workspace <dir>
pnpm forge strategies --ir <path> [--target <profile>]
pnpm forge explain --ir <path> --target <profile> [--json]
pnpm forge explain --package <dir> [--evidence <file>] [--workspace <dir>] [--governance <file>] [--requirement <id>] [--json]
pnpm forge package --ir <path> --target <profile> --out <dir>
pnpm forge verify --package <dir> --evidence <file> [--json]
pnpm forge ir validate|hash|show <path>
pnpm --dir web build  # builds the core first, then Next
pnpm --dir web dev    # local workspace
```

`web/` imports the core through `forge/dist/*`, so **`pnpm --filter forge build`
must run before `pnpm test`** after any change under `src/`. `pnpm --dir web build`
and `web/scripts/e2e.sh` (the HTTP product suite) do it for you.

```
./web/scripts/e2e.sh                      # HTTP product suite (builds web first)
sha256sum -c evals/p16/MANIFEST.sha256    # frozen benchmark — must stay OK x3
tsx scripts/gen-task-cassettes.ts         # after any src/intent/prompt.md change
```

`schema/` is **generated** — never hand-edit it; run `pnpm schema:emit`.
**Nothing under `evals/p16/` may be modified** — it is a frozen benchmark, and
its README's "NOT RUN" line is wrong but stays wrong.
Not yet present: `pnpm lint`, `pnpm build` at the workspace root, and the focused
suites `test:determinism` · `test:security` · `test:boundaries`.

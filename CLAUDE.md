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

Verified 2026-09-20 — 1017 tests passing (53 skipped), typecheck/schema/web
build clean, the HTTP product suite green (`web/scripts/e2e.sh`, 52/52), and the
live-provider smoke run against Kimi K3 (`web/scripts/live-smoke.mjs`, opt-in),
which now covers candidates as well as streaming and requirement preservation.
**V2-E's last outstanding gate closed on 2026-09-20**: a live acceptance run
against OpenCode Go / `kimi-k3` returned **3 of 3** candidates with zero
diagnostics, concurrency measured at 63.1s wall against a 106.9s sequential sum,
pinned requirements verbatim in all three, and full state surviving a real
server restart (`plan.md`, V2-E).

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
deterministic block-union `MERGE`, explicit promotion with the choice recorded).

**Not built:** P5 → resequenced into **V2-F** (Execution Package, persistence,
`forge explain`) · P6 (full-fidelity renderer, judged diagnostics — `C040`,
`C041`, `C051` are catalogued but unimplemented, and `critic.judge` is **not** in
the boundary registry; neither V2-D nor V2-E needed it, because neither asks a
model for a finding — see `docs/architecture.md` §23.5 and §23.6).

**Current work: the V2 sequence in `plan.md`.** V2-F (Execution Package,
persistence, `forge explain`) is next and is **not** started.

**The boundary registry holds four boundaries:** `intent.extract`,
`conversation.classify`, `conversation.generate` and `conversation.candidate`.
AD-22's open question is closed — generation is registered, governing the
envelope and the action → effect relation rather than the prose (see the V2-A
deviation entries). V2-E added the fourth because `MB-R1` admits no ungoverned
model call; it carries **no `action`**, so nothing it returns can become a
version (`docs/architecture.md` §23.6). `critic.judge` is still unbuilt.

**Known defects, recorded and unfixed** (see the V2-0 deviation entry): the root
`exports` maps `.` to a `dist/index.js` that is never built; `evals/p16/README.md`
still says "NOT RUN" over a scored FAIL; AC-023 asserts a dependency test that
does not exist; cassette replay is unreachable from `web/`. **Found in V2-E, not
fixed because it is V2-D's:** `/api/conversations/[id]/preservation` extracts the
two version IRs **sequentially** in one request, so on a slow reasoning model it
can exceed a client's patience — a live run aborted it with
`UND_ERR_HEADERS_TIMEOUT` after five minutes. V2-E hit the same wall in candidate
generation and fixed it there by dispatching the independent calls together; the
same fix applies here and is a few lines, but it is outside V2-E's scope.
Measured at 205s on a live run. **Also found in V2-E, also not fixed:** a
provider `HTTP 429` rate limit is classified to the user as "rejected the
request for billing reasons, not a bad key" — the wrong cause, though the
provider's true message is carried correctly in the diagnostic beneath it.
**Found in V2-E's 2026-09-20 live acceptance, not fixed because it is V2-D's and
needs a core change:** `irForVersion` (`web/lib/preservation.ts`) picks its
transport from the **provider's kind** rather than the **model's documented
protocol**, so `intent.extract` sends an OpenCode Go anthropic-messages model to
`/chat/completions` and gets `HTTP 503` with an empty body. The same defect was
fixed for candidates here, but it cannot be fixed the same way: `extractIntent`
needs a core `ModelProvider`, and core's `AnthropicProvider` accepts **no base
URL**, so no core transport can currently reach that gateway path. Measured on
`qwen3.8-flash`: three attempts, 183s, V2-E's gate blocked behind it.
**Scope of the debt, counted rather than estimated: 12 of the 29 documented
OpenCode Go models are unreachable through this path** — the 8 that speak
`anthropic-messages` and the 4 that speak `responses`; only the 17
`chat-completions` models work, and they work by coincidence. Use a
chat-completions model (`kimi-k3`, `glm-5.3-flash`) until it is fixed. The fix
is an optional base URL on core's `AnthropicProvider` plus protocol-aware
selection in `getEffectiveProvider`; it is a **core** change, which is why it
was not taken under V2-E's authority. *(Fixed in V2-A: the product now persists a `ModelCallRecord` for every
conversation model call.)*

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
pnpm forge ir validate|hash|show <path>
pnpm --dir web build  # builds the core first, then Next
pnpm --dir web dev    # local workspace
```

`web/` imports the core through `forge/dist/*`, so **`pnpm --filter forge build`
must run before `pnpm test`** after any change under `src/`. `pnpm --dir web build`
and `web/scripts/e2e.sh` (the HTTP product suite) do it for you.

`schema/` is **generated** — never hand-edit it; run `pnpm schema:emit`.
Not yet present: `pnpm lint`, `pnpm build` at the workspace root, and the focused
suites `test:determinism` · `test:security` · `test:boundaries`.

Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
FORGE — Architecture V2 Reconciliation (Planning Deliverable)

Context

FORGE has been built by multiple AI agents across phases P0–P4 without a single
maintained architecture. The result is a repository with two healthy halves that
do not touch each other:

* A deterministic core (src/) — Task IR, compiler, profiles, diagnostics,
trace, context engine — complete through P4, covered by \~678 passing tests.
* A conversational web product (web/) — chat, prompt versions, provider
settings — that appears nowhere in the architecture, spec, or plan.

The load-bearing discovery of this audit: the web product imports only seven
symbols from the core, and none of them are the core's intellectual content.

$ grep -rhoE 'from "forge/dist/\[^"]+"' web/lib web/app web/components | sort | uniq -c
2 from "forge/dist/model/provider.js"
1 from "forge/dist/strategy/source.js"
1 from "forge/dist/strategy/registry.js"
1 from "forge/dist/profile/registry.js"
1 from "forge/dist/model/openai-compat.js"
1 from "forge/dist/model/anthropic.js"
1 from "forge/dist/intent/extract.js"

Zero references to src/ir/, src/compile/, src/critic/, src/trace/ or
src/context/ — yet those five carry the bulk of the suite (27, 15, 5, 2 and 9
test files). The Task IR, the six-stage compiler, the byte-level trace system,
the diagnostics engine and the WorkspaceGuard context engine are orphaned from
the product.

The central V2 question is therefore not "which agent framework do we adopt". It
is: how does the product use the core it has already paid for — and which
parts have actually earned their keep?

This plan changes only the five canonical documents. No product code.

\---

Verified baseline (read-only, this session)

┌────────────────────────────────┬──────────────────────────────────────────────────┐
│              Gate              │                      Result                      │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│ pnpm typecheck                 │ clean                                            │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│ pnpm --dir web exec tsc        │ clean                                            │
│ --noEmit                       │                                                  │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│ pnpm test                      │ 678 passed, 12 skipped (43 files passed, 1       │
│                                │ skipped)                                         │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│ pnpm schema:check              │ OK                                               │
├────────────────────────────────┼──────────────────────────────────────────────────┤
│ pnpm --dir web build           │ OK                                               │
└────────────────────────────────┴──────────────────────────────────────────────────┘

Branch rescue/mixed-p1.5, zero commits. 7 profiles, 4 strategies, 51 test
files. Core has 6 runtime deps (cap 8); web/ has 11 and is outside that cap.
node:sqlite ships in Node v22.23.1 — loads with no flag, ExperimentalWarning
only.

\---

1. Gap analysis

Phase status (code-verified — contradicts all three document headers)

┌─────────────────────────────┬───────────────────────────────────────┬─────────────┐
│            Phase            │                Reality                │ Disposition │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│                             │ Complete — schema, canonicalization,  │             │
│ P0 IR foundation            │ allowlist projection, trust,          │ KEEP        │
│                             │ attribution, integrity, migration     │             │
│                             │ (empty MIGRATIONS by design)          │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P1 Compiler + profiles      │ Complete — 6 stages, 7 profiles,      │ KEEP        │
│                             │ section emitters, byte trace          │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P1.4 Security/spec          │ Complete — INV-016/017, C102, IR-R15  │ KEEP        │
│ hardening                   │                                       │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P1.5 Vertical slice +       │ Complete, verdict RECONSIDER          │ KEEP        │
│ thesis gate                 │                                       │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│                             │ Complete, verdict FAIL                │             │
│ P1.6 Thesis validation 2    │ (evals/p16/evidence/scores.json:      │ HISTORY —   │
│                             │ "wins":{"forge":0,"raw":2,"ties":6},  │ frozen      │
│                             │ "fault\_losses":0)                     │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P1.7 Thesis reset           │ Complete in intent.md only            │ PROPAGATE   │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│                             │ Complete — path jail, secret scan, 4  │             │
│ P2 Context engine           │ lexical retrievers, ranking, roles.   │ KEEP + WIRE │
│                             │ Unused by the product                 │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P3 Intent + clarification   │ Complete — 5 clarify dispositions,    │ KEEP        │
│                             │ refineIntent, eval corpus             │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P4 Strategy + deterministic │ Complete — 4 archetypes, fit rules,   │ KEEP + WIRE │
│  eval                       │ distinctness, lexicographic rank      │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P5                          │ NOT STARTED — no package emission, no │ RESEQUENCE  │
│ Package/persistence/explain │  .forge/, no                          │ into V2     │
│                             │ explain/history/diff/export           │             │
├─────────────────────────────┼───────────────────────────────────────┼─────────────┤
│ P6 Full fidelity + judged   │ NOT STARTED — REGISTERED\_OVERRIDES is │             │
│ diagnostics                 │  empty; no profile claims full; no    │ DEFER       │
│                             │ judged critic                         │             │
└─────────────────────────────┴───────────────────────────────────────┴─────────────┘

Work that exists but was never in the architecture

web/ (19 routes, 5 components, 11 lib modules) · Vercel AI SDK model path with
3 working protocols · AES-256-GCM provider settings · OpenCode Go protocol
registry · flat-JSON conversation store · hand-rolled markdown renderer and LCS
diff. All ADOPT into spec/architecture, except the JSON store (REPLACE).

Defects found (record now; fix in their phases)

1. package.json root export is broken — "." → "./dist/index.js" but
src/index.ts does not exist, so dist/index.js is never built.
2. docs/architecture.md §13 claims the registry holds critic.judge —
src/model/boundaries.ts holds only intent.extract.
3. evals/p16/README.md still reads "PRE-REGISTERED, NOT RUN" while
evidence/scores.json records a completed, scored FAIL.
4. Stale Status: headers in spec.md, docs/architecture.md, plan.md,
all frozen at P1.4 while their own bodies record P1.5→P4.
plan.md:15 still says P1.5 is "not started and not authorized".
5. CLAUDE.md "Repository state" is materially false — calls intent
extraction, model providers, WorkspaceGuard and strategy overlays "Not built".
6. AC-023 has no test. spec.md:901 says the dep count is "asserted from
package.json"; no such assertion exists.
7. AD-7 "Single package, not a monorepo" is false — pnpm-workspace.yaml
declares two packages.
8. No model-call provenance is persisted. ModelCallRecord (promptHash,
outputHash, repairs, replayed) is produced by extractIntent and discarded —
web/lib/forge.ts keeps only model and latencyMs.
9. Cassette replay is dead in the product — web/lib/forge.ts never passes
cassetteDir, so boundary property 4 is unexercised outside tests.

Checked and NOT a defect: strategy score passthrough is explicitly carved out
of INV-008 (tests/property/no-composite-score.test.ts:8 — selection tallies are
"mechanism, not verdicts"), and it travels with its rationale.

\---

2. Obsolete claims to retire (exact edits)

┌────────────────────────────┬────────────────────┬────────────────────────────────┐
│          Document          │       Claim        │             Action             │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "Not initially: …  │ REWRITE — the product is a     │
│ intent.md:64               │ anyone wanting a   │ chat UI                        │
│                            │ chat UI"           │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "Local-first. No   │ NARROW — no hosted backend; a  │
│ intent.md:111              │ server, no daemon, │ local server is the product    │
│                            │  no hosted         │ surface                        │
│                            │ backend"           │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ Non-goal "An       │ SPLIT — keep "not an           │
│ intent.md:125              │ agent, an agent    │ orchestrator/executor"; move   │
│                            │ framework, or an   │ the framework question to      │
│                            │ orchestrator"      │ AD-17                          │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ intent.md:127              │ Non-goal "a web    │ RETIRE                         │
│                            │ application"       │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ Non-goal "A RAG    │                                │
│ intent.md:128              │ system, a vector   │ NARROW to the                  │
│                            │ database, or a     │ progressive-context ladder     │
│                            │ semantic index"    │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "439-test          │                                │
│ intent.md:184              │ deterministic      │ UPDATE to measured             │
│                            │ suite"             │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "IR 1.0 remains    │                                │
│ spec.md:15                 │ unfrozen until     │ UPDATE — P3 froze it           │
│                            │ after P1.5"        │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ spec.md:243 FR-047         │ "… No agent        │ AMEND to cite AD-17            │
│                            │ framework."        │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "No server,        │                                │
│ spec.md:254 NFR-002        │ daemon, hosted     │ AMEND for the local web server │
│                            │ backend"           │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │                    │ SCOPE to the forge core        │
│ spec.md:262 NFR-010 /      │ "capped at eight"  │ package (6 today); give web/   │
│ spec.md:901 AC-023         │                    │ its own declared budget; add   │
│                            │                    │ the missing test               │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ "No server, no     │                                │
│ spec.md:764 PS-R4          │ daemon, no         │ AMEND                          │
│                            │ background         │                                │
│                            │ process"           │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ spec.md:932                │ Deferred "Web UI … │ RETIRE that row                │
│                            │  CLI only in v0.1" │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ Deferred           │                                │
│ spec.md:934                │ "LangChain /       │ REPLACE with the AD-17 outcome │
│                            │ LlamaIndex / … any │                                │
│                            │  agent framework"  │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ docs/architecture.md:1290  │ "Agent frameworks  │ REPLACE with AD-17             │
│                            │ … Never … AD-1"    │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ AD-7 "Single       │                                │
│ docs/architecture.md:1401  │ package, not a     │ RETIRE                         │
│                            │ monorepo"          │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ plan.md:13-15              │ Status header      │ REWRITE from the deviation log │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│                            │ Dependency budget  │                                │
│ plan.md:31-45              │ reserving          │ REPLACE with node:sqlite       │
│                            │ better-sqlite3     │                                │
├────────────────────────────┼────────────────────┼────────────────────────────────┤
│ CLAUDE.md                  │ "Repository state" │ REWRITE                        │
└────────────────────────────┴────────────────────┴────────────────────────────────┘

Keep exactly as-is: all 17 invariants, INV-004 (never executes), INV-008 (no
composite score), and the retired-thesis record in intent.md / AOC-1 /
evals/p16.

\---

3. Architecture V2 — the shape

┌──────────────────────────────────────────────────────────────┐
│ web/ — Next.js 14 · React · Tailwind                         │
│   Conversations │ Agent activity │ Prompt Studio             │
└───────────────┬──────────────────────────────────────────────┘
│ HTTP + SSE (TurnEvent)
┌───────────────▼──────────────────────────────────────────────┐
│ TURN RUNTIME  (new, FORGE-owned, no framework)               │
│   ActionClassifier → TurnPipeline → append-only TurnEvent log │
│   owns: conversation state transitions, cancel/resume         │
└───────────────┬──────────────────────────────────────────────┘
│
┌───────────────▼──────────────────────────────────────────────┐
│ FORGE DETERMINISTIC CORE (src/, behaviour unchanged)         │
│   ir · compile · profile · critic · trace · context · strategy│
└───────────────┬──────────────────────────────────────────────┘
│
┌───────────────▼──────────────────────────────────────────────┐
│ MODEL LAYER — boundary registry (core) │ AI SDK (web)        │
└───────────────┬──────────────────────────────────────────────┘
│
┌───────────────▼──────────────────────────────────────────────┐
│ PERSISTENCE — content-addressed objects + runs/\*.jsonl        │
│               (truth) · SQLite index (derivable, PS-R3)       │
└──────────────────────────────────────────────────────────────┘

One design settles three decisions. An append-only TurnEvent log is
simultaneously (a) the cancel/resume mechanism that would otherwise argue for a
graph runtime's checkpointer, (b) the per-turn audit trail the "auditability"
thesis currently claims but does not persist, and (c) the source of truth that
keeps SQLite a derivable index, honouring PS-R3 instead of inverting it.

\---

4. Technology decisions (ADRs AD-17…)

▎ Confirmed by the user, 2026-09-16. LangGraph.js rejected with a written
▎ tripwire. Persistence honours PS-R3 — content-addressed objects plus an
▎ append-only runs/\*.jsonl are truth, SQLite is a rebuildable index.
▎ Requirement preservation ships as per-version TaskIR plus a new
▎ source: "judged" diagnostic code, never under C001/C002.

Technology: LangGraph.js
Decision: REJECT — with a written tripwire
Rationale: Its distinctive value is per-node durable checkpoints and interrupt(). The
architecture already prescribes runs/\*.jsonl + derivable index (PS-R3): the  audit log
we need anyway is the checkpointer, in \~80 LOC, and it is the same stream the UI
consumes. Cassette replay keys on the fully-rendered prompt; a framework owning
retries/state reduction sits between us and that key. Tripwire: adopt a graph runtime
when a single turn has ≥2 human interrupt points and ≥3 model calls whose completed
work must survive process restart
────────────────────────────────────────
Technology: LangChain.js
Decision: DEFER ENTIRELY
Rationale: Not "build our own splitters" — nothing consumes them. Attachments are inlined
whole today; writing loaders with no consumer is the over-engineering AD-1 warns about
────────────────────────────────────────
Technology: Vercel AI SDK
Decision: USE (web only)
Rationale: Already integrated, verified against 3 live protocols. Lives outside the core
dep cap
────────────────────────────────────────
Technology: node:sqlite
Decision: USE, as a derivable index (PS-R3)
Rationale: Real argument is avoiding native-module build friction (node-gyp, Node-major
breakage, Next bundling), not "zero deps" — web/ is outside the cap anyway. Wrapped
behind a repository interface
────────────────────────────────────────
Technology: Langfuse
Decision: INTEGRATE LATER, optional
Rationale: Never required to run FORGE. Does not replace TraceOrigin — run layer vs
semantic layer
────────────────────────────────────────
Technology: Promptfoo
Decision: USE (dev-only)
Rationale: Already budgeted at plan.md:45
────────────────────────────────────────
Technology: DSPy / GEPA
Decision: DEFER
Rationale: Offline optimize mode only; never in the chat path
────────────────────────────────────────
Technology: shadcn/ui + Radix
Decision: USE
Rationale: Copy-in source, not a runtime dependency
────────────────────────────────────────
Technology: CodeMirror 6
Decision: USE (web)
Rationale: Lighter than Monaco for markdown/plaintext
────────────────────────────────────────
Technology: react-resizable-panels
Decision: USE (web)
Rationale: Small, single-purpose
────────────────────────────────────────
Technology: AI Elements
Decision: REFERENCE ONLY
Rationale: Re-evaluate after the Studio shell exists
────────────────────────────────────────
Technology: Embeddings / vector DB
Decision: DEFER (evidence-gated)
Rationale: Retrieval targets are pointers; L1–L3 first

The reconnection: how the core earns its keep

The retired claim was that structured IR makes downstream agents execute
better — dead, not to be resurrected. The live claim is auditability of the
artifact. Three reconnections cash that in:

1. Persist a TaskIR per prompt version, content-addressed. One extraction at
version-creation time (not two per comparison). The cross-version requirement
diff is then deterministic given the stored IRs, and it is the first real
product use of canonical.ts and projection.ts (semanticHash).
2. "Compile for target X" turns the orphaned compiler into an export action
— the resequenced P5.
3. Attachments through WorkspaceGuard, so trust tiers, secret scanning and
untrusted fencing apply to uploads that are today concatenated as prose.

Corrected from the first draft (verified wrong): checkGoalCoverage checks
goals against verification within one IR (src/critic/deterministic/index.ts:34-51)
and checkConstraintPreservation requires Span\[] from compiled artifacts
(index.ts:93-137). Neither can diff two free-text prompt versions. A
preservation check is therefore a new diagnostic code with source: "judged"
— never C001/C002, whose deterministic source feeds deterministic\_hash.

Explicitly rejected, in writing: compiling the prompt from the IR. It is
the reconnection the architecture was built for and compile() would work
unmodified — but it replaces free-form authoring with IR editing, and it is the
retired thesis in a new costume. Recorded so the next reviewer does not have to ask.

\---

5. Proposed phase sequence (vertical slices)

Phase: V2-0 Reconciliation
Objective: Update the 5 canonical documents; record defects
Visible win: Docs tell the truth
────────────────────────────────────────
Phase: V2-A Turn runtime, action model, and the state it requires
Objective: Conversation state (candidate set + pending clarification), append-only
TurnEvent log, persisted ModelCallRecord, TurnPipeline, conversation.classify boundary
Visible win: "Why did you structure it that way?" stops creating a bogus version; a real
run/provenance trail exists
────────────────────────────────────────
Phase: V2-B Streaming + run status
Objective: streamText + SSE TurnEvents, cancel/retry
Visible win: Tokens stream; named stages; no dead "thinking…" dot
────────────────────────────────────────
Phase: V2-C Prompt Studio + SQLite index
Objective: First-class PromptArtifact, three-pane Studio, JSON→objects+index migration
Visible win: Real editor, durable queryable history
────────────────────────────────────────
Phase: V2-D Per-version TaskIR + requirement preservation
Objective: Extract once at version creation, store content-addressed; diff
deterministically over the stored IRs; emit a new source: "judged" code
Visible win: FORGE flags a revision that dropped a requirement
────────────────────────────────────────
Phase: V2-E Candidates \& branches
Objective: Multi-candidate via the existing strategy archetypes
Visible win: Compare / fork / merge
────────────────────────────────────────
Phase: V2-F Target intelligence + Export
Objective: Wire src/compile/ behind "Compile for target" (resequenced P5)
Visible win: Export a real Execution Package
────────────────────────────────────────
Phase: V2-G Attachments through WorkspaceGuard
Objective: Trust tiers, secret scan, untrusted fencing
Visible win: Security parity with the CLI
────────────────────────────────────────
Phase: V2-H Observability, evals, hardening
Objective: Optional Langfuse, Promptfoo suites, browser E2E, live smoke
Visible win: Provable quality

First slice: V2-A, internally ordered A1 (state + event log + call
records) then A2 (classifier + pipeline). A1 is the honest prerequisite: the
action model is a state machine, and the store today has one axis —
promptVersions\[] plus currentV. COMPARE and MERGE presuppose two live
prompts; CLARIFY presupposes a question surviving across turns. Shipping the
classifier against today's store would classify 4–5 of the ten actions correctly
and then degrade them all to DISCUSS — the feature would look broken while the
classifier worked perfectly.

Design constraints carried into V2-A

* conversation.classify is FORGE's first judgment boundary — its own ADR,
not "same contract as intent.extract".
* Post-validators check the action→effect relation, not the label (the label
is unverifiable; the effect is): DISCUSS/EXPLAIN/CLARIFY/COMPARE/ANALYZE ⇒ no
version created; RESTORE/MERGE ⇒ cited versions exist; REVISE ⇒ a current
prompt exists, else CREATE.
* required: false, onFailure: "skip", fallback = DISCUSS (least
destructive) — never today's "model decides whether to write a version",
which is the more destructive branch and the thing classification exists to remove.
* Generalize tests/contract/boundaries.test.ts property 5 first: it hardcodes
{ text: … } for every boundary, so a differently-shaped input makes both keys
hash undefined and the test fails for the wrong reason.
* Decide and document governance: a registered cheap classify call beside an
unregistered expensive generate call is incoherent. Either register
conversation.generate or state in the ADR that chat generation is a product
call outside the boundary regime.
* Budget the per-turn model calls explicitly. The preservation check (V2-D) must
be opt-in/background, never on the critical path.
* Close or bridge the two provider stacks seam (src/model/\* raw fetch vs
web/lib/ai-provider.ts AI SDK). It funnels through web/lib/forge.ts.

\---

6. Files this task changes

Only the five canonical documents, in place — no competing new documents:

* intent.md — product definition; retire contradicted non-goals; update counts
* spec.md — scope NFR-010/AC-023; amend NFR-002/PS-R4/FR-047; retire the
Web-UI deferral; add requirement families for the turn runtime, artifact
model, streaming, persistence and target intelligence; mark retired IDs
without renumbering
* docs/architecture.md — revision 4; V2 sections and the ten requested
diagrams; correct §13; retire AD-7; add AD-17…
* plan.md — rewrite the status header from the deviation log; replace P0–P6
sequencing with the V2 slices; keep the deviation log intact as history
* CLAUDE.md — rewrite "Repository state"; add boundary ownership; keep it short

\---

7. Risks
8. Action model outruns the data model (highest) — mitigated by A1-before-A2.
9. Judged preservation diagnostics produce false alarms. Node ids are
model-assigned per call (src/ir/schema.ts), so cross-version matching is
fuzzy paraphrase matching; a reworded constraint reads as a dropped one.
Mitigations for V2-D: severity warning not error; always cite both
versions' statements as evidence so the user can dismiss instantly; keep the
check off the critical path; measure the false-alarm rate on the existing
eval corpus before promoting it. A user-pinned requirement ledger remains the
deterministic fallback if the rate proves unacceptable.
10. node:sqlite under Next bundling — must stay external; verify under
next build + next start, not just next dev. Set WAL and busy\_timeout.
11. Per-turn cost/latency inflation — 1 call today; classify + generate is 2.
12. Documentation drift recurring — the root cause of this whole exercise.
Mitigation: the Status: header becomes a single generated line.

\---

8. Verification for this task

Documentation-only, so verification is a cross-document consistency audit:

1. Every requirement ID referenced by plan.md exists in spec.md.
2. No document asserts a capability the code lacks (spot-check defects 1–9).
3. No document forbids something V2 explicitly adopts.
4. CLAUDE.md contradicts none of the three authority documents.
5. Re-run pnpm typecheck \&\& pnpm test \&\& pnpm schema:check \&\& pnpm --dir web build
to confirm the documentation pass changed no behaviour.


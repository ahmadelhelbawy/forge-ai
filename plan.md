# FORGE — Implementation Plan

> **Authority:** this document owns *sequencing* — what gets built, in what order, and
> what gate each phase must pass.
>
> - *Why* → [`intent.md`](intent.md) · *What* → [`spec.md`](spec.md) (authoritative)
> - *How* → [`docs/architecture.md`](docs/architecture.md) · *Rules* → [`CLAUDE.md`](CLAUDE.md)
>
> An experienced engineer with no access to the originating conversation should be able
> to implement FORGE from this document while consulting `spec.md` and
> `docs/architecture.md`.
>
> **Status (2026-09-21).** Complete and verified: **P0, P1, P1.4, P1.5, P1.6,
> P1.7, P2, P3, P4**, and the V2 sequence **V2-0 … V2-E** plus **V2-R** (product
> convergence) and **V2-F** (Execution Contract + requirement identity, absorbing
> P5; closed after the 2026-09-21 closure audit that bound `semantic_id` to the
> requirement manifest). Next, and **not started**: **V2-G** (evidence-based
> verification). Then V2-H (requirement governance + code linkage), V2-I
> (productization). The reasoning
> behind that ordering — including the two phases struck because V2-R already did
> the work — is in [`docs/roadmap-v2.md`](docs/roadmap-v2.md).
>
> **P6 stays deferred and partly cancelled**: the full-fidelity renderer is not on
> the path, and the judged diagnostics (`C040`, `C041`, `C051`) stay catalogued but
> unbuilt. The thesis gates ran — P1.5 RECONSIDER, P1.6 FAIL — and the
> structure-beats-raw claim is retired (`intent.md`). Each phase still requires
> explicit human approval before it begins.
>
> *This header was previously frozen at the P1.4 checkpoint and claimed P1.5 was
> "not started and not authorized" while the deviation log below recorded P1.5
> through P4 as done. The deviation log was right; the header is derived from it.*

---

## How to use this plan

- Implement **exactly one phase at a time**. Do not start the next phase until the
  current gate passes.
- Every phase lists **tests written with or before the implementation**. Tests are not a
  trailing activity.
- A phase is complete only when its **verification commands have been run and their
  output shown** (`TS-R1`). Never claim completion from inspection.
- If reality forces a deviation, **update this document and say so** in the same change.
- Each phase's **"Must NOT be done"** section is as binding as its objective. Scope creep
  across phases is the primary failure mode this plan exists to prevent.

### Dependency budget (`NFR-010`)

**Core package `forge` — cap 8, currently 6.**

| Dependency | Added in | Purpose |
|---|---|---|
| `zod` | P0 | Schema, validation, JSON Schema source of truth |
| `commander` | P1 | CLI |
| `yaml` | P1 | Profile and archetype parsing |
| `gpt-tokenizer` | P1 | Pinned token estimation for budgeting |
| `@anthropic-ai/sdk` | P1.5 | Default model provider |
| `@vscode/ripgrep` | P2 | Lexical retrieval |
| *(two slots free)* | — | A dependency may **not** be added here to serve `web` |

The OpenAI-compatible provider uses native `fetch` and adds **no** dependency.
The history index uses **`node:sqlite`**, built into Node 22 — it replaces the
`better-sqlite3` slot this table previously reserved for P5, and costs nothing
(AD-20).

**Workspace package `web` — cap 14, currently 11.** `next`, `react`,
`react-dom`, `ai`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`,
`@ai-sdk/anthropic`, `clsx`, `tailwind-merge`, `lucide-react`, `forge`.
Additions are justified in `docs/architecture.md` §21.

Dev-only: `typescript`, `vitest`, `tsx`, `@types/node`, `eslint`, `promptfoo`.

---

## Phase order and rationale

```
P0    IR foundation                        deterministic, no model, no I/O
P1    Compiler + profiles + diagnostics    deterministic, no model
P1.4  Security + spec hardening            deterministic; closes findings before the gate
──────────────────────────────────────────────────────────────────────────
P1.5  VERTICAL SLICE                       first model call; end-to-end
      ★ THESIS CHECK / DOGFOOD GATE ★      ← go / no-go for the whole project
──────────────────────────────────────────────────────────────────────────
P2    Context engine + WorkspaceGuard      deterministic; security corpora
P3    Complete intent + clarification      boundary hardening
P4    Strategy archetypes + evaluation     deterministic
P5    Package + provenance + explain       deterministic
P6    Second full renderer + hardening     judged diagnostics, docs, CI
```

**Why the slice sits at P1.5.** The existential risk (`AOC-1`) is that FORGE does not beat
handing the raw task to a strong agent. Discovering that after building the context engine,
the strategy system, and the provenance store would waste months. P1.5 buys the answer
with roughly two phases of work.

**What P1.5 deliberately isolates.** It ships with *no retrieved context and no strategy
system* — only structure: goals, constraints, scope, verification, non-goals, capability
legalization. That is the cleanest possible test of the core thesis, because it varies one
thing. If structure alone wins, context and strategy can only add. If structure alone
loses, we have learned something decisive and cheap.

---

# P0 — IR foundation

### Objective
Establish the Task IR as a typed, canonical, content-addressed, migratable object with a
golden-test harness. No models, no filesystem traversal, no rendering.

### Requirements satisfied
`FR-005` · `FR-006` · `FR-007` · `FR-008` · `FR-009` · `FR-010` · `FR-011` (partial) ·
`INV-001` · `INV-015` · `NFR-012` · `IR-R1`–`IR-R14`

### Step 0 — discard stale scaffolding *(required first action)*

`src/ir/version.ts`, `vocabulary.ts`, `schema.ts`, `canonical.ts` were written against
architecture **revision 1** and contradict revision 2 in five ways
(`docs/architecture.md` §22: items 1, 6, 7, 8, 9): denylist hashing, `materialization` in
the IR, `created_at`/provenance in the IR, `source_ref` on only two node types, and a
hardcoded four-site boundary enum.

Delete them and rewrite. Salvage only the *ideas* already lifted into
`docs/architecture.md` §3–§5. Do not attempt to patch them incrementally — the layering
is wrong, not the details.

`package.json`, `tsconfig*.json`, `vitest.config.ts`, `.gitignore` may be kept and amended.

### Files created

```
src/ir/version.ts          IR_VERSION, parse, isReadable, compare
src/ir/vocabulary.ts       closed enums shared with AgentProfile (capabilities, trust,
                           roles, kinds); INSTRUCTION_BEARING set
src/ir/schema.ts           Zod: TaskIR, DraftIR, all node schemas
src/ir/canonical.ts        canonicalize, canonicalStringify, contentHash, rawHash
src/ir/projection.ts       IR_SEMANTIC_FIELDS, CONTEXT_REF_SEMANTIC_FIELDS, semanticHash
src/ir/trust.ts            SourceRef, resolveTrust
src/ir/integrity.ts        referential integrity + C010/C050/C052/C053/C090/C091/C092
src/ir/migrate.ts          migration registry; refuse unknown major
src/ir/diagnostic.ts       Diagnostic + Evidence types, code registry (shared with critic)
src/ir/index.ts            public surface
scripts/emit-schema.ts     JSON Schema emit + --check
fixtures/ir/auth-debug.json          canonical happy-path fixture
fixtures/ir/bloated.json             unjustified refs → C010
fixtures/ir/untrusted-instruction.json → C050
fixtures/ir/semi-trusted-instruction.json → C052
tests/property/ir-hash.test.ts
tests/property/ir-integrity.test.ts
tests/property/ir-migration.test.ts
tests/golden/ir-canonical.test.ts
```

### Core interfaces

```ts
// projection.ts — the allowlist. INV-015 depends on this being the ONLY hash input.
export const IR_SEMANTIC_FIELDS = [
  "ir_version", "objective", "goals", "constraints", "non_goals", "scope",
  "required_capabilities", "context_refs", "assumptions", "open_questions",
  "verification", "deliverables", "risk",
] as const;

export const CONTEXT_REF_SEMANTIC_FIELDS = [
  "id", "uri", "role", "trust", "justifies", "content_hash",
] as const;

export function semanticHash(ir: TaskIR): string;   // "sha256:<64 hex>"

// trust.ts
export type SourceRef = "user_input" | "forge_derived" | StrategyId | ContextRefId;
export function resolveTrust(ir: TaskIR, source: SourceRef): TrustTier;

// integrity.ts — SEMANTICS, separate from Zod SHAPE (FR-008)
export function checkIntegrity(ir: TaskIR): Diagnostic[];

// diagnostic.ts
export interface Diagnostic {
  code: DiagnosticCode; name: string;
  severity: "error" | "warning" | "info";
  source: "deterministic" | "judged";
  message: string;
  evidence: Evidence[];              // non-empty, enforced by constructor
}
```

### Key implementation notes

- The Task IR file contains **only** the semantic layer (`IR-R9`). No `created_at`, no
  model calls, no retrieval timestamps, no `materialization`, no `est_tokens`.
- Every member of `INSTRUCTION_BEARING` carries `source_ref` (`IR-R5`). `non_goals` are
  structured nodes, not strings (`IR-R8`).
- `Diagnostic` cannot be constructed with empty evidence — enforce in the factory, not by
  convention (`INV-007`).
- Canonicalization: sorted keys, preserved array order, `undefined` dropped, `null` kept,
  non-finite rejected, `-0` → `0`, `\n` line endings, `/` path separators.

### Tests (written with the implementation)

| Test | Asserts | Maps to |
|---|---|---|
| `ir-hash` — stability | Same IR hashes identically across 100 runs and after key reordering | `AC-005` |
| `ir-hash` — **allowlist** | Adding an unlisted field to a fixture leaves the hash **unchanged** | `AC-008`, `INV-015` |
| `ir-hash` — sensitivity | Changing any listed field **does** change the hash | `INV-015` |
| `ir-integrity` | Each fixture produces exactly its expected diagnostic codes | `AC-007`, `AC-010` |
| `ir-integrity` — trust | `resolveTrust` is total; untrusted instruction → `C050`; semi-trusted → `C052` | `INV-002` |
| `ir-migration` | Unknown major refused; known older minor migrates and re-hashes | `AC-008` |
| `ir-canonical` | Canonical serialization snapshot is byte-stable | `IR-R12` |
| **`no-vendor-names`** | Schema and vocabulary contain no vendor/agent/tool/filename string | `AC-001`, `INV-001` |

### Verification

```
pnpm typecheck
pnpm test
pnpm schema:check
```

### Failure modes to watch

- **Hash instability from key order** — canonicalization not applied recursively.
- **Denylist thinking creeping back** — any code path that hashes an object without going
  through `projection.ts`.
- **Zod `.default()` changing hashes** — defaults are applied at parse time and therefore
  *are* semantic. Fixtures must be stored post-parse, or defaults must be avoided on
  hashed fields. Decide explicitly and document it.
- **`z.strict()` omitted** — silently permits unknown fields, defeating the allowlist test.

### Exit gate
All verification green. `AC-001`, `AC-007`, `AC-008` pass. A hand-authored IR validates,
hashes stably, and produces the expected diagnostics with **zero** model calls and zero
filesystem access outside fixtures.

### Must NOT be done in P0
No rendering, no profiles, no context retrieval, no CLI beyond `forge ir validate`, no
model provider, no persistence store, no strategy code.

---

# P1 — Minimal compiler and agent profiles

### Objective
Compile a hand-authored IR into rendered artifacts for multiple targets, deterministically,
with legalization, budgeting, byte-level tracing, and deterministic diagnostics. Still zero
model calls.

**P1 is already a shippable product**: *write one task specification, compile it to seven
agents.* That is unusual in this space and worth having before any model is involved.

### Requirements satisfied
`FR-012`–`FR-016` · `FR-020`–`FR-024` · `FR-036` · `INV-003` · `INV-010` · `INV-012` ·
`INV-014` · `NFR-004` · `AP-R1`–`AP-R8`

### Files created

```
src/profile/schema.ts        Zod AgentProfile (capabilities, retrieval, budget, output,
                             fidelity, limits)
src/profile/registry.ts      load + validate profiles/*.yaml
src/compile/lower.ts         (identity in P1 — no overlays yet; introduced_by = self)
src/compile/legalize.ts      capability intersection + degradation rule registry
src/compile/degradations.ts  closed named rule registry
src/compile/materialize.ts   by_reference | by_value | summary decision
src/compile/budget.ts        pinned tokenizer; undroppable goals/hard constraints
src/compile/emit.ts          artifact assembly
src/compile/sections/*.ts    the closed section emitter catalogue
src/compile/topology.ts      path templating (closed var set), section composition
src/trace/span.ts            Span, TraceOrigin
src/trace/coverage.ts        byte-level coverage verification → C100
src/critic/deterministic/*.ts C001 C002 C011 C020 C030 C031 C060 C061 C070 C080 C100 C101
src/cli/index.ts             commander; `forge compile`, `forge agents`, `forge ir …`
profiles/{claude-code,openai-codex,opencode,kiro,hermes-agent,
          deepseek-harness,claude-design}.yaml
fixtures/profiles/synthetic-agent.yaml
tests/golden/compile-*.test.ts
tests/property/trace-coverage.test.ts
tests/property/hard-constraints.test.ts
tests/contract/profiles.test.ts
tests/contract/extensibility.test.ts
```

### Core interfaces

```ts
interface SectionEmitter {
  key: SectionKey;                          // from the closed catalogue
  emit(input: SectionInput): SectionOutput; // pure
}
interface SectionOutput { text: string; spans: Span[]; }

interface ArtifactTopology { path: string; sections: SectionKey[]; }

type TraceOrigin =
  | { kind: "ir_node";           node_id: NodeId }
  | { kind: "strategy";          strategy_id: string; overlay_path: string }
  | { kind: "agent_profile";     profile_id: string; profile_path: string }
  | { kind: "context_ref";       ref_id: ContextRefId; materialization: Materialization }
  | { kind: "compiler_rule";     rule_id: CompilerRuleId }
  | { kind: "renderer_template"; renderer_id: string; section_key: SectionKey; slot: string };

interface CompileResult {
  artifacts: Artifact[];        // { path, content, content_hash }
  spans: Span[];
  diagnostics: Diagnostic[];
  materialization: Record<ContextRefId, Materialization>;
  degradations: AppliedDegradation[];
}
```

### Key implementation notes

- **Build byte-level tracing first, not last.** Retrofitting spans onto emitters that
  already concatenate strings is painful. Every emitter returns `{text, spans}` from day
  one. `AOC-10` is resolved or the invariant is revised **in `spec.md`** during this phase —
  prototype it on two or three emitters before writing all of them.
- **Legalization refuses before it degrades.** A hard capability gap is `C030` and stops
  compilation. Only soft gaps reach the degradation registry.
- **Fidelity is enforced, not declared.** `C101` fails the build when a profile claims
  `full` without registered overrides, or `native_topology` with a single-artifact topology.
- Path templating uses a **closed** variable set (`task_slug`, `task_id`, `date`) with
  validation that no template can produce an absolute path or a traversal.
- `forge compile --ir <path>` is the P1 entry point. No `forge task` yet.

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `compile-cross-target` (golden) | One IR → `claude-code`, `kiro`, `claude-design`; ≥5 enumerable differences; snapshots stable | `AC-002` |
| `hard-constraints` (property) | Every hard constraint has ≥1 span, for **every** profile | `AC-004`, `INV-003` |
| `trace-coverage` (property) | Spans non-overlapping; gaps whitespace-only; injected untraced span → `C100` | `AC-006`, `INV-010` |
| `profiles` (contract) | Every profile validates; every section key exists; every profile compiles the canonical fixture | `AC-018`, `AP-R5` |
| `extensibility` (contract) | `fixtures/profiles/synthetic-agent.yaml` compiles with **zero** TS changes | `AC-017` |
| `fidelity` (contract) | Overclaiming profile → `C101` | `AC-018`, `INV-014` |
| `degradation` | `claude-design` (no shell) converts command verification → manual **and** emits `C031` | `AC-009`, `INV-012` |
| `budget` | Oversized context drops background first with `C061`; goals/hard constraints never dropped; overflow → `C060` | `INV-003` |

### Verification

```
pnpm typecheck && pnpm test
pnpm forge compile --ir fixtures/ir/auth-debug.json --target claude-code   --out /tmp/a
pnpm forge compile --ir fixtures/ir/auth-debug.json --target kiro          --out /tmp/b
pnpm forge compile --ir fixtures/ir/auth-debug.json --target claude-design --out /tmp/c
diff -r /tmp/a /tmp/b    # expect real, enumerable differences
```

### Failure modes to watch

- **Trace spans retrofitted** — the single most likely cause of `INV-010` being quietly
  abandoned.
- **Topology producing a path escape** — validate templates, not just the rendered result.
- **A profile silently claiming `full`** because `C101` was written permissively.
- **Degradation applied without a diagnostic** — the `INV-012` failure mode.
- **Snapshot churn** — if golden snapshots change on every unrelated edit, section emitter
  boundaries are wrong.

### Exit gate
`AC-002`, `AC-004`, `AC-006`, `AC-009`, `AC-017`, `AC-018` pass. Seven profiles load and
compile. Cross-target diff shows genuine structural difference with all hard constraints
present in each.

### Must NOT be done in P1
No model calls. No context retrieval or filesystem traversal (context refs come from the
fixture IR). No strategy overlays. No persistence store. No `forge task`. No judged
diagnostics.

---

# P1.4 — Security and specification hardening

### Why this phase exists

A fresh-context audit of the completed P0/P1 implementation found four defects that were
**live in the code** and two contradictions between the specification and what shipped.
Every one of them would have been *inherited* by P1.5 rather than surfaced by it, and three
would have become materially more dangerous once P2 introduced retrieved content and P3 fed
it to a model boundary.

Placed before the thesis gate for one reason: **the Task IR was still unfrozen at that
point (`AOC-4`; it froze at P3)**, and two of the fixes are schema changes. Making them
after the gate would have meant
either an `ir_version` bump with migrations over stored packages, or living with the defect.

Not a feature phase. No new capability, no model, no context, no strategies.

### Requirements satisfied
`INV-002` (widened) · **`INV-016`** · **`INV-017`** · `IR-R5` (widened) · **`IR-R15`** ·
**`FR-050`** · **`MB-R6`** · `AP-R6`/`AP-R8` (resolved) · **`AP-R9`** · `SC-R1` (widened) ·
`AC-026` · `AC-027` · `AC-028` · `CLI-R5` · `IR-R14` / `AOC-7`

### Findings closed

| # | Finding | Fix |
|---|---|---|
| 1 | **Trust laundering through influence-bearing nodes.** `assumptions` sat outside the trust checks and `open_questions` had no `source_ref` at all. Reproduced: an assumption sourced from an untrusted web reference produced `No diagnostics` and rendered as an unattributed `confidence: high` premise, outside every fence. | `AGENT_STEERING = INSTRUCTION_BEARING ∪ INFLUENCE_BEARING`; `open_questions.source_ref` added; `C050`/`C052` now cover both sets |
| 2 | **A model could claim its own provenance.** `resolveTrust` reads `source_ref`; a boundary free to write it could label injected content `user_input`, and the prescribed post-validator was bypassable by construction. | `DraftIR` carries `derived_from: <segment id>` and **no** `source_ref`; `src/ir/attribution.ts` performs the FORGE-owned mapping (`INV-016`) |
| 3 | **Advisory demotion was diagnostic-only for most node kinds.** 4 of 11 emitters honoured it, so `C052` described a rendering that did not happen for goals, verification, deliverables, objective, scope, assumptions and questions. | Every authoritative emitter filters demoted nodes; `advisory` renders all steering kinds with provenance; one shared `advisoryNodeIds` |
| 4 | **Silent topology loss.** Reproduced against this repository's own AC-017 fixture: both non-goals, all verification, the scope, and a demoted constraint deleted with `refused: false` and no diagnostic. | `FORGE-C102` + `checkTopologyCoverage`, refusing for instruction-bearing and advisory-required classes |
| 5 | **AP-R6/AP-R8 contradiction.** `native_topology` required ≥ 2 artifacts; two targets are single-artifact by nature and had to under-claim. The spec's fidelity table was never tested. | Arity is not fidelity; `compatibility` ⇒ exactly one artifact; AP-R8 verified by contract test |
| 6 | **Tokenizer identity could drift.** Encoding taken from the package default while a specific one was declared; hand-typed version against a `^` range; asserted only for truthiness. | Explicit `o200k_base` import; exact pin; identity asserted against the installed package; recorded on `CompileResult` |
| 7 | **CLI untested; exit codes wrong.** Exit 4 unreachable; commander parse failures exited 1. | Allowlisted usage errors, `exitOverride`, `parseAsync`; `tests/contract/cli.test.ts` (26 cases) |

### Files created

```
src/ir/attribution.ts                    input segments; attributeDraft; segment table
src/critic/deterministic/topology.ts     checkTopologyCoverage → FORGE-C102
fixtures/ir/laundered-influence.json     C050/C052 via assumption + open question
fixtures/profiles/lossy-agent.yaml       valid profile that would delete content
tests/property/attribution.test.ts       16 cases
tests/property/advisory-rendering.test.ts 49 cases
tests/property/topology-coverage.test.ts 17 cases
tests/property/tokenizer-identity.test.ts 9 cases
tests/helpers/cli.ts                     child-process CLI harness
tests/contract/cli.test.ts               26 cases
```

### Verification

```
pnpm typecheck && pnpm test && pnpm schema:check
```

### Exit gate
`AC-026`, `AC-027`, `AC-028` pass. `AC-010`'s widened scope holds. All previously passing
tests still pass, with three golden records updated for deliberately changed contracts
(two fixture hashes and four rendered snapshots), each diff reviewed and additive.

### Must NOT be done in P1.4
No intent extraction, no model provider, no cassettes, no context engine, no strategies, no
persistence, no new CLI commands, no unrelated refactors.

---

# P1.5 — Vertical slice ★ THESIS CHECK / DOGFOOD GATE ★

### Objective
Connect natural language to a real, usable artifact for one target, then **answer whether
FORGE is worth building**.

This is a go / no-go gate for the entire project, not a feature milestone.

### Requirements satisfied
`FR-001` (minimal) · `FR-002` (minimal) · `FR-047` · `FR-048` · `FR-049` · `INV-009` ·
`MB-R1`–`MB-R3` · `AC-016` · `AC-019` · **`AC-025`**

### Scope discipline
Ship the **thinnest** possible `intent.extract`:
- One call, one prompt template, Zod-validated output, at most one repair.
- Post-validators from `docs/architecture.md` §13.2.
- **No clarification loop** (that is P3). Blocking questions simply fail the command with
  their text shown.
- **No context retrieval** (that is P2). `context_refs` stays empty.
- **No strategies** (that is P4). Compile with the identity overlay.

### Contracts P1.4 already fixed for this phase — honour them, do not re-litigate

- **The boundary output shape is `DraftIRSchema`, which has no `source_ref`** (`INV-016`,
  `IR-R15`). Build the prompt from numbered **input segments**, then call
  `attributeDraft(draft, segments)`. In P1.5 the segment table is one entry:
  `userInputSegment("s1")`. Do **not** add a `source_ref` field to make prompting easier —
  that is the vulnerability, not a convenience.
- **`open_questions` now require `source_ref`**, so the prompt must make the model cite a
  segment for them like any other node.
- **`forge task` must be async and inherit the CLI harness.** `parseAsync` and the
  exit-code allowlist are already wired; add `task` cases to `tests/contract/cli.test.ts`
  **with** the command, not after it. `CLI-R5`: blocking question or refusal → 3,
  diagnostics → 1, usage → 2.
- **A schema-valid draft can still be refused** by `checkIntegrity` (`C050`) and by
  `checkTopologyCoverage` (`C102`). Treat a refusal as a valid outcome to report, not a bug
  to work around.

### Known tension to decide BEFORE writing the corpus

`DraftIRSchema` inherits `.min(1)` on `goals[].acceptance`, `scope.include` and
`deliverables`, and requires `objective.success_definition`, `objective.kind`, `risk.level`
and `scope.blast_radius`. `FR-002` forbids inventing goals, constraints or scope.

For an input like *"the login test is flaky, fix it"* there is no legal way to say "scope
unknown": the model must produce at least one path glob, with no repository listing
available in P1.5. That invention lands directly on `AC-025`'s **scope-overrun** measure —
the FORGE arm gets a scope the compiler invented while the raw arm gets none, which can
manufacture either a false positive or a false negative on the thesis.

**This is a `spec.md` decision, not an implementation detail.** Either relax the draft-stage
minima (promote to required only after clarification), or state explicitly that
FORGE-derived scope is legitimate `forge_derived` inference and require each instance to be
recorded as an assumption. Decide it, record it here, and only then write the corpus —
`AC-025` requires the corpus to exist before any output is seen.

### Files created

```
src/model/provider.ts        ModelProvider interface
src/model/anthropic.ts       default implementation
src/model/openai-compat.ts   native fetch; no dependency
src/model/boundaries.ts      frozen BOUNDARIES registry
src/model/cassette.ts        record/replay keyed by content hash
src/intent/extract.ts        the boundary: prompt, schema, repair, post-validators
src/intent/prompt.md         versioned prompt template
src/cli/task.ts              `forge task` (minimal)
tests/boundaries/intent.extract.test.ts
tests/contract/boundaries.test.ts
fixtures/cassettes/*.json
evals/corpus/                ≥12 real tasks (see §Thesis protocol)
```

### Core interfaces

```ts
interface ModelBoundary<I, O> {
  id: BoundaryId;
  version: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  postValidators: PostValidator<I, O>[];
  cassetteKey(input: I): string;
  required: boolean;
  onFailure: "fail" | "skip";        // never "guess"
}

export const BOUNDARIES = Object.freeze({ "intent.extract": intentExtract });

interface ModelProvider {
  id: string;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
```

### Thesis protocol (`AC-025`) — define before running

1. **Corpus:** ≥12 real tasks from real repositories, spanning debugging, refactoring,
   architecture change, ambiguous requests, and conflicting constraints. Written **before**
   seeing any output.
2. **Arms:** (A) raw task text handed to the agent. (B) FORGE Execution Package for the
   same task, same agent, same model, same repository state.
3. **Blinding:** results are reviewed without knowing which arm produced them.
4. **Measures**, all counted rather than judged:
   - constraint violations (a stated constraint was broken)
   - scope overruns (files touched outside `scope.include`)
   - correction cycles required to reach an acceptable result
   - goals left unaddressed
5. **Decision rule, fixed in advance:**
   - **FORGE wins on ambiguous and multi-constraint tasks** → proceed to P2.
   - **No difference** → proceed, but reposition publicly as a specification, portability,
     and review tool; amend `intent.md` accordingly.
   - **FORGE loses** → stop and reconsider the architecture before spending P2–P6.

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `boundaries` (contract) | Every registered boundary satisfies all eight properties, including an existing dedicated test file | `AC-016`, `MB-R2` |
| `intent.extract` | Cassette replay is deterministic; post-validators reject dangling citations, invented capabilities, and untrusted-sourced constraints | `FR-002` |
| `no-api-key` | Full suite passes with `ANTHROPIC_API_KEY` unset and network disabled | `AC-019` |
| `no-invention` | On the adversarial corpus subset, zero constraints appear that are absent from the input | `FR-002` |

### Verification

```
pnpm typecheck && pnpm test
ANTHROPIC_API_KEY= pnpm test          # must still pass (cassettes)
pnpm forge task "debug the intermittent auth session drop without changing
                 the AuthProvider interface" --target claude-code --out /tmp/slice
# then: read /tmp/slice by hand and judge whether you would hand it to an agent
```

### Failure modes to watch

- **Scope creep into P2/P3/P4.** The temptation to "just add a bit of context" here will
  contaminate the thesis measurement. Resist it — that is the entire point of the phase.
- **Unblinded evaluation.** Knowing which arm you are reading invalidates the result.
- **Corpus written after seeing output** — retrofitting the benchmark to the answer.
- **A "guess" fallback slipping into the boundary** when repair fails.

### Exit gate
`AC-016`, `AC-019` pass. **`AC-025` has been run and its result recorded in this document**,
with the decision rule applied. A negative result is a valid, publishable outcome
(`intent.md` Success Signals) — not a reason to weaken the measurement.

### Must NOT be done in P1.5
No clarification loop. No context retrieval. No strategy system. No persistence. No second
renderer. No judged diagnostics.

---

# P2 — Context engine and WorkspaceGuard

### Objective
Retrieve, guard, rank, justify, and materialize repository context deterministically —
with the security corpora that make the trust model real rather than declared.

**Purpose after the P1.7 thesis reset.** P2 is justified as context resolution +
evidence attribution + ambiguity reduction — directly addressing the P1.6 lesson
(answer resolvable questions from trusted/semi-trusted evidence before escalating,
never fabricate) — and NOT as an attempt to rescue the retired
"structure beats raw" claim. P2 succeeds when retrieval is justified, guarded,
and question-reducing under the existing acceptance criteria below; execution-win
comparisons are permanently out of scope as a success measure.

### Requirements satisfied
`FR-019` · `FR-025`–`FR-030` · `INV-002` · `INV-006` · `INV-011` · `CE-R1`–`CE-R8` ·
`SC-R1`–`SC-R7`

### Files created

```
src/context/workspace.ts      WorkspaceGuard — the ONLY module importing fs
src/context/retrievers/ripgrep.ts | git-history.ts | glob.ts | explicit.ts
src/context/query.ts          per-instruction-node query derivation
src/context/rank.ts           deterministic scoring
src/context/roles.ts          rule table
src/context/secrets.ts        pattern + entropy detection; optional gitleaks shell-out
src/context/trust.ts          source-class → tier assignment
src/cli/context.ts            `forge context resolve`
.eslintrc                     rule: no fs import outside workspace.ts
fixtures/repos/small/         synthetic repository
fixtures/injection/           adversarial payload corpus
fixtures/secrets/             fake credential corpus
tests/security/injection.test.ts | secrets.test.ts | pathjail.test.ts
tests/property/context-justification.test.ts
```

### Key implementation notes

- **Justification falls out of retrieval** (`docs/architecture.md` §10.2). Queries are
  derived per instruction node, so a hit justifies that node **by construction**. No model
  boundary. Explicit `--file` additions require `--justifies <id>` or are rejected with
  `C010`.
- **WorkspaceGuard order is fixed and fail-closed**: resolve → `realpath` → root-prefix
  assert → deny symlink escape → ignore rules → deny globs → secret scan → trust assign.
  Content is not representable as context until every step has passed.
- A secret that would be **inlined** (`by_value`) is a hard error, not a warning
  (`SC-R6`).
- The injection corpus must include: instruction-injection text, fake system prompts,
  zero-width characters, and content attempting `role: constraint_source`.

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `pathjail` | Symlink escape, `../..`, absolute path, gitignored file all denied; no `fs` import outside the guard | `AC-011`, `AC-015` |
| `injection` | Zero untrusted spans outside fenced blocks; zero untrusted instruction nodes; `C050`/`C053` fire | `AC-010` |
| `secrets` | Zero credentials in any artifact; inlining is a hard error; redaction records rule + count, never the secret | `AC-014` |
| `context-justification` | Every retained ref justifies itself and resolves; unjustified explicit file → `C010` | `AC-007`, `INV-006` |
| `materialization` | `strong` target → ≥80% `by_reference`; `claude-design` → 100% `by_value`/`summary` | `AC-002` |
| `determinism` | Context resolution over a fixed tree is reproducible; scores land in the run layer only | `AC-005` |

### Verification

```
pnpm typecheck && pnpm test
pnpm test:security
pnpm forge context resolve --ir fixtures/ir/auth-debug.json --json
# manual: plant an injection file in a scratch repo, confirm fenced output + C051 path
```

### Failure modes to watch

- **A second `fs` import** appearing anywhere — the lint rule must land with the guard, not
  after it.
- **Secret scanning after materialization** rather than before representability.
- **Scores leaking into the semantic layer** and breaking `AC-005`.
- **Ranking weights hardcoded** rather than configurable and documented.

### Exit gate
`AC-007`, `AC-010`, `AC-011`, `AC-014`, `AC-015` pass. All three security corpora green.

### Must NOT be done in P2
No embeddings, no vector store, no tree-sitter, no Repomix, no web or issue retrieval, no
multi-pass refinement loop. No model boundary in the context path.

---

# P3 — Complete intent and clarification boundary

### Objective
Harden the intent boundary to the full specification: repair, blocking versus non-blocking
clarification, assumption recording, and the evaluation corpus scaffolding.

### Requirements satisfied
`FR-001`–`FR-004` · `FR-049` · `TS-R6` · `AOC-4` closure

### Files created / changed

```
src/intent/extract.ts        + repair loop (max 2), + refine mode (prior draft + answers)
src/intent/clarify.ts        blocking vs non-blocking routing; interactive prompts
src/intent/signals.ts        repo signals supplied to the boundary
src/cli/task.ts              full pipeline wiring; --yes, --strict, --no-llm
evals/corpus/*.yaml          ≥30 tasks across the 8 categories of spec.md §17.4
evals/promptfoo.yaml         boundary regression config
tests/property/clarify.test.ts
```

### Key implementation notes

- **`open_questions` and `assumptions` are the model's legal place to be uncertain.**
  This is the primary defense against invention: the prompt must make surfacing
  uncertainty *easier* than fabricating a constraint.
- Repair passes the **validation errors** back, at most twice. A third failure is a hard
  error with the errors shown (`FR-003`). No partial acceptance.
- `--yes` makes a blocking question a failure (exit 3), never an auto-answer.
- The corpus is **scaffolded and populated** here but wired into CI only as a marked,
  excluded suite (`TS-R5`).

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `clarify` | Blocking → halt (exit 3); non-blocking → recorded assumption present in the package | `FR-004` |
| `repair` | Invalid output repairs within 2 attempts; a third failure is a hard error | `FR-003` |
| `intent.extract` corpus | 30/30 schema-valid after ≤2 repairs; zero invented constraints on the adversarial subset | `AC-025` support |

### Verification

```
pnpm typecheck && pnpm test
ANTHROPIC_API_KEY= pnpm test
pnpm promptfoo eval --config evals/promptfoo.yaml   # requires a key; not in CI
```

### Failure modes to watch

- **A model "helpfully" resolving ambiguity** instead of asking. Measured by the adversarial
  subset, not by inspection.
- **Repair loops that mutate the prompt semantically** rather than only appending errors.
- **Corpus entries asserting string equality** on statements rather than set containment —
  brittle and will be weakened later under pressure.

### Exit gate
Clarification behaves correctly in both interactive and `--yes` modes. Corpus exists and
runs manually. The IR schema is now **frozen for v0.1** (`AOC-4`) — later changes require an
`ir_version` bump.

### Must NOT be done in P3
No strategy system. No judged diagnostics. No auto-optimization of prompts. Do not wire
live evals into the default CI suite.

---

# P4 — Strategy archetypes and deterministic evaluation

### Objective
Add structured strategy overlays and complete the deterministic diagnostics and ranking —
all without a model call.

### Requirements satisfied
`FR-018` · `FR-031`–`FR-035` · `FR-036` · `FR-038` · `FR-039` · `ST-R1`–`ST-R7` ·
`DG-R1`–`DG-R6` · `INV-008`

### Files created

```
src/strategy/schema.ts        Zod archetype + overlay + parameter bounds
src/strategy/registry.ts      load strategies/*.yaml
src/strategy/signals.ts       extractSignals(TaskIR)
src/strategy/fit.ts           deterministic rule scoring
src/strategy/derive.ts        bounded parameter derivation
src/strategy/apply.ts         overlay ⊕ IR → EffectiveIR; sets introduced_by
src/strategy/distinctness.ts  pairwise structural distance + threshold
src/strategy/source.ts        StrategySource interface; ArchetypeSource
src/critic/rank.ts            lexicographic ranking; names the deciding step
src/cli/strategies.ts         `forge strategies`
strategies/{surgical,rigorous,autonomous,exploratory}.yaml
tests/property/strategy-distinctness.test.ts
tests/property/no-composite-score.test.ts
tests/golden/strategy-rationale.test.ts
```

### Key implementation notes

- **No model boundary** (`MB-R4`). Selection is fit-rule scoring; tuning is bounded
  derivation. The `rationale` is rendered from the matched rules, so it *is* the decision
  procedure and cannot misdescribe itself.
- `StrategyCandidate.origin` is an open enum whose only v0.1 value is `archetype`
  (`ST-R7`), and `StrategySource` is the extension point (`FR-035`) — future discovery
  requires **no Task IR schema change**.
- Ranking is lexicographic with **no weights**. The output names which step decided.
- Overlay-added nodes set `introduced_by: {kind: "strategy", …}` so `forge explain` can
  show the chain (`PV-R4`).

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `strategy-distinctness` | Four archetypes pairwise distinct above threshold; a deliberately reworded duplicate is rejected and recorded | `AC-003` |
| `strategy-rationale` (golden) | Rationale text is derived from matched fit rules and is stable | `FR-033` |
| `no-composite-score` | Repository-wide scan finds no aggregate score emitted anywhere | `AC-013`, `INV-008` |
| `ranking` | The deciding rule step is reported; equal-diagnostic candidates break by token cost | `DG-R6` |
| `hard-constraints` (extended) | Hard constraints survive **every** archetype for **every** profile | `AC-004` |

### Verification

```
pnpm typecheck && pnpm test
pnpm forge strategies --ir fixtures/ir/auth-debug.json --json
pnpm forge compile --ir fixtures/ir/auth-debug.json --target claude-code --strategy surgical
```

### Failure modes to watch

- **Archetypes collapsing toward each other** as parameters are tuned — the distinctness
  test must run on *derived* overlays, not templates.
- **A weighted score sneaking into ranking** under the name "priority" or "confidence".
- **Fit rules encoded in code** rather than in the YAML, defeating `FR-031`.

### Exit gate
`AC-003`, `AC-004`, `AC-013` pass. Four archetypes produce materially different compiled
artifacts from one IR, with the deciding rule shown.

### Must NOT be done in P4
No `strategy.propose` boundary. No free-form or discovered strategies. No judged
diagnostics.

---

# P5 — Package, provenance, history, explain

### Objective
Emit the full Execution Package, persist it, and make `forge explain` a pure provenance
lookup.

### Requirements satisfied
`FR-040`–`FR-046` · `INV-004` · `INV-005` · `INV-013` · `PK-R1`–`PK-R8` ·
`PV-R1`–`PV-R5` · `PS-R1`–`PS-R5`

### Files created

```
src/package/manifest.ts       semantic_id computation over the input tuple
src/package/assemble.ts       the nine semantic files + run.json
src/package/export.ts         relocatable output; no absolute paths
src/store/objects.ts          content-addressed store
src/store/runs.ts             append-only JSONL
src/store/index.ts            better-sqlite3; DERIVABLE
src/store/rebuild.ts          reconstruct index from objects + runs
src/trace/explain.ts          resolver per TraceOrigin kind
src/cli/{explain,history,diff,export,check}.ts
tests/property/determinism.test.ts
tests/property/index-derivable.test.ts
tests/contract/no-execution.test.ts
```

### Key implementation notes

- **`run.json` is written last and separately.** A bug leaking volatile data into a
  semantic file then shows up immediately as a determinism `diff` failure.
- `semantic_id` covers the input tuple (`docs/architecture.md` §3.3) plus every artifact's
  `content_hash`. `run.json` is excluded.
- **The index is derivable** (`PS-R3`): delete `index.sqlite`, rebuild, byte-compare.
- `forge explain` **must not import the model layer at all** — enforce with a static test,
  not a convention (`FR-043`).

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `determinism` | Two compilations `diff -r` identical **except** `run.json`; `run.json` **does** differ; **no clock is frozen** | `AC-005`, `INV-005`, `INV-013`, `TS-R3` |
| `index-derivable` | Deleting and rebuilding the index reproduces it exactly | `PS-R3` |
| `no-execution` | Static analysis: no code path executes a command derived from an IR or package | `AC-020`, `INV-004` |
| `explain` | Every span resolves to a real origin; explain imports no model code | `AC-006`, `FR-043` |
| `package-portable` | Exported package contains no absolute paths and parses with schema alone | `PK-R7`, `PK-R8` |

### Verification

```
pnpm typecheck && pnpm test
pnpm forge compile --ir fixtures/ir/auth-debug.json --target claude-code --out /tmp/p1
sleep 2 && pnpm forge compile --ir fixtures/ir/auth-debug.json --target claude-code --out /tmp/p2
diff -r /tmp/p1 /tmp/p2 --exclude=run.json     # MUST be empty
diff /tmp/p1/run.json /tmp/p2/run.json         # MUST differ
pnpm forge explain /tmp/p1 --byte 1284
pnpm forge history && pnpm forge diff <a> <b>
```

### Failure modes to watch

- **The temptation to freeze time** when the determinism test fails. That is the forbidden
  fix (`TS-R3`) — the real defect is volatile data in a semantic file.
- **`semantic_id` accidentally covering `run.json`.**
- **SQLite becoming a source of truth** that objects and runs cannot reproduce.

### Exit gate
`AC-005`, `AC-006`, `AC-020` pass. Determinism holds across separate invocations with no
mocked clock.

### Must NOT be done in P5
No execution of verification specs. No orchestration. No server or daemon. No cloud sync.

---

# P6 — Second full renderer, hardening, documentation

### Objective
Reach `full` fidelity on a second target, add optional judged diagnostics, complete
security and performance hardening, and make the project credible to an outside
contributor.

### Requirements satisfied
`FR-017` · `FR-022` · `FR-037` · `NFR-008` · `NFR-011` · `AC-012` · `AC-021`–`AC-024` ·
`§18` extension contract

### Files created

```
src/compile/overrides/openai-codex/*.ts
src/critic/judged/*.ts            C040, C041, C051
src/model/boundaries.ts           + critic.judge (required: false, onFailure: "skip")
src/cli/doctor.ts
.claude/settings.json             hooks whose targets now exist (architecture.md §20)
.github/workflows/ci.yml
docs/{ir-spec,writing-a-profile,diagnostics,security}.md
README.md  CONTRIBUTING.md  AGENTS.md
tests/boundaries/critic.judge.test.ts
tests/perf/budgets.test.ts
tests/contract/net-off.test.ts
tests/contract/dep-count.test.ts
```

### Key implementation notes

- `critic.judge` is **off by default** and `onFailure: "skip"`. A finding whose citation
  does not resolve is **discarded before display** and recorded as a boundary quality
  signal (`DG-R4`).
- The critic's prompt fences retrieved content identically to the downstream artifact
  (`SC-R8`) — FORGE is itself a target.
- Hooks are enabled **only now**, because only now do their target paths and commands
  exist (`docs/architecture.md` §20).
- `docs/ir-spec.md` and `docs/diagnostics.md` are **generated** from the Zod schema and the
  code registry, so they cannot drift.

### Tests

| Test | Asserts | Maps to |
|---|---|---|
| `critic.judge` | Unresolvable citations discarded; boundary cannot emit a deterministic code | `AC-012`, `DG-R4` |
| `net-off` | No outbound socket without `--allow-net` | `AC-021` |
| `dep-count` | Runtime dependencies ≤ 8 | `AC-023` |
| `perf` | Stage budgets respected on a large synthetic repository | `AC-022` |
| `json-output` | Every command supports `--json` | `AC-024` |
| `codex-fidelity` | `openai-codex` overrides registered; `full` claim survives `C101` | `AC-018` |

### Verification

```
pnpm typecheck && pnpm lint && pnpm test
pnpm test:security && pnpm test:perf
ANTHROPIC_API_KEY= pnpm test
pnpm forge doctor
```

### Exit gate
Every acceptance criterion `AC-001`–`AC-024` passes. `AC-025` recorded from P1.5.
A contributor can add an agent profile by following `docs/writing-a-profile.md` with no
code change.

### Must NOT be done in P6
No orchestration. No web UI. No hosted service. No prompt optimization. No vector store.

---

## Review and verification support

### `.claude/agents/verifier.md` — created now

A single scoped subagent, justified because fresh-context verification catches exactly the
failure this plan is most vulnerable to: an implementation session that has convinced
itself a phase is complete. It **reports**; it never edits.

### Proposed but NOT created

Deliberately withheld until there is work for them to review. Creating agents before there
is code is ceremony, not capability.

| Agent | Create when |
|---|---|
| `architecture-reviewer` | P4, when overlays and diagnostics interact enough to drift from `docs/architecture.md` |
| `security-reviewer` | P2, alongside `WorkspaceGuard` and the corpora |
| `simplifier` | P6, once the shape has stabilized |

---

## Cross-phase requirement coverage

| Phase | Primary requirements | Acceptance criteria |
|---|---|---|
| P0 | `FR-005`–`FR-011`, `INV-001`, `INV-015` | `AC-001`, `AC-007`, `AC-008` |
| P1 | `FR-012`–`FR-024`, `FR-036`, `INV-003`, `INV-010`, `INV-012`, `INV-014` | `AC-002`, `AC-004`, `AC-006`, `AC-009`, `AC-017`, `AC-018` |
| P1.4 | `FR-050`, `INV-016`, `INV-017`, `IR-R15`, `MB-R6`, `AP-R9` | `AC-026`, `AC-027`, `AC-028` |
| P1.5 | `FR-001`, `FR-002`, `FR-047`–`FR-049`, `INV-009` | `AC-016`, `AC-019`, **`AC-025`** |
| P2 | `FR-019`, `FR-025`–`FR-030`, `INV-002`, `INV-006`, `INV-011` | `AC-010`, `AC-011`, `AC-014`, `AC-015` |
| P3 | `FR-001`–`FR-004`, `TS-R6` | corpus scaffolding |
| P4 | `FR-018`, `FR-031`–`FR-039`, `INV-008` | `AC-003`, `AC-013` |
| P5 | `FR-040`–`FR-046`, `INV-004`, `INV-005`, `INV-013` | `AC-005`, `AC-020` |
| P6 | `FR-017`, `FR-022`, `FR-037`, `NFR-008`, `NFR-011` | `AC-012`, `AC-021`–`AC-024` |
| V2-A | `WS-R1`–`WS-R14` | `AC-029`–`AC-031`, `AC-036` |
| V2-B | `WS-R10`–`WS-R13` | `AC-036` |
| V2-C | `WS-R6`–`WS-R9`, `WS-R17`–`WS-R19` | `AC-032` |
| V2-D1 | `WS-R24`, `WS-R25`, `WS-R29`, `DG-R1`–`DG-R2` | `AC-039`, `AC-040`, `AC-042` |
| V2-D2 | `WS-R9`, `WS-R26`–`WS-R29`, `DG-R3`–`DG-R4` | `AC-041`, `AC-043` |
| V2-E | `WS-R8`, `ST-R1`–`ST-R7` | — |
| V2-R | `FR-051`, `WS-R15`, `WS-R20`, `WS-R21`, `SC-R2`, `SC-R6`, `INV-012`, `INV-016` | `AC-033`, `AC-034`, `AC-035`, `AC-037` |
| V2-F | `FR-040`–`FR-044`, `FR-046`, `FR-052`, `PK-R1`–`PK-R8`, `PV-R1`–`PV-R5`, `RQ-R1`–`RQ-R3`, `INV-004`, `INV-005`, `INV-013`, `INV-015` | `AC-005`, `AC-020`, `AC-044`, `AC-045`, `AC-046` |
| V2-G | `EV-R1`, `EV-R2` *(new in V2-G)* | new — `FORGE-V001`–`V003` |
| V2-H | `INV-002`, `INV-011`, `FR-025`–`FR-030` *(reused)* | new |
| V2-I | `NFR-011`, `TS-R6` | `AC-038` |

---

## V2 — resequenced phases

> **Why this replaces the P5 → P6 tail.** The original sequence was written for a
> CLI-first compiler that would finish with packaging and a second renderer. A
> conversational workspace then shipped, and the audit in `docs/architecture.md`
> §22 found that it touches almost none of the core. Appending "P7" would have
> left that unaddressed. P5 is **not cancelled** — it is resequenced into V2-F,
> where the Execution Package becomes something the product exports rather than a
> milestone that precedes the product. P6 stays deferred.
>
> **Revised 2026-09-21, after V2-R.** The V2-F…V2-I entries below replace the
> original V2-F/V2-G/V2-H. Two of those were struck outright because V2-R shipped
> them; `forge history` was dropped rather than rescheduled; and V2-G and V2-H
> were **swapped** — verification depends on the Execution Contract but not on
> requirement lifecycle, while linkage is nearly worthless until there are verdicts
> to link to. See [`docs/roadmap-v2.md`](docs/roadmap-v2.md).
>
> Every V2 phase is a vertical slice that must leave a usable product visibly
> better than it found it. The rules in "How to use this plan" apply unchanged:
> one phase at a time, tests with or before implementation, verification output
> shown, deviations recorded here.

### V2-0 · Reconciliation *(this pass — documentation only)*

**Objective.** Make the five canonical documents describe the system that exists.
**Why now.** Every estimate and every review downstream depends on the documents
being true. They were not.
**Exit gate.** The consistency audit in §"Consistency audit" passes, and
`pnpm typecheck && pnpm test && pnpm schema:check && pnpm --dir web build` confirm
no behaviour changed.
**Must NOT change.** Any file under `src/`, `web/`, `tests/`, `profiles/`,
`strategies/`, or any dependency.

### V2-A · Turn runtime, action model, and the state it requires *(COMPLETE — 2026-09-16)*

> **Verified 2026-09-16.** `pnpm typecheck` clean · `pnpm test` 769 passed,
> 13 skipped · `pnpm schema:check` OK · `pnpm --dir web build` clean ·
> `web/scripts/e2e.sh` 12/12 over real HTTP · real-browser acceptance run
> (screenshots under `.playwright-mcp/v2a-*.png`): a question was answered with
> the prompt still at v1, the next change produced v2, and the persisted run log
> shows `CREATE → EXPLAIN → REVISE` with six `ModelCallRecord`s across three
> turns. `AC-029`, `AC-030`, `AC-031`, `AC-036` pass. V2-B is **not** started.

**Objective.** A user message resolves to one of ten conversation actions before
anything is written; the turn runs through a FORGE-owned pipeline that emits typed
events; and every model call leaves a persisted record.
**Why now.** Everything else in V2 hangs off it, and it fixes a defect users hit
daily: asking a question creates a spurious prompt version.
**Order matters — A1 before A2.** A1 is conversation state (candidate set,
pending clarification), the append-only `TurnEvent` log, and `ModelCallRecord`
persistence. A2 is the classifier and the pipeline. Shipping A2 against today's
single-axis store would classify `COMPARE`, `MERGE` and `CLARIFY` correctly and
then have nowhere to put the result — the feature would look broken while the
classifier worked perfectly.
**Requirements.** `WS-R1`–`WS-R5`, `WS-R10`–`WS-R14`.
**Affects.** `web/lib/turn/*` (new), `web/lib/store.ts`, `src/model/boundaries.ts`.
**Must NOT change.** The IR schema, the compiler, any diagnostic code's `source`.
**Before starting.** Generalize `tests/contract/boundaries.test.ts` property 5 to
a per-boundary sample input — it hardcodes `{ text: … }` and would fail a new
boundary for the wrong reason. Decide in the ADR whether `conversation.generate`
is registered or explicitly exempt (AD-22 leaves this open deliberately).
**Tests.** Action-classification corpus; a property test that every read-only
action writes no version; boundary contract tests for `conversation.classify`;
a test that a failed classification degrades to `DISCUSS`.
**Real-user acceptance.** Ask "why did you structure it that way?" — get an
answer, and **no** new version. Then ask for a change — get a new version.
**Exit gate.** `AC-029`, `AC-030`, `AC-031`, `AC-036` pass.

### V2-B · Streaming and run status *(COMPLETE — 2026-09-17)*

> **Verified 2026-09-17.** `pnpm typecheck` clean · `pnpm test` 788 passed,
> 19 skipped · `pnpm schema:check` OK · `pnpm --dir web build` clean ·
> `web/scripts/e2e.sh` 18/18 over real HTTP · real-browser acceptance
> (screenshots `.playwright-mcp/v2b-streaming-{midflight,complete}.png`): the
> sent message echoes immediately, a named stage line and elapsed clock sit
> beside a Stop button, and the prompt pane fills progressively
> (3 → 51 → 75 → 99 → 111 chars); Stop left the message and version history
> untouched; Regenerate re-ran without duplicating the message; a question
> wrote no version and the next change wrote exactly one.
> **Live-provider smoke PASSED against Kimi K3 (`kimi-k3` via OpenCode Go):**
> 193 text deltas spread over 3971ms, stages
> `classifying → reading_prompt → generating → verifying → saving`, a cancel
> mid-stream wrote no version, regenerate did not duplicate the message, a
> question created no version, and no credential appeared on any surface.
> `AC-036` passes. V2-C is **not** started.

**Objective.** Tokens stream; named stages are visible; turns can be cancelled.
**Why now.** A2 makes it possible — the action is known before generation, so the
response no longer has to be a JSON envelope parsed only when complete.
**Requirements.** `WS-R10`–`WS-R13`. **Must NOT** expose chain-of-thought.
**Real-user acceptance.** Send a long request; see text appear progressively and
a stage line that is not a spinner; cancel mid-flight and lose nothing.

### V2-C · Prompt Studio, artifact model, and the derivable index *(COMPLETE — 2026-09-17)*

> **Verified 2026-09-17.** `pnpm typecheck` clean · `pnpm test` 843 passed,
> 26 skipped · `pnpm schema:check` OK · `pnpm --dir web build` clean ·
> `web/scripts/e2e.sh` 25/25 over real HTTP · live-provider smoke re-run and
> PASSED against Kimi K3 on the new store (138 deltas over 3258ms).
> **`AC-032` passes literally, on bytes**, in unit tests, in the product
> suite, and against the running server: deleting `index.sqlite` while the app
> was serving and listing again reproduced the file byte for byte
> (`becea3e570068dbf…` before and after).
> **Migration verified on real files** — the three captured in
> `fixtures/conversations/`, including the V2-B browser-run conversation
> (10 messages, 4 versions, 73 turn events, 12 `ModelCallRecord`s) — and in the
> browser, where the migrated conversation opened with full provenance.
> **Real-browser Studio acceptance** (`.playwright-mcp/v2c-studio-*.png`):
> history with source, action, timestamp, content hash and turn id; inline
> diff; restore moved the pointer from v4 to v2 and added no version; the
> editor saved v5 as `manual` leaving v1–v4 byte-identical; the width toggle
> cycled docked → wide → focus; V2-B streaming, stage line, elapsed clock,
> Stop and Regenerate all still behaved. V2-D is **not** started.

**Objective.** `PromptArtifact` and `PromptVersion` become first-class; the
three-pane workspace gets a real editor; storage moves to content-addressed
objects plus an append-only log with a SQLite index.
**Requirements.** `WS-R6`–`WS-R9`, `WS-R17`–`WS-R19`.
**Must NOT** make SQLite the source of truth (AD-20).
**Exit gate.** `AC-032` — delete the index, rebuild, get byte-identical results.
Migration from the existing flat JSON is tested on real conversation files.

### V2-D · Requirement preservation — ledger first, drift second *(COMPLETE — 2026-09-17)*

> **Verified 2026-09-17.** `pnpm typecheck` clean · `pnpm test` 908 passed,
> 43 skipped · `pnpm schema:check` OK · `pnpm --dir web build` clean ·
> `web/scripts/e2e.sh` 42/42 over real HTTP. (The HTTP suite binds fixed ports
> 3210/3211/3220; a second runner started while one is up fails with
> `EADDRINUSE` and reads a stale build. Observed during verification, it is a
> harness constraint, not a product defect — a clean run reproduces 42/42.)
>
> **Live-provider smoke PASSED against Kimi K3** (`kimi-k3` via OpenCode Go),
> with a V2-D section added to it: FORGE proposed a pin candidate from the
> prompt a real model had just written; Layer 1 found it present; the model was
> asked to rewrite without it and did; Layer 1 reported `FORGE-W005` as a
> deterministic **error** and gave a byte-identical verdict on a second,
> independent read; the advisory layer then ran the real `intent.extract`
> boundary over both versions (2 extraction calls, 0 on the second run),
> produced nine `FORGE-W006` judged warnings whose citations all resolved
> against the returned renderings, left the pinned requirement to Layer 1, and
> **changed nothing about the deterministic verdict**. No credential appeared on
> any surface.
>
> **The first live run FAILED, and found two real defects** — the reason the
> live tier exists. Both are recorded in the deviation log: `intent.extract`
> sent a 4,000-token output budget that a reasoning model spends on reasoning
> (3,287 of 4,000 measured), so every extraction against Kimi K3 failed; and
> the provider reported that truncation as "returned no message content",
> pointing the reader at a key or a model id instead of at a budget. The same
> failure reproduced on V2-C's `/analyze` route, so it is pre-existing rather
> than introduced here — V2-D is simply the first phase to put `intent.extract`
> on a path the product needs.
>
> **D1 exit gate — `AC-039`, `AC-040`, `AC-042` pass.** A dropped pin is a
> `FORGE-W005` **error** with no model call, byte-identical over repeated runs
> (`tests/property/requirement-ledger.test.ts`, `tests/product/requirement-ledger.test.ts`);
> Layer 1 reaches the same verdict with the judged layer switched off and with
> it absent entirely; and four adversarial model outputs — an envelope carrying
> a `ledger` field, one claiming the requirement was withdrawn, one rewriting
> the pinned text, and an injected instruction to unpin everything — all leave
> the ledger byte-identical while the drop is still reported.
>
> **D2 exit gate — `AC-041`, `AC-043` pass, and the false-alarm rate is
> measured.** No judged finding can suppress, downgrade or resolve a Layer 1
> diagnostic (asserted adversarially, both as a function and over HTTP), and
> `preservationResult` throws rather than carry a deterministic code in the
> judged half. The layers are distinguishable in every surface that renders
> them: separate API fields each tagged `layer`, separate Studio sections with
> different headings, colours and wording, and `source` on every diagnostic.
>
> **False-alarm rate: 0/78 statements (0.00%) over 15 real extracted IRs** —
> the nine schema-valid `intent.extract` cassettes committed under
> `evals/p16/evidence/` and `fixtures/cassettes/`, plus the six `fixtures/ir/`
> IRs — compared against a meaning-preserving reformatting of themselves (ids
> renumbered, statements re-cased, re-wrapped, bulleted, boundary punctuation
> changed, node order reversed). The measurement is not vacuous: the same
> comparison catches 13/13 genuinely dropped constraints. It measures false
> alarms under **surface-only** change, which is the construction in which a
> false alarm is unambiguous; it does not attempt to score judgements about
> genuine rewordings, which are the advisory layer's actual subject and have no
> ground truth in this corpus. Layer 2 therefore ships **opt-in** as specified —
> a user asks for it per version pair — rather than on by default.
>
> **Real-browser acceptance** (`.playwright-mcp/v2d1-*.png`, `v2d2-*.png`):
> pinned "must use PostgreSQL" from the Requirements tab; asked for its removal
> and got `FORGE-W005` as an error in the header badge, on the entry, and in a
> "Preservation failed — deterministic" block quoting the pinned text; restored
> v1 and the entry went green again; a preserving revision produced v3 with the
> requirement present; a refresh, a restore and deleting `index.sqlite` mid-run
> all left the ledger and its verdict intact (the index reproduced byte for
> byte, `022eab0e…` before and after); and the advisory layer rendered in its
> own separated section as "Advisory — judged, not a guarantee", reporting a
> vanished **unpinned** constraint while the deterministic error above it was
> untouched — and saying, when it found nothing, that its silence "is not
> evidence that anything survived".
>
> **V2-E is complete** — see its own section below.

**Objective.** Keep the product's central promise — a revision changes what was
asked and nothing else — with **two layers of different epistemic status**.
**Why now.** It is the feature that makes "auditability" a property rather than a
word, and it is the first genuine product use of the core.

**Ordering is binding: D1 before D2.** The deterministic guarantee ships first,
and stands on its own. The advisory layer is added on top of something already
trustworthy — never as the thing the user is relying on.

#### V2-D1 · The requirement ledger *(deterministic, authoritative)*

FORGE proposes candidate requirements; **the user pins** the ones that matter.
Pinned text is user-authored, verbatim, hashed, attributable to `user_input`, and
never rewritten by a model. Checking a version against the ledger is
**deterministic and involves no model call**; a dropped pinned requirement is an
`error`.
**Requirements.** `WS-R24`, `WS-R25`, `WS-R27.4`, `WS-R29`.
**Affects.** `web/` ledger state and UI; a new deterministic check in `src/critic/`.
**Must NOT.** Let any model-originated path add, edit, remove or unpin an entry.
**Tests.** Determinism over repeated runs; adversarial attempts to mutate the
ledger from model output; the check running with the judged layer absent.
**Real-user acceptance.** Pin "must use PostgreSQL". Ask for an unrelated change.
If the model quietly drops it, FORGE says so as an error, citing the pinned text.
**Exit gate.** `AC-039`, `AC-040`, `AC-042` pass.

#### V2-D2 · Semantic drift *(judged, advisory)*

A Task IR is extracted **once** per version and stored content-addressed;
cross-version comparison surfaces unpinned changes in meaning.
**Requirements.** `WS-R26`, `WS-R27`, `WS-R28`, `WS-R29`.
**Constraints, binding.** A **new code with `source: "judged"`**, severity
`warning`. It may **not** reuse `C001`/`C002` — verified inapplicable
(`docs/architecture.md` §22.3). Both versions' statements cited as evidence.
Opt-in or background, never on the critical path (`WS-R13`).
**Must NOT.** Suppress, downgrade or resolve a D1 finding; be read as evidence
that a pinned requirement survived; or become a precondition for D1 running.
**Exit gate.** `AC-041`, `AC-043` pass, **and** the false-alarm rate is measured
on the existing eval corpus and recorded in this document. A rate too high to
ship means D2 stays off by default — D1 is unaffected either way, which is the
point of the ordering.

### V2-E · Candidates and branches ✅ *(built 2026-09-18; fully verified 2026-09-20)*

**Objective.** Generate, compare, fork and merge alternative prompts.
**Requirements.** `WS-R8`. Reuses the §9 strategy archetypes.
**Must NOT** introduce a second strategy system.

> **Built.** `src/candidate/` (blocks, the duplicate gate, the deterministic
> union merge), `src/conversation/candidate.ts` (a fourth registered boundary),
> `web/lib/candidates.ts` (archetype choice, generation, comparison, promotion,
> merge), four HTTP routes under `/api/conversations/[id]/candidates`, two new
> persisted event kinds and one new index table, and the Studio's Candidates
> tab. See `docs/architecture.md` §23.6.
>
> **The prohibition held.** Variation comes from the §9 archetypes: candidates
> are generated one per archetype under its derived overlay, selected and tuned
> by the existing `ArchetypeSource`/`scoreArchetype`/`deriveParameters`
> machinery, and their pairwise distinctness is the existing `checkDistinctness`
> gate, returned with the set as evidence. What V2-E adds is a *text* duplicate
> gate (`FORGE-W007`) — token-sequence equality, not a similarity threshold —
> because §11.5 cannot see a model returning the same prose under two different
> structures. No second strategy system, no free-form strategy, no model asked
> to invent variety.
>
> **Exit gate.** V2-E has no dedicated acceptance criteria in `spec.md` §23, so
> the gate is the standing suite plus the requirement list, and all of it ran:
>
> - `pnpm typecheck`, `pnpm schema:check`, `pnpm --dir web build` — clean.
> - `pnpm test` — **990 passed**, 53 skipped (908 before V2-E) at the time of
>   this gate; **1017 passed, 53 skipped** after the 2026-09-19 and 2026-09-20
>   fixes added their tests. The 82 added at V2-E are
>   `tests/property/candidate-merge.test.ts` (22),
>   `tests/product/candidates.test.ts` (39),
>   `tests/boundaries/conversation.candidate.test.ts` (13), and the eight
>   per-boundary property assertions the registry contract test now runs over
>   `conversation.candidate` as well. **These per-file counts are as of
>   2026-09-18 and have since moved**: the later fixes took
>   `tests/product/candidates.test.ts` from 39 to **42**. The aggregate above is
>   the number to trust.
> - **A pre-existing flaky test was found while running this gate and is NOT
>   fixed here, because it is not V2-E's.** `tests/product/persistence.test.ts`
>   › "lists conversations newest first, with counts" fails in roughly one run
>   in five. `listConversations` orders by `updated_at DESC, id ASC` at
>   millisecond resolution, and the test creates its two conversations fast
>   enough to land in the same millisecond — the tiebreaker is then a random
>   UUID, so the assertion is a coin flip. Measured, not inferred: a probe
>   printed the two timestamps 1–2 ms apart on passing runs. Nothing V2-E
>   changed touches that path (`populated()` creates no promotion, and the
>   `candidate_added` projection's `updated_at` write is unchanged), and four
>   consecutive full-suite runs after the V2-E work were green.
> - `web/scripts/e2e.sh` — **52/52** over real HTTP (42 before V2-E).
> - `AC-032` re-checked on live candidate and promotion data: deleting
>   `index.sqlite` and rebuilding reproduced it byte for byte
>   (`8d6ccd5d…` before and after).
> - **Real-browser acceptance** (`.playwright-mcp/v2e-01…05*.png`), run twice —
>   once on the first implementation and again after the concurrency fix, with
>   identical results (`8d6ccd5d…` and `e060cc7c…` index digests reproduced byte
>   for byte in each): requested 3
>   alternatives and got three from distinct archetypes (autonomous fit 7,
>   surgical 2, rigorous 1), each with an id, its archetype, its deciding rule
>   and Layer 1's verdict, with the current prompt still at v1 and no version
>   written; compared two side by side (1 shared block, 5 unique each side, line
>   diff); selected `surgical` and got v2 (`REVISE`) with the promotion recorded
>   and the pinned requirement still present; merged `autonomous` with
>   `rigorous` into v3 (`source: merge`, `action: MERGE`) with **zero** blocks
>   of either source missing and the pin still present; reloaded the browser and
>   all three candidates, both promotions and every rationale came back from the
>   log unchanged; and an ordinary revision then produced v4 through the
>   unchanged turn pipeline — 1 classify + 1 generate, the V2-A/B event
>   sequence, no candidate and no promotion created.
> - **Live-provider smoke** (opt-in, Kimi K3 via OpenCode Go): extended to cover
>   candidate generation, comparison, promotion, merge, refresh persistence and
>   the ordinary turn after them. **The V2-E half passed end to end on run 2**:
>   three alternatives from distinct archetypes, each with its archetype, its
>   deciding rule and Layer 1's verdict; a real model returning materially
>   different prompts rather than rewordings; no version written by generating;
>   a comparison with content unique to each side; a promotion leaving every
>   earlier version byte-identical; a merge that dropped **nothing** either
>   alternative said; the ledger untouched throughout; candidates and promotions
>   surviving a re-read; and the ordinary turn afterwards behaving as before.
>
>   Getting there took five runs and the smoke **found two real defects**, both
>   in the deviation log and both fixed: an output budget too small for a
>   reasoning model, and sequential generation exceeding a client's five-minute
>   header timeout. The offline suite was green through both, which is the rule
>   working — a mock passing is not a feature working.
>
>   **Residual, stated rather than glossed:** the concurrency fix has offline
>   proof only. The sixth run, which would have re-verified it live, was
>   refused with `HTTP 429 — "5-hour usage limit reached. Resets in 3hr 21min."`
>   The repeated runs exhausted the provider's rolling rate limit, so the live
>   channel is unavailable until it resets. Nothing about that is a defect in
>   the product: FORGE reported it in one second with the provider's own words.
>
>   **Re-run 2026-09-19 against OpenRouter (`nvidia/nemotron-3-ultra-550b-a55b:free`)
>   — concurrency now verified live, full 3/3 set still outstanding.** The
>   concurrent path ran live for the first time: the candidate phase took
>   **26.3s** against a slowest single call of 25.8s, where sequential would have
>   been 57.4s (three calls of 22.2s, 9.4s and 25.8s), measured with the
>   deliberately sequential `intent.extract` (124.0s) subtracted. Also verified
>   live: distinct archetypes (exploratory fit 5, surgical fit 4), distinct texts,
>   0 overlay rejections, full provenance, `versionCreated: false` with the
>   prompt still at v1, three `conversation.candidate` call records, the ledger
>   byte-identical, the pinned requirement present verbatim in every returned
>   candidate, and — after a real server restart on the same data directory —
>   candidates, provenance, ledger and Layer 1 verdicts all unchanged. The run
>   also found and fixed two genuine V2-E defects (deviation log, 2026-09-19).
>   **Not achieved on that run: a complete 3-of-3 set on the concurrent code.** One
>   archetype's response was malformed JSON and was dropped with `FORGE-W003` as
>   specified; the two retries failed upstream of V2-E (Nvidia "Service
>   temporarily overloaded", then the prerequisite `intent.extract` returning no
>   content after 155s). That residual is now **closed** — see the run below.
> - **Live acceptance 2026-09-20 (OpenCode Go, `kimi-k3`) — PASS, 3 of 3, the
>   last outstanding V2-E gate.** Every assertion green in one run: all three
>   requested archetypes returned (autonomous, exploratory, rigorous) with **zero
>   diagnostics** — no drop, no degradation. **Concurrency, measured live on the
>   product's own HTTP surface**: the candidate phase took **63.1s** against
>   per-call latencies of 33.0s, 43.1s and 30.8s — a sequential sum of 106.9s
>   and a slowest single call of 43.1s, so the phase cost the slowest call and
>   not the sum. `calls: {extraction: 1, generation: 3, total: 4}` — one call per
>   alternative and nothing else (`WS-R13`). Also green: pairwise-distinct
>   overlays with 0 rejections, three materially different texts, the pinned
>   requirement present **verbatim in all three**, every candidate carrying
>   Layer 1's verdict labelled `deterministic` and **naming the candidate rather
>   than a version**, `versionCreated: false` with the prompt still at v1,
>   comparison showing 2 shared and 10/15 unique blocks, promotion writing
>   exactly one version with every earlier version byte-identical and the choice
>   recorded, a `MERGE` union dropping **zero** blocks of either source and
>   keeping the pin, the ledger byte-identical after generate, promote and
>   merge, truthful provider/model on every call record with `replayed: false`,
>   no credential on any surface, and — after a **real server restart on the
>   same data directory** — three candidates, two promotions, v3 and the ledger
>   all unchanged, provenance intact.
>
>   The run **found and fixed one genuine V2-E defect** (deviation log,
>   2026-09-20): candidate generation routed by the provider's kind instead of
>   the model's documented protocol. It also surfaced the same defect in V2-D's
>   `irForVersion`, which is **recorded and not fixed** because it is not
>   V2-E's. AC-032 was not exercised by this harness — the HTTP server does not
>   materialise `index.sqlite` — and remains covered by the offline suite and by
>   the 2026-09-18 live check.
> - **Three findings recorded and NOT fixed, because none is V2-E's.**
>   (a) `/preservation` extracts its two version IRs sequentially in one
>   request — measured at **205s** on run 5 and aborted outright on a slower
>   run. The same dispatch-together fix applies and is a few lines.
>   (b) A provider `HTTP 429` rate limit is classified to the user as
>   "rejected the request for billing reasons, not a bad key", which is the
>   wrong cause; the true message is carried correctly in the diagnostic beneath
>   it.
>   (c) **`irForVersion` routes by the provider's kind, not the model's
>   protocol** (`web/lib/preservation.ts`), the same defect fixed here for
>   candidates. It is worse there than it was here: `extractIntent` needs a core
>   `ModelProvider`, and core's `AnthropicProvider` takes **no base URL**, so
>   there is currently no core transport that can reach an OpenCode Go
>   anthropic-messages model at all. Measured 2026-09-20 on `qwen3.8-flash`:
>   three `intent.extract` attempts to `/chat/completions`, `HTTP 503` with an
>   empty body, 183s, and V2-E's own gate blocked behind it. It is V2-D's path
>   and needs a core change (an optional base URL on `AnthropicProvider`), which
>   is more than a candidate fix may take on its own authority. **Counted, not
>   estimated: 12 of the 29 documented OpenCode Go models are unreachable
>   through this path** (8 `anthropic-messages`, 4 `responses`); the 17
>   `chat-completions` models work by coincidence.
>   All three are listed in `CLAUDE.md`'s known defects.

### V2-R · Product convergence *(COMPLETE — 2026-09-21)*

> **Verified 2026-09-21** at `e9b3c68`. `pnpm typecheck`, `pnpm schema:check`
> clean · `pnpm test` **1078 passed / 65 skipped** (from 1017/53) with no API key
> and no network · `web/scripts/e2e.sh` **64/64** (from 52/52) ·
> `sha256sum -c evals/p16/MANIFEST.sha256` OK ×3 and
> `git diff --name-only 8ac59a5..HEAD -- evals/p16/` empty.

**Objective.** Converge the shipped workspace with the compiler architecture and
fix the product-value defects the audit found. Eleven commits, one per step.

| Step | What shipped |
|---|---|
| 1 | OSS baseline: `README`, `LICENSE`, `CONTRIBUTING`, CI, and `src/index.ts` — the root `exports` map had always pointed at a `dist/index.js` that was never built |
| 2–3 | The renderer stopped asserting `"assumed, not stated"` about content whose `source_ref` is `user_input`. A false provenance claim is FORGE's defect, not the model's (`INV-016`) |
| 4 | The diagnostic catalogue became a contract: `FORGE-W007` backfilled into `spec.md` §10.2, `FORGE-W008` added, and `tests/contract/diagnostic-catalogue.test.ts` now parses the specification and compares it to the registry both ways |
| 5 | Extraction rule 3 forbids demoting a stated obligation into an assumption; `src/intent/demotion.ts` detects it and emits `FORGE-W008`. **Reports, never repairs** — promoting would mean inventing a `hardness` and `kind` the user never gave |
| 6 | `DiagnosticList` + `ChatPanel` wiring. The findings had been produced, serialised and typed all along, then discarded by `void outcome` |
| 7 | `FR-051` conservative compaction with `FORGE-C103`. **Measured yield 0.2%** — reported, not tuned toward |
| 8 | `forge explain`: per-section byte ranges, origins, constraint destinations, diagnostics with evidence |
| 9 | Compile-on-demand. `web/lib/compile.ts` **calls** `compile()`; parity tests hold the bytes identical to the CLI's |
| 10 | Attachments scanned with `scanSecrets` and classified `semi_trusted` before storage — a `.env` dropped into chat had been forwarded to the provider verbatim |
| 11 | `getEffectiveProvider` routes by the model's protocol, not the provider's kind; `/preservation` dispatches its two extractions together |

**Deviations.** Three, all recorded in the deviation log below.

---

### V2-F · Execution Contract + requirement identity *(absorbs P5 — COMPLETE)*

**Objective.** A portable Execution Package a developer or CI consumes with JSON
parsing and the published schema alone, plus stable requirement identity that
survives version churn.
**Requirements.** `FR-040`–`FR-044`, `FR-046`, `FR-052`, `PK-R1`–`PK-R8`,
`PV-R1`–`PV-R5`, `RQ-R1`–`RQ-R3` (§22.9, new), `INV-004`, `INV-005`, `INV-013`,
`INV-015`. **`FR-045` (`forge history`) is dropped**, not deferred.
**Reasoning and rejected alternatives.** [`docs/roadmap-v2.md`](docs/roadmap-v2.md).
**Exit gate.** `AC-005` (two compilations `diff -r` identical except `run.json`,
**no frozen clock** — `TS-R3`) · `AC-020` (static: no code path executes a command
derived from an IR or package) · `PK-R1`–`PK-R8` · a package built by the web
route and by the CLI for the same IR and profile is byte-identical except
`run.json` (`AC-046`) · a package parses against the published schema with no
FORGE import (`AC-045`) · a requirement id survives version churn and no
model-reachable path can set its `origin` (`AC-044`).
**Must NOT be done.** No execution, no orchestration, no daemon, no
`forge history` (the workspace *is* the history UI since V2-C), no new
representation of anything the IR already holds.

### V2-G · Evidence-based verification *(NEXT — not started)*

**Objective.** `VERIFIED` / `FAILED` / `UNVERIFIED` / `REVIEW_REQUIRED` per
obligation, from an evidence file produced by the user, their agent, or CI.
**`INV-004` is not amended.** FORGE ingests evidence; it never runs anything. This
is also the safer reading — `verification[].spec` is authored by the
`intent.extract` model, so executing it would mean executing a model-derived
command string.
**Reuses the taxonomy that already exists:** `command`/`test` are mechanically
checkable, `manual`/`review` are `REVIEW_REQUIRED` **by construction**.
**New spec rules.** `EV-R1` (evidence is never model-authored), `EV-R2` (evidence
binds to a package by `semantic_id`), and codes `FORGE-V001`–`V003`.

### V2-H · Requirement governance + code linkage

**Objective.** Lifecycle (`origin` immutable and FORGE-assigned, orthogonal to
`status`), repository binding through `WorkspaceGuard`, and the traceability
matrix — requirement × files × tests × verdict.
**Highest-risk phase**, because repository binding gives the served workspace
filesystem reach it has never had. Every read goes through `WorkspaceGuard`
(`INV-011`) and every file through `scanSecrets`, exactly as V2-R step 10 did for
attachments.
**Deferrable.** V2-F + V2-G + V2-I is a coherent shippable product without it.

### V2-I · Productization

**Objective.** One-command start, Docker, published schemas, release, and a UI
that does not require internal research vocabulary.
**Binding rule.** A mock passing is not a feature working. The release gate is a
live browser workflow against a real provider, not a nice-to-have.
**Folded in, gated:** the bounded verbosity work. V2-R's compaction moved the
corpus 0.2% because the repetition is model-authored, not renderer-authored. A
prompt-level fix is legitimate only with a version bump, before/after counts on
all twelve eval IRs, **zero** ledger presence-verdict changes, and reversion if
the measured reduction is under 10%. It may never be justified as improving
execution quality — `intent.md` retires that claim.

> **Struck, not deferred.** Two phases that stood here are gone because V2-R did
> the work: *"Target intelligence and export … target metadata governs model
> routing"* (`WS-R20`/`WS-R21`, `AC-034`/`AC-035`) landed in V2-R step 11 and is
> covered by `tests/product/opencode-routing.test.ts`; *"Attachments through
> WorkspaceGuard"* landed in V2-R step 10. `forge history` (`FR-045`) is dropped
> rather than rescheduled. P6's judged diagnostics (`C040`, `C041`, `C051`) and
> `critic.judge` stay **unbuilt** — neither V2-D, V2-E, nor anything in this
> sequence asks a model for a finding.

---

## Deviation log

Record every departure from this plan here, with rationale, at the time it happens.

| Date | Phase | Deviation | Rationale |
|---|---|---|---|
| 2026-09-07 | P0 | `migrateIr` gained a third parameter, `targetVersion`, defaulting to `IR_VERSION`. | With `IR_VERSION = "1.0"` and an empty registry there is no older minor within the supported major, so the walker could not be exercised at all. Injecting the target lets the chain, the broken-path error and the cycle guard be tested against a synthetic registry without inventing a fake schema version in `src/`. |
| 2026-09-07 | P0 | No CLI shipped. `FR-011` is satisfied at the library level (`parseTaskIR`, `checkIntegrity`, `semanticHash`) only. | `plan.md` marks FR-011 "(partial)" for P0 and the dependency budget introduces `commander` in P1. Hand-rolling an argument parser that P1 would delete, or pulling `commander` in a phase early, both cost more than they return. The P0 verification gate does not invoke a CLI. |
| 2026-09-07 | P0 | `AssumptionSchema` has no `basis` field. | Architecture revision 1 had one, but `spec.md` IR-R5 specifies `source_ref` for assumptions and never mentions `basis`. Adding an unspecified field would be scope creep; attribution now carries the information `basis` was standing in for. |
| 2026-09-07 | P0 | Added `pnpm-workspace.yaml` with `allowBuilds: {esbuild: true}`. | pnpm 11's dependency-status precheck runs `pnpm install`, which exits non-zero while any dependency's build script is unapproved. That made every `pnpm <script>` fail, including the verification gate. Approving esbuild explicitly is the documented fix. |
| 2026-09-07 | P1 | `hermes-agent` and `claude-design` ship as `compatibility`, not the `native_topology` that `spec.md` AP-R8 assigns. | **Unresolved contract contradiction.** AP-R6 requires a multi-file topology to claim `native_topology`, and plan.md P1 makes `native_topology` + single-artifact a `FORGE-C101` error. Both targets are single-artifact by design (Hermes emits AGENTS.md with SKILL.md deferred; Claude Design is one brief). Under-claiming keeps INV-014 true; over-claiming would break it. Needs a spec decision — see the P1 report. |
| 2026-09-07 | P1 | `claude-code` and `openai-codex` ship as `native_topology`, not AP-R8's `full`. | `full` requires registered section overrides (AP-R6), and FR-022 assigns overrides to P6. AP-R8 describes the end-of-v0.1 state — it already notes Codex's overrides arrive in P6. Claiming `full` today would be an overclaim that `FORGE-C101` correctly rejects. |
| 2026-09-07 | P1 | Added `fixtures/ir/empty-state.json` as the cross-target fixture. | AC-002 requires one IR to compile on `claude-code`, `kiro` **and** `claude-design`. `auth-debug` requires `fs_write` and `git_history`, which Claude Design lacks and no degradation rule covers, so it correctly refuses. A fixture whose capability needs all three can satisfy was required. `auth-debug` is retained and now also serves as the refusal honesty test. |
| 2026-09-07 | P1 | Added a mandatory-section topology rule (`objective`, `goals`, `constraints` exactly once) as profile *validity*, not a diagnostic. | `docs/architecture.md` §8.2 requires it and it was unimplemented. Without it a topology could omit the goals entirely and still compile: `FORGE-C002` protects only hard constraints. No registry code covers "incomplete topology", and inventing one was out of scope, so a malformed profile throws at load like an unknown section key. |
| 2026-09-07 | P1 | `fs_read: absent` maps to `degrade.inline_context`. | `docs/architecture.md` §7 lists only `autonomous_search = none` as that rule's trigger. A target that cannot read files needs exactly the same compensation, and the alternative was refusing every capability-poor target outright. No new rule was added; an existing one gained a second trigger. |
| 2026-09-07 | P1 | Empty artifacts are omitted rather than written. | A topology may declare a file whose sections all decline for a given task. Writing a zero-byte file into a repository is clutter. Omitted artifacts carry no spans, so INV-003 and INV-010 are unaffected. Consequence: declared topology size is an upper bound on files produced, not an equality. |
| 2026-09-07 | P1 | **Interpretation recorded:** FR-015's "hard-required" versus "soft" is defined by the degradation registry — a capability is soft exactly when a registered rule covers its absence. | `docs/architecture.md` §7 stage 2 says an absent capability gating a `command`/`test` verification refuses with C030, while `degrade.command_to_manual` is triggered by precisely that situation. The two cannot both hold. Defining softness by registry coverage satisfies FR-015 literally, keeps AC-002 achievable, and makes the registry load-bearing rather than decorative. |
| 2026-09-10 | P1.4 | `open_questions` gained a **required** `source_ref`, changing the semantic hash of the two fixtures that use it. No `ir_version` bump and no migration. | IR 1.0 is unreleased and explicitly unfrozen until after P1.5 (`AOC-4`); nothing is committed and no package exists in the wild. A migration for an unreleased version would be ceremony, and defaulting the field would have to fabricate a trust label — the exact failure being fixed. The two golden hashes were updated deliberately, with the diff reviewed; the three fixtures without open questions hash **identically**, which is the allowlist projection behaving correctly. |
| 2026-09-10 | P1.4 | `DraftIRSchema` is no longer `TaskIRSchema.omit(...)`. It drops `source_ref` and `context_refs` entirely and adds `derived_from`. | `INV-016`. A boundary that can state provenance can launder untrusted content into an authoritative instruction, and no post-validator can detect it. Dropping `context_refs` follows `FR-026`/`MB-R4`: `justifies` is a fact about retrieval, not a model's proposal. |
| 2026-09-10 | P1.4 | Section emitters now **decline to render** a demoted `objective` or `scope`, so an artifact may legitimately have no Objective heading. | Uniform advisory relocation across all agent-steering kinds, with no special cases. The alternative — exempting the singletons — would mean a semi-trusted objective renders as the author's stated intent, which is the misrepresentation `SC-R1` exists to prevent. Nothing is lost: the statement is in the advisory section, and `C102` refuses any topology without that destination. |
| 2026-09-10 | P1.4 | `claude-design` gained a `scope` section; `fixtures/profiles/synthetic-agent.yaml` gained `scope`, `non_goals`, `verification`, `acceptance`, `open_questions` and `advisory`. | Both were silently deleting content — the fixture, which is the reference example of the extension contract, was deleting five classes of it. Fixing the data was the correct fix; `FORGE-C102` now prevents the regression. The compile snapshots were updated after reviewing the diffs: purely additive content recovery. |
| 2026-09-10 | P1.4 | `@anthropic-ai/sdk` was installed during a false start on P1.5 and has been **removed**. `gpt-tokenizer` is now pinned exactly (`4.0.0`, no caret). | A runtime dependency no module imports is a false claim about the build, and the plan's own rule is that a dependency arrives in the phase that needs it. The exact pin is required because the recorded tokenizer version is a literal (`AOC-7`); a test now asserts the two agree. The P1.5 dependency budget is unchanged: 4 of 8 used, `@anthropic-ai/sdk` still allocated to P1.5. |
| 2026-09-10 | P1.4 | Two existing tests were **changed, not weakened**: the `native_topology` single-artifact case now asserts acceptance instead of rejection, and the synthetic-profile registry assertion lists two ids. | The first encoded the AP-R6 rule that was resolved as wrong; it was replaced with the new rule plus a `compatibility`-with-multiple-artifacts rejection, so the count of enforced fidelity rules is unchanged. The second is exact equality over the actual directory contents, which now legitimately holds two fixtures. |
| 2026-09-11 | P1.5 | **DraftIR invention tension decided with NO spec change.** `DraftIRSchema` keeps the TaskIR minima (`goals[].acceptance` ≥ 1, `scope.include` ≥ 1, `deliverables` ≥ 1, `success_definition`/`kind`/`blast_radius`/`risk.level` required). Where the input underdetermines a required field, the prompt requires the boundary to emit a **blocking** `open_question` naming the gap (plus the narrowest literal filler the schema needs); `C080` then refuses compilation, so invented filler can never reach an artifact silently. Non-blocking uncertainty goes to `assumptions`/`open_questions` per FR-002/FR-004. | A spec relaxation (optional draft fields) would have pushed invention into the clarification path that P1.5 explicitly does not build, and a `forge_derived`-scope licence would have contaminated AC-025's scope-overrun measure — the FORGE arm would carry compiler-invented scope the raw arm lacks. The blocking-question route uses only mechanisms the spec already provides (FR-004 halting, C080 refusal, exit 3), keeps `scope.include` always measurable in any compiled package, and makes refusal an honest, reportable thesis outcome rather than a bug. No `spec.md` edit required; no semantics invented. |
| 2026-09-11 | P1.5 | Extracted the CLI failure mapping to `src/cli/errors.ts` (`EXIT`, `USAGE_ERROR_NAMES`, `exitCodeFor`, `fatal`) shared by `index.ts` and `task.ts`; added `BoundaryError` (unusable boundary input) to the usage allowlist. | `forge task`'s own catch mapped an unknown target to exit 4 instead of 2 — the second copy of the mapping had already drifted from the first. One allowlist, one mapping, every command. No behavior change for existing commands. |
| 2026-09-11 | P1.5 | Added `scripts/gen-task-cassettes.ts`, a dev-time generator for the `forge task` CLI fixture cassettes. | Cassette keys cover the fully-rendered prompt, so any prompt change invalidates committed cassettes; regenerating by hand-computing hashes is error-prone. The embedded DraftIR responses are hand-authored machinery fixtures, labelled in-file, and must never be cited as thesis evidence. |
| 2026-09-12 | P1.5 | **AC-025 thesis gate RUN with live Kimi K3 (`moonshotai/kimi-k3` via OpenCode Go). 12/12 extractions (18 live calls, 3 repairs, 3 logged transport retries); 6-task execution comparison (blinded P/Q, shared fixture). Result: 6 ties, 0 wins either side → verdict RECONSIDER.** Full evidence under `evals/results/` (cassettes, packages, IRs, run diffs, `scores.json`, attempt log). | Mechanical application of the pre-registered rule ("no difference → reposition as specification/portability/review tool"). Validity limits recorded in the report: subagent executors failed so the primary agent self-executed (obedient-executor design inflates ties); tiny fixture caused ceiling/floor ties. The `intent.md` repositioning amendment is proposed, not applied — positioning needs human approval. |
| 2026-09-13 | P1.7 | **Thesis reset (docs only, no code).** P1.6 validation returned FAIL (0/8 wins, one over-blocking loss, zero FORGE faults). `intent.md`: retired the structure-beats-raw claim, recorded the auditable-compiler thesis. `spec.md`: AC-025 result note, AOC-1 resolved. `architecture.md`: risk closed, P1.6 over-blocking lesson recorded (§10.2). P2 reframed as resolution + attribution + ambiguity reduction. No invariants weakened; no thresholds changed. | Both trial records (RECONSIDER, FAIL) stand frozen. P2 proceeds only under its repositioned purpose; execution-win comparisons are out of scope as a success measure. |
| 2026-09-14 | P2 | INV-011 enforced by `tests/security/pathjail.test.ts` (AC-011 scan with a documented config-read allowlist) instead of the planned `.eslintrc` rule. | eslint is not installed in this repo (no config, no script); installing the whole linter for one rule costs more than it returns. The test enforces the identical property mechanically and runs in the default suite. The eslint rule arrives if/when eslint lands. |
| 2026-09-14 | P2 | Scope-glob and git-history candidates admit but do not justify: a file under `scope.include` (or recently touched in scope) with no node-query term match is dropped as unjustified with a recorded reason. | INV-006 requires every RETAINED ref to justify itself; scope defines the blast radius (admissibility), not relevance. Letting scope alone justify would reinstate the bloat `C010` exists to catch. `justifies` still comes only from retrieval provenance (rg attribution) or content term evidence (FR-026). |
| 2026-09-14 | P2 | `resolveContext` keeps at most `DEFAULT_MAX_REFS = 50` refs; excess drops are recorded as `over-cap`. | Unbounded retention lets a pathological workspace (50k files, generic terms) produce an unreviewable pointer list. The cap is deterministic, documented, and recorded per drop; the compiler budget remains the semantic gate. |
| 2026-09-14 | P3 | Repair budget raised 1 → 2 (FR-003); the P1.5-era boundary test asserting throw-after-2-calls now asserts throw-after-3 plus a succeed-on-second-repair case. | FR-003 mandates "at most twice" with hard error on the third failure; the P1.5 single-repair budget was an explicit thin slice, not the spec. Strictly more behavior verified, not less. |
| 2026-09-14 | P3 | Repo signals feed the REFINE call only; initial extraction stays workspace-free, and `INTENT_EXTRACT_VERSION` stays "1" (no cassette regeneration). | The P3 flow is extract → resolve → evidence → clarify; grounding the first draft in a listing would trade the P1.5 no-invention discipline for better-looking scope. Base prompt bytes are unchanged so committed keys stay valid; refine keys differ by content. |
| 2026-09-14 | P3 | `forge task` gains `--yes`, `--workspace`, `--file/--justifies`, `--max-refs`; no `--strategy` flag. | FR-001's strategy flag belongs to P4; adding it now would violate CLI-R6 (no flag before its phase). |
| 2026-09-14 | P4 | Overlay intensity renders as `added_verification` nodes (rigorous), not only the scalar `verification_intensity`. | A scalar intensity reaching no section would be dead data; added steps render through the existing verification section via the same node mechanism as constraints. Dimensions stay data-first. |
| 2026-09-14 | P4 | `checkConstraintPreservation` accepts the `introduced_by` map to resolve strategy-origin spans precisely. | A strategy span satisfies only the node whose recorded origin it carries; counting any strategy span as coverage would be theater. Signature is backward compatible (optional param). |
| 2026-09-14 | P4 | Shared `src/cli/ir.ts` consolidates the four copies of `readIr`/`collectFiles` (also touches `task.ts` import only). | The fourth copy (strategies.ts) made consolidation cheaper than duplication; behavior identical, CLI contract green. |
| 2026-09-14 | P4 | New `from_scope_count` deriver alongside arch-specified `from_scope_size`. | `from_scope_size` is token-scale (for `budget_tokens`); deriving a file-count param from it always saturates at max. Count-scale derivation keeps bounds meaningful. |
| 2026-09-16 | V2-0 | **Architecture V2 reconciliation.** Audit found the product and the core do not touch: `web/` imports seven symbols from `forge/dist` and nothing from `src/ir/`, `src/compile/`, `src/critic/`, `src/trace/` or `src/context/`. Reconciled all five canonical documents. Retired: AD-7, the blanket agent-framework ban, the "no web UI" deferral, the unscoped 8-dependency cap, "no server" in NFR-002/PS-R4. Added: spec §22–§23 (`WS-R1`–`WS-R23`, `AC-029`–`AC-038`), architecture §22 and AD-17…AD-22, the V2 phase sequence. Corrected: §13 showed `critic.judge` in the boundary registry; it was never built. Recorded defects not fixed in this pass — broken root `exports` (`dist/index.js` never built), `evals/p16/README.md` still reads "NOT RUN" over a scored FAIL, AC-023 asserts a dependency test that does not exist, no `ModelCallRecord` is persisted by the product, and cassette replay is unreachable from `web/`. |
| 2026-09-16 | V2-A | **`conversation.generate` is registered, not exempt** (AD-22's open question, decided in writing). The boundary governs the `{reply, prompt}` envelope and the WS-R3 action → effect relation, not the prose. Both conversation boundaries are `required: false`, `onFailure: "skip"`. | Governing the cheap classification call while exempting the only call that can *produce* a version was the incoherence AD-22 recorded. Scoping the boundary to the envelope plus the effect makes it post-validatable without pretending prose is checkable. Hard-failing either boundary would turn a model's bad day into a lost turn; skipping degrades to `DISCUSS` / reply-only, and neither path can write a version. |
| 2026-09-16 | V2-A | **Workspace diagnostic codes `FORGE-W001`–`W004` added to the core registry and to `spec.md` §10.2**, rather than a workspace-local finding type. | WS-R4, WS-R5, INV-012 and WS-R3 each require a diagnostic the catalogue did not name. A second, parallel finding system in `web/` would have rendered differently and carried no evidence, and the ownership table says the turn runtime does not own diagnostics. One namespace, one factory, INV-007 enforced for workspace findings exactly as for compile findings. No existing code's `source` changed. |
| 2026-09-16 | V2-A | **AC-036 is asserted over a semantic projection (`semanticSnapshot`), not the conversation file's bytes.** | The file always differs by `updatedAt` between two runs, so literal byte-identity is unachievable and the criterion would be untestable as written. The projection is the existing semantic/run split (§6.3, WS-R9): messages, versions, current pointer, candidates and pending clarification are semantic; timestamps, the event log and the model-call log are run data. Cancelled and failed turns are byte-identical over that projection. |
| 2026-09-17 | V2-C | **The store root is `FORGE_DATA_DIR` (default `./data`), not `.forge/`, and config is `providers.json` + `providers.secrets` rather than `config.json`.** The *layout inside* the root is PS-R1's: `objects/<sha256>.json`, `runs/<YYYY-MM-DD>.jsonl`, `index.sqlite`. | PS-R1 describes the CLI's in-workspace store; the served workspace has used `FORGE_DATA_DIR` since before V2, and renaming the root would strand every existing user's data for a cosmetic match. The split config predates V2-C and exists because WS-R19 requires secrets stored **separately** from configuration — a single `config.json` would violate it. Recorded rather than silently tolerated: if the intent is one literal layout for both, that is a `spec.md` §16 change, not a code change to make here. |
| 2026-09-17 | V2-C | **The index is always rebuilt in full; there is no incremental update path.** | AC-032 compares a rebuilt index against the one it replaced, and in the real product that one would have been built incrementally. An incrementally updated SQLite file and a linearly rebuilt one hold the same rows but not the same bytes — page layout, freelist and the header change counter all differ, and `VACUUM` does **not** converge them (measured, not assumed). With an incremental path the criterion would have held only rebuild-to-rebuild while the file the product actually deletes was incremental: a pass for the wrong reason. Rebuilding is cheap because the log is local and read anyway, and it deletes the whole class of bug where a watermark and the rows disagree. |
| 2026-09-17 | V2-C | **A conversation is folded from its events rather than stored as a record.** `loadConversation` replays the log; `saveConversation` appends only what changed since the load, with the baseline held in a `WeakMap` so it never reaches JSON or the browser. | WS-R17 makes objects plus the log the only truth. A "write the record" path would have been a second source of truth wearing the log as decoration. The public store API was deliberately left unchanged so the V2-A/V2-B suites kept testing conversation semantics — a storage change that forced them all to be rewritten would have made a persistence regression indistinguishable from churn. |
| 2026-09-17 | V2-C | **Message bodies, version text and candidate text are stored as objects, not only attachment payloads.** | WS-R18 names attachments, but the reasoning is identical for the rest: a 200k paste inlined into a JSONL line makes the log unreadable, and identical content should cost one object. A regenerate that produces the same answer now costs nothing. Tests assert no marker payload ever appears in `runs/`. |
| 2026-09-17 | V2-C | **A tail-replacement in the message list is recorded as `messages_truncated` + re-append, found by a failing test.** The first implementation diffed collection *lengths*, which V2-B's regenerate defeats: it drops the trailing assistant message and appends a new one, leaving the length unchanged while the content differs. The baseline now holds the message objects and the divergence point is found by reference equality. | A length diff would have recorded the retry as no change at all, so a regenerated answer would have vanished on the next load — silent data loss, which is the thing this storage model exists to make impossible. |
| 2026-09-17 | V2-C | **Deleting a conversation writes a tombstone; objects and events are kept.** | An append-only log has no way to un-write history (WS-R17), and versions are never deleted (WS-R7). The conversation stops listing and stops loading, which is what the user asked for; nothing is destroyed, which is what the model requires. |
| 2026-09-17 | V2-C | **`src/store/{objects,runlog,index-store}.ts` added to the `tests/security/pathjail.test.ts` allowlist with inline reasons.** | INV-011 governs **context** reads, which must go through `WorkspaceGuard`; the allowlist exists for first-party non-context I/O and already holds the cassette store, which is the same category. No user-controlled string reaches a path segment: object filenames come from a hash validated before any filesystem call (asserted by a traversal test in `tests/store/objects.test.ts`), run-log filenames come from the clock, and the index filename is a constant. The invariant was not relaxed; the rule the test states was followed. |
| 2026-09-17 | V2-C | **WS-R19 was already satisfied and was not rebuilt.** Provider secrets are AES-256-GCM encrypted at rest in `data/providers.secrets` under a scrypt-derived key from `FORGE_APP_SECRET`, separate from `providers.json`, and masked to the browser. | The requirement is in the V2-C set, but the work was done earlier. Re-implementing it to have something to show for the phase would have been churn; the existing hygiene tests cover it and the live smoke re-asserts that no credential appears on any surface. |
| 2026-09-17 | V2-C | **Defect found in the real browser and fixed: the Studio predicted a version number while text was still streaming** ("drafting v7…" for what became v6), and the streamed draft outlived the reload that replaced it. The badge is now unnumbered and the streaming state is cleared before the reload. | The number is not knowable while text is arriving: the WS-R3 check can still block the write and a cancel can discard it, so a predicted number is a claim FORGE has not earned. This is the same class as V2-B's frozen-first-turn defect — invisible to HTTP tests because the routes were correct. |
| 2026-09-17 | V2-C | **`PromptPanel.tsx` was replaced by `PromptStudio.tsx`**, and the flat `web/lib/store.ts` was split into `store-types.ts` plus `store/{events,projector,repository,migrate}.ts`. | The panel was a 400px read-only preview of the thing the product exists to make. The split was forced by the fold: the repository and the public API both need the domain types, and a single file would have been circular. |
| 2026-09-17 | V2-B | **A streamed token is NOT a turn event.** `TurnDelta` travels on the pipeline's stream beside `TurnEvent` but is never appended to the append-only log, so `TURN_EVENT_KINDS` is unchanged from V2-A. | The log is the audit record and the AD-17 checkpointer. A record of every token would multiply a turn's events by a thousand, say nothing the final text does not already say, and make AC-036's semantic comparison depend on how the network chopped the response. Streaming is presentation; the log is truth. One stream carries both, which is still "one mechanism, not two" (WS-R10). |
| 2026-09-17 | V2-B | **Progressive text is read by a new incremental envelope reader in the core** (`createEnvelopeStreamReader` in `src/conversation/generate.ts`), and `parseEnvelope` over the accumulated raw text remains the only thing that decides what the turn produced. | The generation response is a JSON envelope, so streaming raw tokens would show the user `{"reply": "…`. The reader emits only the decoded `reply` and `prompt` fields — a delta has no shape that could name any other key, which is how WS-R11 is enforced against a model that prefixes its answer with reasoning or invents a `thinking` field. Keeping `parseEnvelope` authoritative means a stream that dies mid-object changes nothing about the artifact. |
| 2026-09-17 | V2-B | **`TURN_STAGES` gained `adapting` and `verifying`; `reading_prompt` is now actually emitted** (V2-A declared it and never used it). Labels are the user-facing statuses: "Understanding request…", "Analyzing current prompt…", "Adapting for target…", "Generating prompt…" / "Writing your answer…", "Verifying result…", "Saving…". | WS-R11 asks for stages the user recognises from their own request. `adapting` is skipped for the `generic` target, which adapts to nothing — a stage that is always shown is a spinner with better copy. The generation label differs for read-only actions because claiming to generate a prompt while answering a question is a small lie the UI does not need to tell. |
| 2026-09-17 | V2-D2 | **`intent.extract`'s output budget raised from 4,000 to 16,000 tokens.** Found by the V2-D live smoke: against Kimi K3 through the OpenCode Zen gateway, a 13.8k-character extract prompt spent 3,287 reasoning tokens of a 4,000-token budget and returned a truncated body; a slightly longer one returned an empty body. The same call completes in ~3,200 completion tokens with the ceiling out of the way. | Reasoning tokens are billed against `max_tokens` on every OpenAI-compatible endpoint, so a budget sized for the JSON leaves nothing for the JSON. The defect is pre-existing — V2-C's `/analyze` route fails identically — but V2-D2 is the first phase to put `intent.extract` on a path the product needs, so it could not be left. `MAX_TOKENS` is not part of the cassette key (boundary id + version + rendered prompt), so every committed recording stays valid, and a higher ceiling costs nothing on a call that succeeds. |
| 2026-09-17 | V2-D2 | **The OpenAI-compatible provider now reports `finish_reason: "length"` as what it is** — the token budget, with the reasoning-token count when the endpoint supplies it — instead of "returned no message content". | INV-012: no silent degradation, and a diagnostic that names the wrong cause is worse than a vague one. "No message content" sent a reader looking for a broken key or a wrong model id for a call that had simply run out of room. Covered by two cases in `tests/contract/transport.test.ts` against a loopback gateway. |
| 2026-09-17 | V2-D1 | **A ledger with no prompt version yet reports nothing rather than reporting every entry as dropped.** | `checkLedger` defaulted the missing version's text to `""`, which made every pinned requirement "absent from version 0" — a preservation failure claimed against a prompt that does not exist. An empty result says the honest thing: nothing has been checked (WS-R27.2). |
| 2026-09-17 | V2-D2 | **The live smoke's V2-D section pins text taken from FORGE's own deterministic proposals, and reports INCONCLUSIVE — not a pass or a fail — when a real model declines to revise or keeps the pinned words.** | The first live run pinned a phrase from the original *request* and failed because the model had worded the prompt differently: that measured the model's vocabulary, not the ledger. Whether a model chooses to revise, and whether its rewrite happens to retain a sentence, are model behaviours rather than FORGE's contract; scoring them either way would make the check say nothing while looking like it said something. |
| 2026-09-17 | V2-D1 | **Two new diagnostic codes were added to `spec.md` §10.2 before any code was written: `FORGE-W005` (`pinned_requirement_dropped`, error, deterministic) and `FORGE-W006` (`semantic_drift`, warning, judged).** | V2-D2 required "a new code with `source: \"judged\"`" and D1 required an error-severity deterministic diagnostic; neither existed in the catalogue. The registry transcribes §10.2, so the specification had to change first. They are separate codes precisely so no surface can render a guarantee and a piece of advice under one code (WS-R28). |
| 2026-09-17 | V2-D1 | **The presence rule WS-R25 requires to be "published" is now published, in `spec.md` §22.8**: a pinned requirement is present when its normalized token sequence occurs contiguously in the version's — NFKC, case-folded, non-alphanumerics as separators. | WS-R25 demands a published, reproducible rule and the specification named none. Reformatting therefore never breaks a match and a paraphrase always does, which is the correct division of labour: a paraphrase is Layer 2's subject. Written into the spec rather than only into code so the guarantee is a contract rather than an implementation detail. |
| 2026-09-17 | V2-D1 | **Pin candidates are proposed by a fixed text rule (`proposeRequirementCandidates`), not by a model.** | WS-R24 permits FORGE to *propose*. Proposing through a model would have put a model path adjacent to the ledger, and the point of Layer 1 is that no such path exists. The user still promotes every candidate by hand. |
| 2026-09-17 | V2-D1 | **The turn pipeline takes a ledger fingerprint before the first model call and refuses the turn (`LedgerTamperedError`) if it differs afterwards.** | AC-042 is asserted adversarially, but "no model path can reach the ledger" is a property worth enforcing as well as testing. Nothing in the pipeline writes to the ledger, so the tripwire is unreachable in ordinary use — it exists so that a future change that made it reachable would fail loudly rather than quietly. A hard error beats a plausible wrong answer. |
| 2026-09-17 | V2-D1 | **A dropped pinned requirement does not withdraw the version; it reports.** | Versions are immutable and never removed (WS-R7), and suppressing the revision would hide the evidence of what the model did. INV-012 asks for a loud diagnostic, not a silent rollback. |
| 2026-09-17 | V2-D1 | **The pinned ledger is part of `semanticSnapshot`.** | WS-R24 calls a pinned requirement semantic content, so it belongs to the part of a conversation AC-036 compares byte for byte. A cancelled turn that changed the ledger would otherwise compare as unchanged. |
| 2026-09-17 | V2-D1 | **The offline stub model now preserves the current prompt and appends, unless the user's message asks for a removal.** | The old stub replaced the whole prompt every turn, which made a *preserving* revision unreachable offline and so made half of the V2-D acceptance untestable without a network. The new behaviour is a property of the instruction, not a switch FORGE flips: a real model asked to remove something removes it, and asked to add something keeps what is there. |
| 2026-09-17 | V2-D2 | **Layer 2 is opt-in per version pair over its own route (`POST /api/conversations/:id/preservation`), not background work attached to a turn.** | WS-R29 allows opt-in or background and forbids blocking a revision; an opt-in request is the version of that which cannot accidentally become a third and fourth model call on the critical path (WS-R13). It also makes AC-040 true by construction: the turn has no judged layer to switch off. |
| 2026-09-17 | V2-D2 | **Drift citations resolve against a deterministic rendering of each version's IR statements, returned with the report.** | DG-R4 requires a judged finding whose citation does not resolve to be discarded. A citation into the prompt text would not resolve — an extracted statement is a paraphrase of the prompt, not a quote from it — so the evidence points at a reproducible rendering of the stored IR, and the report hands the reader the rendering to check it against. Findings whose spans do not resolve are dropped silently. |
| 2026-09-17 | V2-D2 | **Statements covered by a pinned entry are skipped by the drift check entirely (`skippedPinned`).** | WS-R26 scopes Layer 2 to changes "without being pinned". It also keeps the layers from appearing to disagree about the same requirement, which is the shape WS-R27 exists to prevent — a user seeing an advisory "looks fine" beside a deterministic "missing" would have to decide which to believe, and that decision is not theirs to make. |
| 2026-09-17 | V2-D2 | **`preservationResult` refuses to build a result whose judged half carries a deterministic code, or the reverse (`LayerConfusionError`).** | WS-R27 is four sentences that are easy to agree with and easy to violate with one `concat`. The module that holds both layers deliberately offers no merge operation, and rejects the one construction that would let a judged finding impersonate the guarantee. |
| 2026-09-17 | V2-D2 | **A Layer 2 failure returns Layer 1 unchanged with `driftError` set, at HTTP 200.** | WS-R27.3: Layer 1 reaches its verdict whether or not Layer 2 ran. Reporting the advisory failure as a failure of the whole request would have made the deterministic guarantee depend on the fuzzy layer's availability — the precise inversion the ordering exists to prevent. Found for real: the first stub extraction emitted an invalid deliverable kind, and the route answered with Layer 1 intact and the advisory half reported as absent. |
| 2026-09-17 | V2-B | **Retry is a `regenerate` flag on the turn, not a new route or a mutated version history.** The pipeline drops trailing assistant messages and re-runs the last user message without re-appending it; a regenerated `REVISE` adds a **new** version rather than replacing the old one. | Versions are immutable and never deleted (WS-R7), so "replace v2" is not available and should not be simulated. The chat reads as one exchange because the superseded answer is dropped; the prompt history reads as two attempts because that is what happened. The server chooses which message to re-run rather than trusting the client to echo it back. |
| 2026-09-17 | V2-B | **The streaming client falls back to the whole-response route only on a 404.** A 2xx whose content-type is not `text/event-stream` is an error, not a retry. | The original fallback retried on any non-SSE response, which meant a proxy that rewrote the content-type would run the turn a second time and write two versions for one request. A 404 is the only status that proves the turn did not start. |
| 2026-09-17 | V2-B | **Defect found in the real browser and fixed: the first turn of a conversation rendered the welcome screen while a request was in flight**, so the stage line, elapsed clock and Stop button did not exist and the user's own message was not echoed until the turn finished. `ChatPanel` now leaves the welcome branch as soon as a turn starts, and the sent message is shown optimistically. | This was the exact "appears frozen" failure V2-B exists to remove, and it was invisible to every HTTP test because the routes were correct — only a browser could see it. Recorded because it is the second time the product suite was green over a user-visible product defect, which is the reason the testing standard has a browser tier at all. |
| 2026-09-17 | V2-B | **`web/lib/turn/deps.ts` and `web/lib/turn/http.ts` extracted from the messages route**, and `web/scripts/live-smoke.mjs` added. | V2-B gave the product a second turn entry point. AD-19 is explicit that streaming and cancellation must not be implemented twice, and Next.js route files may only export handlers, so the shared half had to leave the route. The smoke script is the opt-in live tier the testing standard requires and never prints a credential. |
| 2026-09-16 | V2-A | **The classifier sees at most the first `CLASSIFY_MESSAGE_LIMIT` (20k) characters of a message.** Found by the HTTP E2E suite: a 24k paste made `ClassifyInputSchema.parse` throw *outside* the degradation path, failing the whole turn with a 502. | A 200k paste against a 20k boundary schema is a real user action, and classifying it whole would blow the WS-R13 budget to choose between ten labels. The head is bounded and deliberate. The parse also moved inside the degradation path, so any classification-side failure degrades to `DISCUSS` per WS-R4 instead of losing the turn. |
| 2026-09-16 | V2-A | **`RESTORE` is executed deterministically** — the pointer moves, a `current_version_moved` event is recorded, and no generation call is spent. | WS-R7 says RESTORE moves the current pointer and records that it did; nothing about it needs a model. It also keeps the turn inside the WS-R13 budget with a call to spare. |
| 2026-09-16 | V2-A | **`web/lib/chat.ts`'s `parseChatReply` now delegates to the boundary's `parseEnvelope`**, and `analyzePrompt` returns its `ModelCallRecord` so `/analyze` can persist it. | Two envelope parsers would drift. The analyze route was making a real model call and recording nothing, which is the `WS-R14` failure exactly ("auditability that is claimed but not persisted is not auditability"). |
| 2026-09-16 | V2-0 | **Correction — requirement preservation is BOTH layers, ledger first.** The first pass recorded only the judged per-version-IR check, with a user-pinned ledger as a fallback if its false-alarm rate proved unacceptable. Corrected on the owner's decision: the **user-pinned ledger is Layer 1** — deterministic, model-free, authoritative — and **judged semantic drift is Layer 2**, advisory only. Added `WS-R24`–`WS-R29` and `AC-039`–`AC-043`; split V2-D into D1 (ledger) before D2 (drift). `WS-R27` makes it a specification violation for the judged layer to suppress, downgrade or stand in for the pinned layer, for its silence to be read as survival, or for any model-originated path to mutate the ledger. | The guarantee must not rest on a model's paraphrase. Ordering the fuzzy layer first would have made the product's central promise only as trustworthy as an extraction call. |
| 2026-09-18 | V2-E | **A fourth model boundary, `conversation.candidate`, is registered.** `CLAUDE.md` and `docs/architecture.md` said the registry held three. It now holds four, and the enumeration test asserts the new list. | `MB-R1` admits no ungoverned language-model invocation, and generating an alternative prompt is one — so this is the specification being followed, not an extension of it. It satisfies all eight properties including a dedicated test file, and governs what AD-22 says a conversation boundary governs: the envelope, plus two deterministic relations (a candidate carries a prompt; a candidate is not the base reworded). It carries **no `action`**, which makes `WS-R2` structural on this path — the boundary has no action to write a version under. `critic.judge` is still unbuilt, for V2-D's reason: nothing here asks a model for a finding. |
| 2026-09-18 | V2-E | **`MERGE` is deterministic and has no model in it.** `src/candidate/merge.ts` is a union of paragraph blocks keyed by the ledger's published normalization, in first-appearance order. | What a user must believe about a merge is that nothing either candidate said was lost, and that belief is worth what the mechanism is worth. A model-authored merge would make it as good as a generation call — the inversion `WS-R27` exists to forbid. The guarantee is recorded **bounded**, not generous: every block of every source reaches the result, and the first source keeps its order and adjacency, so a requirement contiguous in it stays contiguous; a later source's block the first already had is emitted at the first's position, which can separate two of that later source's blocks. Layer 1 runs over the merged text before the version is written, so that residual is reported rather than silent (`INV-012`). |
| 2026-09-18 | V2-E | **Distinctness is checked twice, by two different kinds of rule.** §11.5's overlay gate decides which archetypes may both produce candidates and is returned as evidence; a new **token-sequence equality** check (`FORGE-W007`) rejects two candidates whose prose is the same. Divergence between survivors is reported as a count of differing blocks and is never a gate. | §11.5 compares structures, and a model can return identical prose under two different structures — the gap is real. It is closed with *equality* rather than a similarity threshold on purpose: a threshold deciding which alternatives a user sees would be a judgement wearing a mechanism's clothes, and `INV-008` forbids the composite score a gate would need. This is not a second strategy system: no new archetypes, no free-form strategy, no model asked to invent variety. |
| 2026-09-18 | V2-E | **`PromptCandidate` gained `origin`, `rationale` and `score`; `Conversation` gained `candidatePromotions`.** New event kind `candidate_promoted`; `candidate_added` gained three fields; the `candidate` index table gained three columns and a `candidate_promotion` table was added. Pre-V2-E records fold with `origin: "archetype"`. | `ST-R7` requires the open origin enum, `ST-R6` requires the deciding rule to be presented and **the choice to be recorded**, and a candidate with no provenance cannot be audited. A promotion is a separate append-only list rather than a field on the candidate because a candidate may be promoted more than once and nothing already written may be edited (`WS-R7`, `WS-R17`). `origin` is the only value `ST-R7` admits in v0.1, so the fold of an older record states a fact rather than a default. |
| 2026-09-18 | V2-E | **`semanticSnapshot` now includes each candidate's `strategy` and `origin`, and the promotion list.** | `WS-R9` calls strategy and derived structure semantic. A conversation whose candidates changed provenance, or which gained a promotion, is not the same conversation, and `AC-036` compares exactly this projection — leaving them out would have made a cancelled turn that changed either of them compare as unchanged. Both sides of every comparison use the same function, so nothing is weakened. |
| 2026-09-18 | V2-E | **Found by the live smoke and fixed: the candidate output budget was 4000 and a single failure lost the whole request.** The budget is now 12000, and a transport or envelope failure on one archetype drops that alternative with a recorded diagnostic while the rest generate; when **every** archetype fails the original error is re-thrown. | The first live run against Kimi K3 returned `hit the 4000-token output budget before finishing … 4000 of them were reasoning tokens` and the request failed with zero candidates. A candidate is a **full rewrite** of the prompt under an overlay, not a chat reply, and on a reasoning model the thinking comes out of the same budget — 4000 was a budget defect, not a model one. The per-archetype degradation is `MB-R3`'s `skip`, recorded (`INV-012`); re-throwing when nothing survives is deliberate, because an empty set returned as a success reads as "the model had no alternatives to offer", which is not what happened. This is the rule working: a mock passing is not a feature working. |
| 2026-09-18 | V2-E | **`GenerateOptions` carries an optional `complete` transport seam**, and `promoteCandidate` refuses a candidate whose text is already the current prompt. | The seam is the same one `TurnDeps.complete` gives the turn pipeline, and it is what let the failure paths above be tested with no network *before* a live run found them for a user. The refusal is `WS-R7` applied to a no-op: promoting the prompt that is already current would append a byte-identical version, and a history that records changes which are not changes is a worse record. |
| 2026-09-18 | V2-E | **`checkRequirementLedger` gained a fourth parameter, `subject`, and the AC-040 arity assertion was replaced with a stronger one.** The parameter is a string naming what was checked; it defaults to `version <v>`, and the evidence measure becomes `derived_from_version` rather than `dropped_in_version` when it is supplied. | V2-E runs Layer 1 over **candidates**, which are not versions. Reporting one as "absent from version 1" is a false statement about a version that does contain the requirement, and `INV-012` is about diagnostics a reader can trust, not merely diagnostics that exist. The rule, the tokenization and the verdict are untouched. The existing test asserted `checkRequirementLedger.length === 3` as a proxy for "no judged input can reach the verdict"; the proxy was replaced, **not weakened**, by asserting the property directly — a whole judged report stringified into the new parameter produces byte-identical findings, codes, severities and sources. That is strictly more than arity ever said. |
| 2026-09-18 | V2-E | **`addPromptVersion`'s `turnId` is now optional**, and promotion and merge omit it. | `WS-R7` records the turn that produced a version, and promoting or merging a candidate is a direct user action, not a turn. The first implementation wrote `randomUUID()` there, which is a reference into the append-only event log that resolves to nothing — a dangling reference of exactly the kind `FORGE-C090` exists to catch elsewhere. `turnId` was already documented as absent on pre-V2 records, so absence was already representable; the action is still recorded. |
| 2026-09-18 | V2-E | **Found by the live smoke and fixed: candidate generation ran its archetype calls sequentially and the request timed out.** The calls now run concurrently (`Promise.allSettled`), and their results are consumed in fit order so the run log, the diagnostics and the candidate list stay deterministic. | Three 12000-token reasoning calls in one request took longer than five minutes, and the client aborted with `UND_ERR_HEADERS_TIMEOUT` — no candidates, no usable error. It reproduced twice, once as an empty body and once as the raw timeout. The calls are independent by construction (one per overlay, none reading another's answer), so serializing them bought nothing and cost the sum of their latencies. Raising the client timeout was rejected: it would move the wall rather than remove it, and a real browser would still give up. Concurrency is asserted offline — a transport that records overlap and answers in a deliberately awkward order proves both that more than one call is in flight and that the returned order is fit order, not completion order. |
| 2026-09-19 | V2-E | **Found by the live candidate smoke (OpenRouter, `nvidia/nemotron-3-ultra-550b-a55b:free`) and fixed: the candidate generator never told the model which requirements were pinned.** Each candidate request now carries a `PINNED REQUIREMENTS` block listing every ledger text with an instruction to keep it word for word. | The model kept the *meaning* of the pinned "It must read the full diff before judging" in all three candidates but reworded it ("Read the complete diff"), and Layer 1 — correctly — reported `FORGE-W005` on every one. The generator was enforcing a verbatim rule it never stated. The check itself is unchanged and still decides; the texts are user-authored ledger entries already present in the prompt being rewritten, and nothing lets the model edit them (`WS-R24`, `WS-R27.4`). Re-run: pinned requirement present, verbatim, in every returned candidate. Asserted offline by capturing every candidate request. |
| 2026-09-19 | V2-E | **Found by the same run and fixed: `GET /candidates` still reported a candidate's dropped pin as "absent from version 1".** All candidate Layer 1 checks now go through one helper, `candidatePreservation`, which names the candidate. | The 2026-09-18 fix covered generation and comparison but missed the list route, so the Studio could state that a version dropped a requirement the version in fact contains. One helper for every surface removes the chance of a fourth copy drifting. |
| 2026-09-20 | V2-E | **Found by the V2-E live acceptance run and fixed: candidate generation chose its transport from the PROVIDER's kind instead of the MODEL's documented protocol.** `web/lib/candidates.ts` now resolves through `resolveCall` + `transportFor` — the same pair the turn pipeline (`web/lib/turn/deps.ts`) and the connection test already used — in place of `getEffectiveProvider` + `callHeaders`. | OpenCode Go's provider kind is `openai-compat`, so every candidate call went to `/chat/completions`. That is correct for 17 of its 29 models and **wrong for the 12 that speak `anthropic-messages` or `responses`**; the gateway answered the wrong path with `HTTP 503` and an empty body, giving three failed archetypes and zero candidates. It survived five prior live runs only because every one of them used `kimi-k3`, which *is* chat-completions. The connection test passed throughout, because it was the one path already routing correctly — **a connection test passing is not the feature working**, which is `TS-R1`'s rule in a new place. Locked out by `tests/product/opencode-routing.test.ts`, whose stated purpose is exactly this defect class: a fetch-level assertion that two requested alternatives produce two calls to `/messages` and none to `/chat/completions`, verified RED before the fix and GREEN after. The same change also replaces a fresh `randomUUID()` session header per call with the conversation id the gateway documents, which that file's defect 3 already forbade elsewhere. |
| 2026-09-21 | V2-R | **`claude-design` does not refuse the current prompt, and the plan's real-app check assumed it would.** The check was written as "compile for kiro and claude-design; confirm claude-design refuses with `FORGE-C030`". Refusal is a property of the **IR**, not of the target: `run_tests` and `shell` are soft (`degrade.command_to_manual` compensates), so their absence degrades rather than refuses. The first parity test asserted a refusal on those and failed correctly. Verified instead on `fs_write`, which has no compensating rule — `claude-design` refuses it with `FORGE-C030` and zero artifacts, both in-process and through `forge explain` on `evals/results/ir/T01.json`. | The approved check named the wrong capability. Recording the correction rather than restating the check as if it had passed. |
| 2026-09-21 | V2-R | Added `STUB_UNREADABLE_SENTINEL` to `web/lib/turn/deps.ts`, a message marker that makes the stub answer with prose instead of an envelope. | R4 requires a turn that emits `FORGE-W003` to render it in the chat surface, and the stub always returned a well-formed envelope. Without the sentinel the only way to see a degraded turn is a live provider misbehaving, which no test can arrange. The sentinel drives the **real** degradation path in `pipeline.ts` rather than mocking it. |
| 2026-09-21 | V2-R | Added `FR-051` and `FORGE-C103 redundant_line_suppressed` (info, deterministic) to `spec.md`, which the approved plan implied ("every suppression carries a diagnostic") but did not name. Specification changed first; the step-4 cross-check test then caught the registry lagging by one commit, which is what it was written for. | `INV-012` admits no silent removal and no existing code fit — `C011` is context-specific and `C061` is budget-specific. Inventing a workspace-local finding type instead would have rebuilt the parallel diagnostic system V2-A explicitly rejected. |
| 2026-09-21 | V2-R | **Compaction's measured yield is 0.2%** (18,710 → 18,681 words across twelve eval IRs × three profiles; T04 615→615, T07 403→403, T12 557→557), against a 30% target. No guard was loosened and no category widened to raise it. | The target was declared a non-gate in advance, and the gap is a design consequence rather than an implementation shortfall: the audit had already established that most repetition is **model-authored paraphrase**, and the approved whitelist fires only on near-verbatim restatement. Widening it to catch paraphrase is exactly what would put R5 — no presence verdict may change — at risk. Carried into V2-I as bounded, gated prompt work. |
| 2026-09-21 | V2-F | **`semantic_id` now covers the requirement manifest** (`PK-R3` amended, `AC-046` sharpened). Closure audit before V2-G. | The first V2-F text excluded `requirements.json` as "a record, not a compiler input". The acceptance run then showed a pinned workspace package and an unpinned CLI package for the same IR on `kiro` sharing one `semantic_id` while `requirements.json` and `package.json` differed. That breaks `INV-005` (one semantic input tuple, one set of semantic bytes), and it would have broken `EV-R2` in V2-G: evidence is bound by `semantic_id`, so evidence for one contract would bind silently to the other. The exclusion also made "tampering remains detectable" false: `package.json` is anchored by nothing, so rewriting `requirements.json` (for example, promoting `inferred` → `user_stated`, which `RQ-R3` forbids) and updating its listed hash left a self-consistent package under the same id. Fix: one field, `requirement_manifest` (the canonical hash of the manifest value, not the ledger, so storage keys never reach identity), added to `semanticIdInputs`. No layout, schema or format change. Every `semantic_id` changes value, including for unpinned packages; V2-F was unreleased, so `PACKAGE_FORMAT_VERSION` stays `1.0`, and `evals/v2f/example-package/` was regenerated. The test that asserted the old behaviour (`does not cover the requirement manifest`) was replaced by its inverse plus an `INV-005` property test (one id → one set of semantic bytes, across ledger variations). The parity suite gained a test with truly equal inputs: a pinned conversation, with its ledger handed verbatim to the CLI-side assembly, is byte-identical on every profile. |

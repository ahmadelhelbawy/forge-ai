# FORGE — Architecture

> **Authority:** this document owns *how* FORGE is built — structures, algorithms,
> boundaries, and the rationale behind each decision.
>
> - *Why* → [`../intent.md`](../intent.md)
> - *What must be true* → [`../spec.md`](../spec.md) — **authoritative for requirements**
> - *In what order* → [`../plan.md`](../plan.md)
>
> Requirements are referenced by id (`FR-nnn`, `NFR-nnn`, `INV-nnn`, `AC-nnn`) rather
> than restated. Where this document contradicts `spec.md`, **this document is wrong**.
>
> **Status:** P0, P1, P1.4, P1.5, P1.6, P2, P3, P4 implemented and verified.
> P5 and P6 not started. A conversational workspace (`web/`) shipped outside this
> document; §22 reconciles it, and AD-17…AD-22 record the decisions it forced.
> **IR version:** 1.0 (frozen at P3) · **Architecture revision:** 4

---

## Table of contents

1. [System architecture](#1-system-architecture)
2. [The two-layer model: semantic vs run](#2-the-two-layer-model-semantic-vs-run)
3. [Canonicalization and hashing](#3-canonicalization-and-hashing)
4. [Task IR design](#4-task-ir-design)
5. [Trust resolution and instruction provenance](#5-trust-resolution-and-instruction-provenance)
6. [Agent capability model](#6-agent-capability-model)
7. [Compiler stages](#7-compiler-stages)
8. [Rendering: section emitters and artifact topology](#8-rendering-section-emitters-and-artifact-topology)
9. [TraceOrigin and the provenance graph](#9-traceorigin-and-the-provenance-graph)
10. [Context engine](#10-context-engine)
11. [Strategy overlay architecture](#11-strategy-overlay-architecture)
12. [Diagnostics engine](#12-diagnostics-engine)
13. [Model boundary registry](#13-model-boundary-registry)
14. [Execution Package format](#14-execution-package-format)
15. [Persistence](#15-persistence)
16. [Security boundaries](#16-security-boundaries)
17. [Extension architecture](#17-extension-architecture)
18. [Build vs Integrate vs Defer](#18-build-vs-integrate-vs-defer)
19. [Repository architecture](#19-repository-architecture)
20. [Deterministic controls: hooks and lint rules](#20-deterministic-controls-hooks-and-lint-rules)
21. [Architecture decision records](#21-architecture-decision-records)
22. [Revision 2 changelog](#22-revision-2-changelog)
23. [Risks](#23-risks)

---

## 1. System architecture

```
  natural language ──┐
                     │
        ┌────────────▼──────────────────────────────────────┐
        │  MODEL BOUNDARY: intent.extract      [§13]        │
        │  Zod in/out · post-validated · replayable         │
        │  repair ×2 → hard fail. Never guesses.            │
        └────────────┬──────────────────────────────────────┘
                     │ DraftIR (no identity, no provenance)
        ┌────────────▼──────────────────────────────────────┐
        │  CLARIFY  (deterministic)                         │
        │  blocking → ask; non-blocking → assumption        │
        └────────────┬──────────────────────────────────────┘
                     │
  hand-authored IR ──┤  (FR-005: this entry point needs no model at all)
                     │
   ┌═════════════════▼══════════════════════════════════════════════════════┐
   ║  TASK IR  — canonical · provider-independent · content-addressed        ║
   ║  SEMANTIC LAYER ONLY: no timestamps, no scores, no compile decisions    ║
   ║  objective · goals · constraints · non_goals · scope · verification     ║
   ║  deliverables · assumptions · open_questions · required_capabilities    ║
   ║  context_refs · risk        every instruction node carries source_ref   ║
   └═══════┬══════════════════════════════════════════════════┬═════════════┘
           │                                                  │
  ┌────────▼──────────┐                          ┌────────────▼─────────────┐
  │  CONTEXT ENGINE   │                          │  STRATEGY GENERATOR      │
  │  §10 · no model   │                          │  §11 · no model          │
  │                   │                          │                          │
  │  per-node queries │                          │  archetypes (YAML data)  │
  │    ↓              │                          │      ↓                   │
  │  justifies falls  │                          │  deterministic fit rules │
  │  out of retrieval │                          │      ↓                   │
  │  provenance       │                          │  bounded param derivation│
  │                   │                          │      ↓                   │
  │  WorkspaceGuard   │                          │  distinctness gate       │
  │   path jail       │                          │      ↓                   │
  │   ignore rules    │                          │  StrategyOverlay         │
  │   deny globs      │                          └────────────┬─────────────┘
  │   secret scan     │                                       │
  │   trust assign    │                          overlay ⊕ IR = EffectiveIR
  └────────┬──────────┘                                       │
           │ ranked, justified ContextRefs                    │
           └──────────────────┬───────────────────────────────┘
                              │
   ┌══════════════════════════▼════════════════════════════════════════════┐
   ║  COMPILER  — pure · deterministic · zero model calls        §7        ║
   ║                                                                       ║
   ║  ① LOWER        IR ⊕ overlay → EffectiveIR; record introduced_by      ║
   ║  ② LEGALIZE     required_capabilities ∩ profile.capabilities          ║
   ║                 hard gap  → C030, REFUSE                              ║
   ║                 soft gap  → named degradation rule + C031             ║
   ║  ③ MATERIALIZE  by_reference | by_value | summary                     ║
   ║                 driven by profile.retrieval.autonomous_search         ║
   ║                 untrusted → fenced; secrets → redacted                ║
   ║  ④ BUDGET       pinned tokenizer; goals/hard constraints undroppable  ║
   ║                 every drop → C061 with reason                         ║
   ║  ⑤ RENDER       section emitters ∘ profile artifact topology    §8    ║
   ║  ⑥ TRACE        byte-level spans → typed TraceOrigin            §9    ║
   └══════════════════════════┬════════════════════════════════════════════┘
                              │
   ┌══════════════════════════▼════════════════════════════════════════════┐
   ║  DIAGNOSTICS  — coded findings with evidence, never a score     §12   ║
   ║  deterministic (baseline, always on)                                  ║
   ║  judged (optional, off by default) → citations must resolve or drop   ║
   ║  lexicographic ranking; the deciding step is named                    ║
   └══════════════════════════┬════════════════════════════════════════════┘
                              │
   ┌══════════════════════════▼════════════════════════════════════════════┐
   ║  EXECUTION PACKAGE                                              §14   ║
   ║  ┌──────────────────── SEMANTIC (hashed → semantic_id) ────────────┐  ║
   ║  │ package.json · task-ir.json · strategy.json · artifacts/        │  ║
   ║  │ trace.json · provenance.json · runtime-contract.json            │  ║
   ║  │ verification.json · diagnostics.json                            │  ║
   ║  └─────────────────────────────────────────────────────────────────┘  ║
   ║  ┌──────────────────── VOLATILE (never hashed) ────────────────────┐  ║
   ║  │ run.json — run_id, timestamps, latency, model identity, scores  │  ║
   ║  └─────────────────────────────────────────────────────────────────┘  ║
   └══════════════════════════┬════════════════════════════════════════════┘
                              │
              ╔═══════════════▼════════════════════════════╗
              ║   ── HARD BOUNDARY · NOT BUILT (INV-004) ──  ║
              ║   executor: worktrees, containers, agent    ║
              ║   launch, loops, result evaluation          ║
              ╚════════════════════════════════════════════╝
```

**Model participation in v0.1:** one required boundary (`intent.extract`) and one optional
boundary (`critic.judge`, off by default). Everything between the IR and the package is a
pure function. See §13 and `spec.md` §14.

---

## 2. The two-layer model: semantic vs run

This section resolves the central contradiction in architecture revision 1, which
simultaneously claimed byte-identical packages and stored `created_at` / `retrieved_at`
inside the hashed object.

### 2.1 The rule

Every FORGE object is split into two layers:

| | **Semantic layer** | **Run instance layer** |
|---|---|---|
| Contains | What the task *is* | What one execution *did* |
| Examples | goals, constraints, scope, trust, `source_ref`, context `content_hash`, rendered artifact bytes | `run_id`, timestamps, latency, model identity, retrieval scores, retriever id, host metadata |
| Canonical | yes | no |
| Hashed | **yes** | **never** (INV-013) |
| Reproducible | byte-identical across runs and machines | expected to differ every run |
| Stored in | `task-ir.json`, `strategy.json`, `artifacts/`, `trace.json`, `provenance.json`, `package.json` | `run.json`, `.forge/runs/*.jsonl` |

**Determinism is achieved by this separation, not by freezing the clock** (`TS-R3`).
A test that stubs `Date.now()` would hide precisely the defect this design exists to
prevent: volatile data leaking into a hashed structure.

### 2.2 Why timestamps left the IR

Revision 1 placed `created_at` and `provenance.model_calls[].at` inside `TaskIR` and
excluded them from hashing via a denylist. Three problems:

1. **The denylist is fragile.** A future field is hashed by default; a volatile field
   added carelessly silently breaks reproducibility. → Fixed by an **allowlist
   projection** (INV-015).
2. **The object was dishonest.** A "canonical" object containing non-canonical fields
   invites exactly the confusion that produced the contradiction.
3. **It conflated two provenance kinds.** `source_ref` and trust *change compiler
   behavior* and must be hashed. Model latency does not and must not.

So: **semantic provenance stays in the IR and is hashed; operational provenance moves to
the run instance and is not** (`spec.md` §12.1).

### 2.3 Three identities

| Identity | Derived from | Purpose |
|---|---|---|
| `TaskIR.semantic_hash` | The IR's semantic projection | Task identity. Two IRs with the same hash are interchangeable. |
| `Package.semantic_id` | The semantic input tuple (§3.3) + every artifact's `content_hash` | Compilation identity. Enables caching and the determinism test. |
| `Run.id` | UUIDv7 — time-ordered, **never content-derived** | Execution identity. Sortable, joinable to logs. |

A `semantic_id` collision means the same compilation; a `run_id` collision is a bug.

### 2.4 The determinism test

No mocked clock. Compile twice, on different days if desired:

```
diff -r pkg-a pkg-b --exclude=run.json   # must be empty
```

Plus: `run.json` must differ between the two (proving the volatile layer is real and not
accidentally frozen). Both assertions together are `AC-005`.

---

## 3. Canonicalization and hashing

### 3.1 Canonical form

Rules (`IR-R12`), chosen so that serialization is stable across platforms and Node
versions:

- Object keys sorted lexicographically by UTF-16 code unit, recursively.
- **Array order preserved.** Order is semantic: `goals` carries author priority,
  `context_refs` carries rank, `verification` carries execution order.
- `undefined` properties dropped; `null` preserved and meaningful.
- Non-finite numbers and `BigInt` rejected — JSON has no honest representation.
- `-0` normalized to `0`.
- UTF-8; no insignificant whitespace.
- Line endings in artifact content normalized to `\n` before hashing (`NFR-009`).
- Path separators normalized to `/` in all URIs and topology paths.

### 3.2 Allowlist projection

```ts
// The projection is the ONLY thing hashed. A newly added IR field is
// invisible to hashing until it is deliberately listed here (INV-015).
const IR_SEMANTIC_FIELDS = [
  "ir_version", "objective", "goals", "constraints", "non_goals", "scope",
  "required_capabilities", "context_refs", "assumptions", "open_questions",
  "verification", "deliverables", "risk",
] as const;

// Within a ContextRef, only these are semantic. Everything else
// (score, retriever, retrieved_at, bytes, est_tokens) is run-instance data.
const CONTEXT_REF_SEMANTIC_FIELDS = [
  "id", "uri", "role", "trust", "justifies", "content_hash",
] as const;
```

A test asserts that adding an unlisted field to a fixture leaves its hash unchanged
(`AC-008`). This inverts revision 1's failure mode: the safe default becomes *excluded*.

### 3.3 The semantic input tuple

Determinism holds over exactly this tuple (`IR-R14`):

```
( TaskIR.semantic_hash,
  StrategyOverlay.semantic_hash,
  AgentProfile.id + AgentProfile.version,
  forge_compiler_version,
  ir_version,
  tokenizer_id + tokenizer_version,
  { ContextRef.id → content_hash } )
```

**Why the tokenizer is in the tuple.** Budgeting (§7 stage 4) can drop context, which
changes rendered bytes. A tokenizer change is therefore a semantic change. Pinning it and
recording it is the only honest way to claim reproducibility — `NFR-009` would otherwise
be false in a way no test would catch.

**Why `content_hash` and not file paths.** A package compiled against a dirty tree must
not silently match one compiled against a clean tree. Content hashes make the dependency
explicit; `runtime-contract.json` additionally pins the commit and dirty flag (`AOC-8`).

### 3.4 Hash format

`sha256:<64 lowercase hex>` everywhere, for both content-addressed objects and semantic
hashes. One format, one validator, no ambiguity about what a hash string denotes.

---

## 4. Task IR design

Full field list and requirements: `spec.md` §6. This section covers structure and the
non-obvious choices.

### 4.1 Node identity

Ids are strictly `^<prefix>[0-9]+$`:

| Prefix | Node |
|---|---|
| `g` | goal |
| `c` | constraint |
| `n` | non-goal |
| `ctx` | context reference |
| `a` | assumption |
| `q` | open question |
| `v` | verification |
| `d` | deliverable |

Strictness is load-bearing, not cosmetic. Judged diagnostics must cite an id, and the
citation is validated deterministically after the model returns (`MB-R1` property 3).
A free-form id space would make "did the model cite something real?" a fuzzy question.
It also keeps `forge explain` readable.

### 4.2 Shape versus semantics

Validation is two separable stages (`FR-008`):

| Stage | Implemented by | Produces |
|---|---|---|
| **Shape** | Zod schema | Parse success, or a raw schema error |
| **Semantics** | `integrity.ts` | Coded diagnostics: `C010`, `C050`, `C090`, `C091`, `C092` |

The split exists so a semantically-broken IR yields a readable coded diagnostic rather
than a Zod error dump — and so a `DraftIR` can be *repaired* rather than rejected. This is
why `justifies` is permitted to be empty by the schema but is an error by lint: the model
must be able to return a repairable draft.

### 4.3 What the IR deliberately excludes

| Excluded | Why | Lives instead in |
|---|---|---|
| Prose prompt text, tone, section order, markup style | Adapter concern; would break `INV-001` | Renderer + profile |
| Agent names, tool names (`Bash`, `Edit`) | Would break provider independence | Profile capability mapping |
| Output filenames (`CLAUDE.md`, `AGENTS.md`) | Target-specific | Profile artifact topology |
| Token budgets, model selection | Compile-time and configuration | Strategy overlay + config |
| `materialization` | A **compile-time decision**, not a property of the task (`IR-R3`) | Compilation result |
| `est_tokens`, `bytes` | Measurements under a pinned tokenizer | Run instance |
| `created_at`, `retrieved_at`, scores, retriever ids | Volatile (`IR-R4`) | Run instance |

> **Revision 1 defect, corrected.** `materialization` was a nullable field on
> `ContextRef` while §7 simultaneously said the compiler decides it. That is a layering
> smear: a compile-time decision stored inside the canonical semantic object, which would
> have made the same task hash differently per target. Removed.

### 4.4 Abstract capabilities

`required_capabilities` uses a closed vocabulary shared with `AgentProfile.capabilities`
(`AP-R2`), so legalization is a total function:

```
fs_read · fs_write · shell · run_tests · git_history · git_write · network
package_install · mcp · subagents · planning_mode · multi_turn · vision · long_context
```

The IR says `run_tests`. It never says `Bash` or `pnpm test`. Mapping abstract capability
to concrete tool is the adapter's job.

---

## 5. Trust resolution and instruction provenance

### 5.1 Agent-steering nodes

Revision 1 carried `source_ref` on goals and constraints only, while claiming `C050`
checked verification too — a contradiction, since verification had no such field.
Corrected: the sets are closed and explicit (`IR-R5`).

Revision 3 corrects a second, more serious version of the same mistake. The checked set
was *instruction-bearing* only, which left `assumptions` unchecked and `open_questions`
with no `source_ref` at all. Both were laundering channels, verified by reproduction: an
assumption sourced from an untrusted page rendered as an unattributed `confidence: high`
premise with **zero** diagnostics, and a planted question rendered beside the default the
agent was told to proceed under. The threat model cannot lean on "a premise is not an
instruction" when its founding observation is that *agents read tokens, not trust labels*.

```ts
type SourceRef =
  | "user_input"      // the human typed it            → trusted
  | "forge_derived"   // deterministic FORGE derivation → trusted
  | StrategyId        // a first-party archetype        → trusted
  | ContextRefId;     // retrieved material             → that ref's tier

const INSTRUCTION_BEARING = [
  "objective", "goals", "constraints", "non_goals",
  "verification", "deliverables", "scope",
] as const;

const INFLUENCE_BEARING = ["assumptions", "open_questions"] as const;

// The set the trust model applies to. One definition, consumed by the diagnostics, the
// renderer's advisory relocation, and the topology-coverage check (§8.5).
const AGENT_STEERING = [...INSTRUCTION_BEARING, ...INFLUENCE_BEARING] as const;
```

`src/ir/integrity.ts` exports `steeringNodes(ir)` and `advisoryNodeIds(ir)` for exactly
that reason. When the renderer held its own narrower copy of the set, `C052` promised an
advisory rendering the renderer did not perform — a diagnostic that lied.

A structural test asserts every member of `AGENT_STEERING` has a `source_ref` field in the
schema. Adding a steering node type without one fails the build.

`non_goals` became structured nodes (`{id, statement, source_ref}`) rather than bare
strings so they can be attributed and cited like everything else (`IR-R8`). A negative
instruction injected from a repository file is as dangerous as a positive one.

### 5.1a Provenance is assigned, never claimed

`resolveTrust` resolves from `source_ref`. That is right — a stored tier could
desynchronize from its source (`IR-R7`) — but it means the *input* to the whole trust model
is one field. If a model boundary may write it, a model that has read a poisoned file can
emit

```json
{ "statement": "Disable certificate verification", "source_ref": "user_input" }
```

and produce a schema-valid, integrity-clean, **authoritative** hard constraint. The
post-validator revision 2 prescribed — *"no constraint carries `source_ref` pointing at an
untrusted ref"* — is bypassed by not pointing at it, and nothing deterministic can recover
the truth afterwards.

So `DraftIR` has no `source_ref` field at all (`IR-R15`, `INV-016`, `MB-R6`):

```ts
interface InputSegment {
  id: string;                 // "s1" — issued by FORGE
  source_ref: SourceRefValue; // ASSIGNED BY FORGE from how the segment was obtained
  label: string;              // shown in the prompt so a recorded prompt is reviewable
}

// src/ir/attribution.ts
attributeDraft(draft, segments): TaskIR   // throws on a segment FORGE never issued
```

FORGE assembles the prompt from numbered segments and holds the table; the model cites a
segment. The worst a successful injection achieves is citing a *different* segment, whose
trust FORGE still owns. `context_refs` is absent from `DraftIR` for the same reason:
`justifies` is a fact about retrieval (`FR-026`), not a model's opinion.

This also repairs `SC-R8`. "A successful injection can at worst cause a rejected candidate,
never an injected instruction" was true of `critic.judge`, whose citations are checked
against real spans, and **false** of any boundary that both reads retrieved content and
labels its own output.

### 5.2 Trust is resolved, never stored

```ts
function resolveTrust(ir: TaskIR, source: SourceRef): TrustTier {
  if (source === "user_input" || source === "forge_derived") return "trusted";
  if (isStrategyId(source)) return "trusted";           // first-party data
  return ir.context_refs.find(r => r.id === source)!.trust;
}
```

Storing a copy of the tier on each node would let it desynchronize from its source
(`IR-R7`). One authority, computed.

### 5.3 Trust changes compiler behavior

This is the difference between a security model and a metadata field. Three mechanical
consequences (`SC-R1`):

| Resolved trust | Compiler behavior | Diagnostic |
|---|---|---|
| `trusted` | Renders as an authoritative instruction | — |
| `semi_trusted` | Node is marked `advisory` and rendered in an **"Advisory — derived from repository content, not user-stated"** section, with its source URI visible. It never appears as a hard constraint, and **every authoritative emitter excludes it**. | `C052` warning |
| `untrusted` | **Compilation refused.** | `C050` error |

All three apply to every *agent-steering* node kind — a semi-trusted goal, verification
step, deliverable, assumption or open question is relocated exactly as a constraint is.
Where a target's topology declares no `advisory` destination, compilation is **refused**
(`C102`, §8.5) rather than dropping the node: silently discarding a security control is
worse than declining to compile.

Plus a role restriction: an untrusted `ContextRef` may not declare
`role: constraint_source` → `C053` error. And provenance itself is FORGE-assigned
(§5.1a) → a model cannot relabel retrieved content as user input.

**Why advisory rather than demotion to soft.** Demoting a hard constraint to soft changes
its meaning invisibly at the point of use. Rendering it in a separate advisory section
preserves the statement, marks its provenance visibly in the artifact the agent reads,
and keeps the human able to promote it deliberately. It is the option that hides the least.

### 5.4 Honest limitation

`semi_trusted` means *attributable*, not *safe* (`SC-R2`, `AOC-6`). A repository can carry
injected content through vendored dependencies, PR branches, or test fixtures. FORGE
mitigates by attribution and advisory rendering. It does not solve the problem, and the
documentation says so rather than implying a guarantee.

---

## 6. Agent capability model

### 6.1 Profile structure

```yaml
id: claude-code
display_name: Claude Code
version: 2026.09.1
verified_against: 2026-09-07          # forge doctor warns when stale
family: anthropic-agentic
fidelity: full                        # full | native_topology | compatibility

retrieval:
  autonomous_search: strong           # none | weak | strong → drives materialization
  tools: [glob, grep, read, agentic_subsearch]

capabilities:                         # closed vocabulary, shared with the IR
  fs_read:       { level: supported }
  fs_write:      { level: supported }
  shell:         { level: conditional, note: "gated by permission mode" }
  run_tests:     { level: supported }
  git_history:   { level: supported }
  network:       { level: conditional, note: "WebFetch/WebSearch may be disabled" }
  mcp:           { level: supported }
  subagents:     { level: supported }
  planning_mode: { level: supported }
  vision:        { level: supported }
  multi_turn:    { level: supported }
  git_write:     { level: conditional }
  package_install: { level: conditional }
  long_context:  { level: supported }

autonomy:
  default: high
  configurable: true
  permission_model: per-tool-prompt

budget:
  max_context_tokens: 200000
  artifact_share: 0.08                # fraction of context the package may occupy

output:
  artifacts:
    - path: "PROMPT.md"
      sections: [objective, goals, constraints, scope, context_plan,
                 stop_conditions, verification, deliverables, advisory,
                 untrusted_appendix]
    - path: "CLAUDE.md"
      sections: [project_conventions]
  path_vars: []
  overrides:                          # only permitted when fidelity: full
    constraints: claude-code.constraints
    stop_conditions: claude-code.stop_conditions

limits:
  known_gaps: []
  known_failure_modes:
    - "widens scope when constraints are stated only once"
    - "degrades when many files are pre-injected"
```

### 6.2 The fidelity ladder

Revision 1 claimed "new agent = YAML profile only" while listing Kiro — which expects
`requirements.md` / `design.md` / `tasks.md` — as `renderer: generic`. The generic
renderer could not produce that topology, so the claim was false for Kiro.

Two corrections, applied together:

1. **Topology becomes declarative** (§8), so multi-file targets *are* achievable from
   YAML alone.
2. **Fidelity becomes an explicit, enforced claim** (`AP-R6`, `INV-014`), so where data
   alone is insufficient the profile must say so.

| Fidelity | Guarantee | Requirement to claim it | What `C101` actually checks |
|---|---|---|---|
| `full` | Idiomatic output matching native conventions | Registered section overrides **and** recorded manual verification against the real agent | every declared override is registered; at least one is declared |
| `native_topology` | The target's own file layout and section placement, **at whatever arity that convention has**; generic prose | A declared topology that compiles the contract fixture losslessly | compiles with no `C102`; declares no overrides |
| `compatibility` | One **portable** generic artifact. No claim about native layout | Profile validates and compiles | exactly one declared artifact; declares no overrides |

**Revision 3 correction — arity is not fidelity.** Revision 2 enforced `native_topology`
by requiring two or more declared artifacts. That produced a direct contradiction with
`spec.md` AP-R8: `hermes-agent` and `claude-design` are single-artifact *by nature* (one
AGENTS.md with SKILL.md deferred; one design brief), so both had to under-claim
`compatibility` to keep INV-014 true, and the disagreement between the specification and
the shipped profiles went undetected because no test compared them. The proxy failed in the
other direction too: `claude-code` declares two artifacts and emits one for most tasks,
because its second file carries only conventions many tasks do not have.

The distinction is now **portability versus native convention**, and the honest limit is
stated: whether a layout matches a target's convention is a human claim, carried by
`verified_against` and `limits.known_gaps`. AP-R8's assignments are now verified by a
contract test, so a profile cannot silently disagree with the specification.

**Kiro today:** `native_topology`. It gets the right three files with the right sections.
It does **not** get EARS requirement phrasing, because that is a content transformation
the generic emitters do not perform. This is declared in `limits.known_gaps` and surfaced
by `forge agents show`. Claiming `full` would be an overclaim.

### 6.3 v0.1 targets

| Profile | `autonomous_search` | shell | Fidelity | Declared gap |
|---|---|---|---|---|
| `claude-code` | strong | conditional | `native_topology` → `full` in P6 | overrides pending |
| `openai-codex` | strong | supported | `native_topology` → `full` in P6 | overrides pending |
| `kiro` | weak | conditional | `native_topology` | EARS phrasing not performed |
| `opencode` | strong | conditional | `native_topology` | permission block is generic |
| `hermes-agent` | strong | supported | `native_topology` | SKILL.md emission deferred |
| `claude-design` | **none** | **absent** | `native_topology` | no repo access — forces `by_value` |
| `deepseek-harness` | strong | supported | `compatibility` | single portable artifact |

`claude-design` earns its place as the honesty test: it is the only target with no shell
and no repository, so it forces `by_value` materialization and forces legalization to
degrade command verification into manual review. A capability model that expresses it
correctly is not secretly modeled on Claude Code.

---

## 7. Compiler stages

All six stages are pure functions. No model calls (`INV-009` is satisfied vacuously here).

### Stage 1 — Lower

`EffectiveIR = apply(TaskIR, StrategyOverlay)`.

Each node in the result carries `introduced_by: TraceOrigin`:
- base IR node → `{kind: "ir_node", node_id}` (itself)
- overlay-added node → `{kind: "strategy", strategy_id, overlay_path}`

This is what lets `forge explain` show *"this constraint exists because the surgical
archetype added it"* without duplicating chains into every span (`PV-R4`).

### Stage 2 — Legalize

```
for each capability in EffectiveIR.required_capabilities:
    level = profile.capabilities[capability].level
    supported   → ok
    conditional → note in runtime-contract; C031 info if it gates a verification step
    absent      → if the capability is required by a HARD constraint or a
                  `command`/`test` verification → C030 error, REFUSE COMPILATION
                  else → apply named degradation rule, emit C031
```

**Degradation rules are a closed named registry** (`FR-016`), never ad-hoc:

| Rule id | Trigger | Effect |
|---|---|---|
| `degrade.command_to_manual` | `shell`/`run_tests` absent | `verification[kind=command\|test]` → `kind=manual`, spec preserved verbatim |
| `degrade.inline_context` | `retrieval.autonomous_search = none` | Force `by_value` materialization |
| `degrade.drop_subagent_guidance` | `subagents` absent | Omit the delegation section |
| `degrade.flatten_multi_turn` | `multi_turn` absent | Fold clarification into a single artifact |

Every application emits a diagnostic and a `compiler_rule` trace origin. Nothing degrades
silently (`INV-012`).

### Stage 3 — Materialize

```
by_reference  ← autonomous_search = strong                 (the default; AD-2)
summary       ← autonomous_search = weak, or budget pressure on a background ref
by_value      ← autonomous_search = none, or role ∈ {counter_example} needing exact text
```

Then, unconditionally: untrusted refs are fenced (`SC-R7`); secret-detected content is
redacted (`SC-R6`); a secret that would be inlined is a hard error.

**Why by-reference is the default.** For a strong-retrieval agent, pre-injecting file
contents is a measurable regression: it consumes attention budget, anchors the agent on
FORGE's ranking guesses, and suppresses retrieval that is better than ours. FORGE emits a
ranked pointer list plus a retrieval plan instead. Inlining is a *degradation* for weak
targets, not a feature. This is the sharpest idea in the architecture and the operational
form of "more context is not better."

### Stage 4 — Budget

- Tokenizer pinned and recorded (§3.3).
- Allocation order: objective → goals → hard constraints → verification → scope →
  context (by rank) → advisory → untrusted appendix.
- **Goals and hard constraints are never droppable** (`INV-003`). If they alone exceed
  the envelope, that is `C060 budget_overflow` — an error, not a truncation.
- Every drop emits `C061` naming the item, its rank, and the reason.

### Stage 5 — Render

Section emitters composed by profile topology. See §8.

### Stage 6 — Emit

Assemble the package, compute `content_hash` per artifact, then `semantic_id` (§3.3).
Write `run.json` last and separately, so a bug that leaked volatile data into a semantic
file shows up immediately as a determinism test failure.

---

## 8. Rendering: section emitters and artifact topology

### 8.1 The composition

Revision 1 had monolithic per-agent renderers, which forced a choice between "generic and
inflexible" or "bespoke code per agent." Revision 2 decomposes:

```
                  ┌─────────────────────────────────┐
   EffectiveIR ──▶ │  SECTION EMITTER REGISTRY       │
   Profile     ──▶ │  closed catalogue of pure fns   │
   Materialized──▶ │  key → (input) → SectionOutput  │
                  └───────────────┬─────────────────┘
                                  │
                  ┌───────────────▼─────────────────┐
                  │  PROFILE ARTIFACT TOPOLOGY       │
                  │  which sections, in which files, │
                  │  in which order                  │
                  └───────────────┬─────────────────┘
                                  │
                  ┌───────────────▼─────────────────┐
                  │  OPTIONAL SECTION OVERRIDES      │
                  │  full-fidelity targets only      │
                  └───────────────┬─────────────────┘
                                  │
                         Artifact[] + Span[]
```

```ts
interface SectionEmitter {
  key: SectionKey;                       // from the closed catalogue
  emit(input: SectionInput): SectionOutput;
}

interface SectionOutput {
  text: string;
  spans: Span[];                         // byte ranges → TraceOrigin (§9)
}

interface ArtifactTopology {
  path: string;                          // template; vars from a closed set
  sections: SectionKey[];                // ordered
}
```

### 8.2 The section catalogue

Closed and first-party. Profiles **select and order** keys; they cannot define emitters.

```
objective · goals · acceptance · constraints · non_goals · scope
context_plan · context_inline · assumptions · open_questions
task_checklist · verification · stop_conditions · deliverables
capability_notes · advisory · untrusted_appendix · project_conventions
```

### 8.5 Topology completeness: a profile may not delete content by omission

A contract test asserts every key referenced by every profile exists (`AP-R5`), and that
mandatory sections appear exactly once per topology.

That was not enough, and the gap was reachable through data alone. Because a profile
*selects* sections, a topology omitting one silently deleted whatever only that section
renders. Reproduced during the P1.4 audit against the repository's own AC-017 extensibility
fixture: both non-goals, all three verification steps, the entire scope and every acceptance
criterion vanished, with `refused: false` and **no diagnostic naming any loss**. Two
existing checks looked like they covered it and did not — `FORGE-C002` protects hard
constraints only, and `FORGE-C001` computes goal coverage from the verification *list*, so a
package could report every goal verified while its artifacts contained no verification at
all. The advisory case was worse: `C052` stated a node "will be rendered as advisory" when
no advisory section existed to render it.

`checkTopologyCoverage` (`src/critic/deterministic/topology.ts`) closes this. For each
content class it asks whether the declared section set contains any destination:

| Content class | Destinations | Missing destination |
|---|---|---|
| objective · goals · acceptance · constraints · non_goals · scope · verification · deliverables | its own section (`goals`/`acceptance` also accept `task_checklist`) | **refuse** — `C102` error |
| nodes demoted to advisory by the trust model | `advisory` | **refuse** — `C102` error (a security control, §5.3) |
| assumptions · open_questions | their own sections | `C102` warning, recorded |
| context pointers · inlined context · untrusted refs · environment notes | `context_plan` · `context_inline` · `untrusted_appendix` · `capability_notes` | `C102` warning, recorded |

The check runs **before** rendering, so a refusal emits nothing, and it reads only the
declared section list and the IR — no profile-id branching. `CompileResult.topologyGaps`
carries the structured result so a caller can act on it without parsing messages.

Two mechanisms now overlap deliberately: the profile schema's "mandatory sections exactly
once" rule catches a malformed *profile* at load time, and `C102` catches a topology that
cannot carry a particular *task*. Neither subsumes the other.

### 8.3 Bespoke renderers are override sets

A `full`-fidelity profile does not replace the renderer. It registers overrides for
specific keys:

```yaml
overrides:
  constraints: claude-code.constraints        # checklist form with explicit stop conditions
  stop_conditions: claude-code.stop_conditions
```

Benefits: bespoke code shrinks to the sections that genuinely differ; golden diffs become
surgical rather than whole-file; and the same trace machinery covers overrides for free.

### 8.4 Multi-file topology, worked

Kiro, entirely from YAML:

```yaml
fidelity: native_topology
output:
  artifacts:
    - path: ".kiro/specs/{task_slug}/requirements.md"
      sections: [objective, goals, acceptance, constraints, non_goals, advisory]
    - path: ".kiro/specs/{task_slug}/design.md"
      sections: [scope, context_plan, assumptions, capability_notes]
    - path: ".kiro/specs/{task_slug}/tasks.md"
      sections: [task_checklist, verification, stop_conditions, deliverables]
  path_vars: [task_slug]
```

`path_vars` is a closed, validated set (`task_slug`, `task_id`, `date`) so a template can
never produce a traversal or an absolute path.

---

## 9. TraceOrigin and the provenance graph

### 9.1 Why revision 1 was too narrow

Revision 1 required every span to map to a **Task IR node**, then simultaneously described
content that has no IR node: renderer headings, legalization degradation notices, budget
notes, profile-driven stop-condition idiom, and strategy-added constraints. The invariant
"100% of spans map to an IR node" was therefore unachievable as written — a spec that
could only be satisfied by relaxing it silently.

### 9.2 The typed origin

```ts
type TraceOrigin =
  | { kind: "ir_node";           node_id: NodeId }
  | { kind: "strategy";          strategy_id: string; overlay_path: string }
  | { kind: "agent_profile";     profile_id: string; profile_path: string }
  | { kind: "context_ref";       ref_id: ContextRefId; materialization: Materialization }
  | { kind: "compiler_rule";     rule_id: CompilerRuleId }
  | { kind: "renderer_template"; renderer_id: string; section_key: SectionKey; slot: string };

interface Span {
  artifact_path: string;
  start: number;                  // byte offset, inclusive
  end: number;                    // byte offset, exclusive
  origin: TraceOrigin;
}
```

### 9.3 The coverage invariant

`INV-010`, now achievable and mechanically checkable:

> Within each artifact, spans are non-overlapping and ordered, and the complement of
> their union contains **only whitespace**.

```ts
function verifyCoverage(artifact: Artifact, spans: Span[]): Diagnostic[] {
  // 1. sort by start; assert no overlap
  // 2. walk the gaps; any gap containing a non-whitespace byte → C100
}
```

Byte-level rather than span-count-level, so it cannot be satisfied by a single span
covering a whole file. `AOC-10` records that this granularity is unproven and will be
prototyped in P1 before it is relied upon; if impractical, the invariant is **revised in
`spec.md`**, not quietly relaxed in code.

### 9.4 `forge explain`

A pure lookup with a resolver per origin kind (`PV-R5`, `FR-043`):

```
$ forge explain ./pkg --byte 1284

artifacts/PROMPT.md  bytes 1240–1310
  origin        ir_node  c7
  statement     "Do not introduce new dependencies or files"
  hardness      hard
  source_ref    user_input          → trust: trusted
  introduced_by strategy  st_surgical  (overlay.added_constraints[1])
  rendered by   section "constraints" (override: claude-code.constraints)
```

No model is involved, so the explanation cannot drift from the artifact or hallucinate.
This is why explainability is a *consequence* of the architecture rather than a feature:
we build the trace and get it for free.

---

## 10. Context engine

### 10.1 Pipeline

```
per-node query derivation → candidate generation → WorkspaceGuard → rank
   → role assignment → (justifies already known) → materialize [compiler stage 3]
```

### 10.2 Justification falls out of retrieval

The key move (`FR-026`, `MB-R4`). Queries are derived **per instruction node**:

```
goal g1        "session loss during token refresh"  → terms: session, refresh, token
constraint c1  "AuthProvider public interface"      → terms: AuthProvider
```

A candidate retrieved by the `g1` query justifies `g1` **by construction**. A candidate
retrieved by both justifies both. This is strictly more trustworthy than asking a model
whether a file is relevant: it is a recorded fact about how the reference was found, not
an opinion about it.

Consequences:
- An orphan reference cannot exist for retrieved candidates — it would never have been
  retrieved.
- Explicit user files (`--file`) have no query provenance, so they require `--justifies g1`
  or are rejected with `C010`. The rule stays uniform.
- The `context.justify` model boundary is **removed** (`MB-R4`).

**P1.6 lesson — answer from evidence before escalating.** P1.6 showed FORGE
over-blocking on ambiguity resolvable from project context: it asked blocking
questions whose answers were visible in the repository, costing whole tasks a
compliant executor could have completed. P2 retrieval must therefore attempt to
answer resolvable questions deterministically from trusted/semi-trusted evidence
*before* escalating them to the user — unresolved questions still become
`open_questions`, and nothing is ever fabricated to fill a gap. An answered
question is recorded with its evidence (which segment justified the answer);
escalation is the fallback, not the default.

`AOC-3` records the open risk: retrieval-derived justification is coarse — a file matching
a `g1` term may be genuinely irrelevant. Precision is measured against the corpus, and the
interface still admits a boundary if evidence demands one.

### 10.3 Ranking

Deterministic and published:

```
score = w_lex · lexical_match_strength
      + w_role · role_prior
      + w_git · recency_in_git_within_scope
      + w_prox · proximity_to_scope_include
```

Weights live in config with documented defaults. Scores are **run-instance data** — they
influence which refs are retained, but the retained set is what is semantic. No embeddings
in v0.1: the retrieval target is *pointers*, and lexical retrieval is sufficient,
explainable, and index-free.

### 10.4 Role assignment

A documented deterministic rule table (`FR-028`):

| Condition | Role |
|---|---|
| File declares a symbol from the query | `definition` |
| Path matches a test glob | `example` |
| Git commit or log entry | `background` |
| Documentation path **and** `semi_trusted` | `constraint_source` (→ advisory, `C052`) |
| Otherwise | `background` |

Low-confidence assignments emit an informational diagnostic rather than guessing silently.

### 10.5 WorkspaceGuard

The sole filesystem gateway (`INV-011`). Fixed order, fail-closed:

```
resolve absolute → realpath → assert workspace-root prefix → deny symlink escape
  → .gitignore / .forgeignore → deny globs (.env*, keys, certs)
  → secret scan → trust tier assignment → representable as ContextRef
```

Content is not representable in memory as context until it has passed every step. A lint
rule forbids importing `fs` anywhere else, and `AC-011` asserts it.

---

## 11. Strategy overlay architecture

### 11.1 Archetypes only

Final decision (`ST-R2`): v0.1 has **fixed archetypes and no model-invented strategies.**
The earlier `llm_novel` candidate is removed.

### 11.2 Archetypes are data

`strategies/surgical.yaml`:

```yaml
id: surgical
version: 1
overlay_template:
  added_constraints:
    - kind: scope
      hardness: hard
      statement: "Change the minimum number of lines that fixes the defect"
    - kind: process
      hardness: hard
      statement: "Do not introduce new dependencies or files"
  autonomy:
    decision_authority: low
    ask_threshold: any_ambiguity
  verification_intensity: standard
  exploration:
    challenge_architecture: false
    require_alternatives: 0

parameters:                      # typed and BOUNDED
  max_files:      { type: int, min: 1, max: 5,  derive: from_blast_radius }
  budget_tokens:  { type: int, min: 2000, max: 12000, derive: from_scope_size }

fit_rules:                       # deterministic; each match is recorded
  - when: { risk_level: [medium, high, critical] }        weight: 2
  - when: { has_hard_constraint_of_kind: architectural }  weight: 3
  - when: { blast_radius: [file, module] }                weight: 2
  - when: { objective_kind: [debug, refactor] }           weight: 1
```

### 11.3 Deterministic selection and tuning

```
signals    = extractSignals(TaskIR)          // pure
scores     = for each archetype: Σ weights of matching fit_rules
candidates = archetypes with score > 0, ranked; ties broken by configured order
params     = for each candidate: derive(parameter.derive, signals), clamped to [min,max]
rationale  = render(matched fit rules)       // deterministic template, not prose
```

The rationale reads:

> Selected **surgical**: `risk.level=medium` (+2), `c1` is a hard architectural
> constraint (+3), `blast_radius=module` (+2), `objective.kind=debug` (+1). Score 8.

This is *better* than a model-written rationale: it is the actual decision procedure, so
it cannot misdescribe itself.

### 11.4 Why `strategy.propose` was removed

With free-form strategies eliminated, the remaining work is archetype scoring and bounded
parameter derivation — both pure functions of IR signals. A model would add nondeterminism,
latency, cost, and an API-key dependency while adding no capability. Removing it makes the
entire strategy system golden-testable (`MB-R4`).

`AOC-2` records the risk: fit rules may be cruder than a model's judgment. This is
measured against the corpus, and reintroducing a boundary is additive and cheap.

### 11.5 Distinctness gate

```ts
distance(a, b) = weighted over:
  symmetric difference of added_constraints (by normalized statement)
  autonomy.decision_authority (ordinal distance)
  change_budget (normalized numeric distance)
  verification_intensity (ordinal)
  exploration (boolean + alternatives count)
```

Candidates below threshold against an existing candidate are dropped and the rejection
recorded. A reworded duplicate has distance zero and cannot survive — which is exactly why
strategies cannot degrade into short/medium/long prose variants.

### 11.6 Extension point

```ts
interface StrategySource {
  id: string;
  propose(ir: TaskIR, signals: Signals): StrategyCandidate[];
}
// v0.1 registry: [ArchetypeSource]
// future:        [ArchetypeSource, DiscoverySource]
```

`StrategyCandidate.origin` is an open enum whose only v0.1 value is `archetype`. Because a
strategy is an *overlay* — a structure separate from the Task IR — a future source adds
candidates **without any Task IR schema change** (`FR-035`, `ST-R7`).

---

## 12. Diagnostics engine

### 12.1 Shape

```ts
interface Diagnostic {
  code: DiagnosticCode;                    // "FORGE-C010"
  name: string;                            // "orphan_context"
  severity: "error" | "warning" | "info";
  source: "deterministic" | "judged";
  message: string;
  evidence: Evidence[];                    // MANDATORY, non-empty (INV-007)
}

type Evidence =
  | { kind: "node";  node_id: NodeId }
  | { kind: "span";  artifact_path: string; start: number; end: number; quote: string }
  | { kind: "measure"; label: string; value: number; unit: string };
```

Non-empty evidence is enforced by the type and by test. A finding without evidence cannot
be constructed.

### 12.2 Deterministic first

Codes and conditions: `spec.md` §10.2. The design point is that **most of the interesting
evaluation is computable**:

| Question | How it is actually answered |
|---|---|
| "Is every goal covered?" | Set difference over `verification[].satisfies` |
| "Did a constraint get dropped?" | Span lookup in the trace |
| "Is this context unnecessary?" | Graph reachability on `justifies` |
| "Can the agent do this?" | Set intersection with profile capabilities |
| "How expensive is this?" | Pinned tokenizer count |

Only three codes genuinely need judgment: `C040`, `C041`, `C051`.

### 12.3 Judged diagnostics are additive and discardable

`critic.judge` is optional and off by default. Its output is structurally validated: every
citation must resolve to a real node or a real span. A finding with an unresolvable
citation is **discarded before display** and recorded as a boundary quality signal
(`DG-R4`). A successful injection against the critic can therefore at worst delete a
finding, never add an instruction.

### 12.4 Ranking

Lexicographic, published, with the deciding step named (`spec.md` §10.3). No weights, no
normalization, no aggregate. The point is that a user can *argue* with the recommendation,
which is impossible against a score.

---

## 13. Model boundary registry

### 13.1 The real invariant

Revision 1 encoded "FORGE has exactly four LLM calls" as an architectural invariant. That
is a *count*, not a property — it constrains the wrong thing and would have to be edited
every time the design legitimately changed.

The invariant is the **eight properties** (`MB-R1`), enforced structurally:

```ts
interface ModelBoundary<I, O> {
  id: BoundaryId;
  version: string;                          // prompt template version
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  postValidators: PostValidator<I, O>[];    // deterministic; all must pass
  cassetteKey(input: I): string;            // content-addressed replay
  required: boolean;
  onFailure: "fail" | "skip";               // never "guess" (MB-R3)
}

export const BOUNDARIES = Object.freeze({
  "intent.extract": intentExtract,   // required: true,  onFailure: "fail"
});
```

**What is actually registered today is `intent.extract` and nothing else.**
`critic.judge` is designed (§13.2) but unbuilt — it belongs to P6, along with the
`FORGE-C040`/`C041`/`C051` codes its output would carry. Earlier revisions of this
document showed it in the registry as though it existed; it did not, and the
contract test asserts the registry holds exactly one boundary.

A structural test enumerates `BOUNDARIES` and asserts all eight properties for each,
including that `tests/boundaries/<id>.test.ts` exists (`MB-R2`, `AC-016`). Adding a
boundary without satisfying them fails the build. Keeping the count low remains an
engineering discipline; it is no longer a specification claim.

**Known sharp edge.** The property-5 assertion in
`tests/contract/boundaries.test.ts` hardcodes a `{ text: … }` sample input for
every boundary. A boundary with a differently-shaped input would hash `undefined`
twice and fail for the wrong reason. Generalize that test to a per-boundary
sample input *before* registering a second boundary.

### 13.2 Post-validators do the real work

For `intent.extract`:

- Output parses against `DraftIRSchema`.
- **No stated provenance:** the schema carries no `source_ref` and no `context_refs`, so
  the boundary cannot claim a trust tier at all (MB-R6, INV-016). It cites `derived_from`
  segment ids and FORGE resolves them.
- Every `derived_from` names a segment FORGE issued; every `justifies`, `satisfies` and
  `default_assumption_ref` resolves.
- Node ids are unique and well-formed.
- **No invented capability:** every `required_capabilities` entry is in the closed vocabulary.
- After attribution, `checkIntegrity` must report no error-severity diagnostic — which is
  where an untrusted-sourced instruction *or premise* is caught (`C050`).

For `critic.judge`:

- Every cited node id exists; every cited span is within its artifact's bounds.
- Every finding's code is in the judged subset (`C040`, `C041`, `C051`) — the boundary
  cannot emit a deterministic code.

These are what make the boundary a *parser* rather than an architect: it proposes typed
values, and deterministic code decides whether they are admissible.

### 13.3 Replay

`cassetteKey(input)` is a content hash of the fully-rendered prompt plus the boundary
version. CI replays cassettes; no network, no API key (`NFR-007`). A cassette miss in CI
is a hard failure, never a live call.

---

## 14. Execution Package format

Layout and contract: `spec.md` §11. Architectural notes:

- **The semantic/volatile split is physical**, not a convention. `run.json` is a separate
  file, written last, excluded from `semantic_id`. A determinism failure therefore shows
  up as a `diff` rather than as a subtly unstable hash.
- **`runtime-contract.json` declares, never grants** (`PK-R4`). It states required
  capabilities, tools, network policy, filesystem scope, and the pinned commit. Enforcement
  belongs to a future executor that does not exist. This keeps `INV-004` structural rather
  than a matter of restraint.
- **`verification.json` is data.** FORGE never executes it, and `AC-020` asserts statically
  that no code path does.
- **`diagnostics.json` separates deterministic from judged** and carries a
  `deterministic_hash`, so the reproducible portion can be verified independently of
  whether the optional critic ran.
- **Packages are consumable without FORGE** (`PK-R8`): JSON plus the published schema.
  This matters for the open-source claim — a package must not be a proprietary blob.

---

## 15. Persistence

```
.forge/
  objects/<sha256>.json     # immutable, content-addressed
  runs/<YYYY-MM-DD>.jsonl   # append-only event log
  index.sqlite              # DERIVABLE cache for history/diff
  config.json
```

- **The index is derivable** (`PS-R3`). Deleting `index.sqlite` and rebuilding from
  `objects/` and `runs/` must reproduce it exactly. This keeps SQLite an optimization
  rather than a second source of truth that can drift.
- **No server, no daemon** (`PS-R4`). `better-sqlite3` is synchronous and embedded.
- `profiles/` and `strategies/` are **repository data**, not store data — they are
  first-party, versioned, and contributed via PR.

---

## 16. Security boundaries

Requirements: `spec.md` §13. Architectural framing:

### 16.1 Two attack targets, not one

The commonly-missed half is that **FORGE itself is a target**. `critic.judge` receives
retrieved content. So:

- Its prompts fence untrusted content identically to the downstream artifact.
- Its outputs are structurally validated (§13.2).
- The worst outcome of a successful injection is a *discarded finding* — never an injected
  instruction.

This is only achievable because the boundary returns typed data validated by deterministic
code. A boundary returning prose would have no such defense.

### 16.2 Defense in depth

| Layer | Control | Failure mode |
|---|---|---|
| Filesystem | Path jail, ignore rules, deny globs | Fail-closed |
| Content | Secret scan before representability | Redact + record; hard error on inline |
| Semantics | Trust resolution → admissibility, advisory, role restriction | `C050`/`C052`/`C053` |
| Rendering | Untrusted fencing with visible provenance | `C051` (judged) |
| Boundary | Fenced prompts + structural output validation | Discard |
| Egress | Network off by default, domain allowlist | Refuse |

No single layer is trusted alone, because the underlying problem — agents read tokens, not
trust labels — is not fully solvable at any one of them.

---

## 17. Extension architecture

| Extension | Mechanism | Code required |
|---|---|---|
| New agent (`compatibility`, `native_topology`) | `profiles/<id>.yaml` | **none** |
| New agent (`full`) | Profile + registered section overrides + recorded verification | yes, reviewed |
| New strategy archetype | `strategies/<id>.yaml` | **none** |
| New diagnostic | Code + implementation + triggering fixture | yes |
| New retriever | `Retriever` interface implementation | yes |
| New model provider | `ModelProvider` interface implementation | yes, isolated to `src/model/` |
| New strategy source (future) | `StrategySource` implementation | yes; **no IR schema change** |
| New section emitter | Registry addition + catalogue documentation | yes, reviewed |

The extensibility claim is now **honest and testable**: `AC-017` asserts a synthetic
profile compiles with zero TypeScript changes, and `AC-018` asserts no profile overclaims
its fidelity.

---

## 18. Build vs Integrate vs Defer

| Component | Decision | Notes |
|---|---|---|
| Task IR schema, canonicalization, hashing | **Build** | The core asset. Zod. Nothing existing fits. |
| Agent capability registry + profiles | **Build** (data) | No existing registry covers these targets. |
| Compiler stages, section emitters, topology | **Build** | The differentiator. |
| Diagnostics engine | **Build** | Deliberately unlike LLM-judge tooling. |
| Trace / provenance graph | **Build** | Falls out of rendering. |
| Strategy fit-rule engine | **Build** | Small, pure, fully testable. |
| Instruction output format | **Integrate** | **AGENTS.md** as the generic target — Linux Foundation-stewarded, read natively by most targets. Do not invent a format. |
| Reusable procedural knowledge | **Integrate** (v0.2) | **SKILL.md** / agentskills.io. |
| Lexical retrieval | **Integrate** | `@vscode/ripgrep` — fast, gitignore-aware, index-free. |
| Repo packing for bulk inlining | **Integrate** (v0.2) | **Repomix** when a target genuinely needs `by_value` at scale. |
| Symbol extraction / repo map | **Defer** (v0.2) | `web-tree-sitter`. Ripgrep + import heuristics first. |
| Secret detection | **Build thin + Integrate** | Vendored high-confidence rules; shell out to `gitleaks` when present. `secretlint`'s plugin architecture is too heavy for a fail-closed hard path. |
| Git access | **Integrate** | Shell out to `git`. `isomorphic-git` is an unnecessary dependency. |
| Boundary regression testing | **Integrate** | **Promptfoo** — MIT, CLI-first, YAML-in-git. Dev dependency only. |
| Observability UI | **Defer** | **Langfuse** if a hosted UI is ever wanted. JSONL + SQLite needs no server. |
| Prompt optimization | **Defer** (v0.4+) | **GEPA/DSPy** need metrics and execution outcomes. Export traces as JSONL for offline Python consumption. |
| Embeddings / vector store | **Defer, possibly never** | Retrieval targets are pointers. Revisit only with evidence. |
| Portable runtime graph format | **Defer** | **Agent Spec** (arXiv 2510.04173) is a plausible executor-side emit target — one layer *below* FORGE. |
| MCP server exposing FORGE | **Defer** (v0.3) | Note the 2026-07-28 spec removed capability negotiation. |
| A framework owning the IR, compiler, provenance, trust or diagnostics | **Never** | Would import the agentic architecture explicitly rejected in AD-1. |
| A framework orchestrating the conversational turn (LangGraph.js) | **Reject — with a tripwire** | Evaluated in **AD-17**. The append-only turn-event log we need for auditability already *is* a checkpointer. |
| Document loaders / splitters / retrievers (LangChain.js) | **Defer entirely** | **AD-18.** Nothing consumes them yet. Building them now is speculative. |
| Model abstraction and streaming for the workspace (Vercel AI SDK) | **Integrate** | **AD-19.** Already carrying three live wire protocols. Lives in `web/`, outside the core cap. |
| Embedded index for the workspace (`node:sqlite`) | **Integrate** | **AD-20.** Built into Node 22; avoids native-module build friction. A derivable index, never truth. |
| LLM observability (Langfuse) | **Defer, optional** | Run-layer only. Must never be required to run FORGE, and never replaces `TraceOrigin`. |
| Execution / orchestration | **Never (here)** | `INV-004`. A separate project. |

---

## 19. Repository architecture

```
forge/
├── intent.md                  # why            ← authority: motivation
├── spec.md                    # what           ← authority: requirements
├── plan.md                    # when           ← authority: sequencing
├── CLAUDE.md                  # operating rules for agents in this repo
├── AGENTS.md                  # symlink/mirror — FORGE dogfoods the standard it targets
├── docs/
│   ├── architecture.md        # this file      ← authority: design
│   ├── ir-spec.md             # generated field reference
│   ├── writing-a-profile.md   # contributor guide
│   ├── diagnostics.md         # generated code reference
│   └── security.md            # threat model detail
├── src/
│   ├── ir/                    # schema, canonicalization, hashing, integrity, migrations
│   ├── intent/                # the NL→IR boundary: prompt, schema, repair, validators
│   ├── context/
│   │   ├── workspace.ts       # WorkspaceGuard — ONLY module permitted to touch fs
│   │   ├── retrievers/        # ripgrep, git-history, glob, explicit, prior-session
│   │   ├── rank.ts  roles.ts  secrets.ts
│   ├── strategy/              # archetype loader, fit rules, overlay apply, distinctness
│   ├── compile/
│   │   ├── lower.ts  legalize.ts  materialize.ts  budget.ts  emit.ts
│   │   ├── sections/          # the closed section emitter catalogue
│   │   └── overrides/         # full-fidelity section overrides, per profile
│   ├── trace/                 # spans, origins, coverage verification, explain resolvers
│   ├── critic/                # deterministic/ + judged/ diagnostics, ranking
│   ├── package/               # assembly, manifest, export
│   ├── store/                 # objects, run log, sqlite index
│   ├── model/                 # ModelProvider, boundary registry, cassettes
│   └── cli/
├── profiles/                  # ← 7 agent YAML descriptors. Contributions land HERE.
├── strategies/                # ← 4 archetype YAML files.  Contributions land HERE.
├── fixtures/
│   ├── ir/  repos/  profiles/  injection/  secrets/  cassettes/
├── tests/
│   ├── golden/  property/  contract/  security/  boundaries/  perf/
├── evals/                     # promptfoo configs + corpus (designed in v0.1, built later)
└── schema/                    # generated JSON Schema — a published artifact
```

**Single package, not a monorepo.** A workspace at v0.1 is the "abstraction because it
sounds sophisticated" this project explicitly avoids. `@forge/ir` extracts the first time a
third party writes an adapter; the boundary is already drawn at `src/ir/`.

---

## 20. Deterministic controls: hooks and lint rules

**Designed now; enabled only when their targets exist.** A hook pointing at a nonexistent
script is worse than no hook.

**Principle:** advisory guidance belongs in `CLAUDE.md`; non-negotiable mechanical rules
belong in hooks, lint rules, or tests — where they cannot be reasoned around.

| Control | Mechanism | Enable in |
|---|---|---|
| Deny reads of `.env*`, keys, certs | `PreToolUse` hook on Read/Grep/Glob | P2 (with `WorkspaceGuard`) |
| No `fs` import outside `WorkspaceGuard` | ESLint rule + `AC-011` test | P2 |
| `schema/` is generated — never hand-edited | `PreToolUse` hook on Edit/Write | P0 (once `schema/` exists) |
| `spec.md` invariants not silently changed by an implementation session | `PreToolUse` hook warning on edits to `spec.md` §3 | P1 |
| Format/lint changed files | `PostToolUse` hook | P1 |
| No composite score introduced | Repository-wide test (`AC-013`) | P4 |
| No command execution from IR/package | Static test (`AC-020`) | P5 |

Hooks are added in `.claude/settings.json` **in the phase that creates their target**, and
each is accompanied by the test that makes the same guarantee — hooks help the agent,
tests bind the repository.

---

## 21. Architecture decision records

### AD-1 · Compiler pipeline with a typed IR *(retained)*

| | A · Agentic FORGE | **B · Compiler + typed IR** | C · Template registry |
|---|---|---|---|
| Shape | FORGE is an agent that explores and writes a prompt | Staged deterministic pipeline; models at typed boundaries | Per-agent templates with slot filling |
| Provider independence | none | **canonical IR outlives agents** | none — N×M blowup |
| Testable | barely | **golden tests at every stage** | yes, but tests nothing interesting |
| Explainability | post-hoc narration, unverifiable | **trace is ground truth** | shallow |
| Build cost | low | medium | low |
| Failure | becomes "just another agent" | over-engineering | ceiling hit immediately |

**Chosen: B.** A defeats the premise — if FORGE is an agent, use Claude Code directly.
C cannot support portability, evaluation, or provenance. **Cost accepted:** upfront schema
work and 2–3 breaking IR revisions (`AOC-4`).

### AD-2 · Context by reference is the default *(retained)*
See §7 stage 3. The most consequential correction to naive "context injection" designs.

### AD-3 · Evaluation is diagnostics, not scoring *(retained)*
See §12. Permanent (`INV-008`).

### AD-4 · Strategies are IR overlays *(retained, narrowed)*
Overlays retained; `llm_novel` removed (§11.1).

### AD-5 · Capability model is static versioned data *(retained)*
MCP removed its negotiation handshake in the 2026-07-28 spec, and most targets expose no
capability API. Profiles are versioned YAML with `verified_against`.

### AD-6 · Explainability is a consequence, not a feature *(retained, widened)*
Widened from IR-node-only to typed `TraceOrigin` (§9).

### AD-7 · Single package, not a monorepo *(RETIRED — superseded by AD-21)*
Held while FORGE was CLI-only. The repository is now a two-package pnpm
workspace (`forge` core + `web`). See AD-21 and §19.

### AD-8 · Semantic/run separation *(new — revision 2)*
**Problem:** revision 1 claimed byte-identical packages while hashing objects containing
timestamps. **Decision:** split every object into a hashed semantic layer and an unhashed
run layer; hash via allowlist projection. **Rejected alternative:** freezing time in tests —
it hides the defect instead of preventing it. See §2.

### AD-9 · Typed TraceOrigin *(new — revision 2)*
**Problem:** "every span maps to an IR node" was unachievable; renderer boilerplate,
degradation notices, and profile-driven text have no IR node. **Decision:** six typed
origin kinds; byte-level total coverage. See §9.

### AD-10 · Section emitters + declarative topology *(new — revision 2)*
**Problem:** "new agent = YAML only" was false for Kiro's three-file topology.
**Decision:** profiles declare artifact topology over a closed section catalogue; bespoke
renderers become override sets; a fidelity ladder makes claims honest.
**Rejected alternative:** per-agent monolithic renderers — forces code for every target and
makes golden diffs unreadable. See §8, §6.2.

### AD-11 · Boundary registry replaces a call count *(new — revision 2)*
**Problem:** "exactly four LLM calls" constrained a count rather than a property.
**Decision:** eight enforced properties per registered boundary. **Consequence:** v0.1 needs
only `intent.extract` (required) and `critic.judge` (optional). See §13.

### AD-12 · Deterministic strategy and justification *(new — revision 2)*
**Decision:** remove `strategy.propose` (archetype scoring is a pure function) and
`context.justify` (justification falls out of retrieval provenance, which is a *fact* rather
than a judgment). **Consequence:** the entire pipeline except intent extraction runs with no
API key. **Risks recorded:** `AOC-2`, `AOC-3`. See §10.2, §11.4.

### AD-13 · Provenance is assigned by FORGE, never claimed by a model *(new — revision 3)*
**Problem:** `resolveTrust` resolves from `source_ref`, and revision 2 let a boundary write
that field. A model that had read a poisoned repository file could label the resulting
constraint `user_input`; the prescribed post-validator was bypassed by not citing the
untrusted ref, and no deterministic check could detect it afterwards.
**Decision:** remove the capability. `DraftIR` carries `derived_from: <segment id>` and no
`source_ref`; FORGE issues the segments and owns the segment → source table (§5.1a).
**Rejected alternative:** a stronger post-validator — there is nothing to validate against,
because the only evidence of origin is the field being overwritten.
**Consequence:** `SC-R8`'s guarantee becomes true for `intent.extract` as well as for
`critic.judge`. Recorded: attribution is single-segment (`AOC-11`).

### AD-14 · Trust applies to agent-steering nodes, not just instructions *(new — revision 3)*
**Problem:** `assumptions` sat outside the trust checks and `open_questions` had no
`source_ref` at all, so untrusted material reached artifacts as unattributed premises and
planted questions with zero diagnostics.
**Decision:** one closed `AGENT_STEERING` set, one exported enumeration
(`steeringNodes`/`advisoryNodeIds`) consumed by the diagnostics, the renderer and the
topology check, so they cannot drift. **Rejected alternative:** keeping the narrow set and
relying on the judged `C040` — it is off by default, needs a model, and is designed to
*accept* an assumption traceable to context.

### AD-15 · Arity is not fidelity *(new — revision 3)*
**Problem:** "`native_topology` requires ≥ 2 artifacts" contradicted AP-R8 for two
single-artifact-by-nature targets and mis-measured a third.
**Decision:** `compatibility` means one *portable* artifact; `native_topology` means the
target's own layout at any arity; the human part of the claim is carried by
`verified_against` and verified against AP-R8 by contract test (§6.2).

### AD-16 · A profile may not delete content by omission *(new — revision 3)*
**Problem:** section selection is profile data, so an omitted destination silently dropped
instruction-bearing content, and `C001`/`C002` gave false assurance that it had not.
**Decision:** `FORGE-C102` with a refusal policy graded by what losing the content costs
(§8.5). **Consequence:** the AC-017 extensibility fixture had to be completed — it was
itself lossy, which is how the defect was found.

### AD-17 · No graph runtime; the audit log is the checkpointer *(new — revision 4)*
**Problem:** the workspace turn was becoming a multi-step process (classify,
analyze, generate, verify, persist) with no explicit state, and a graph runtime
(LangGraph.js) was the obvious candidate: durable per-node checkpoints,
`interrupt()` for human-in-the-loop, cancel and resume.
**Decision: reject it, and own a `TurnPipeline` that emits `AsyncIterable<TurnEvent>`.**
The reason is not framework aversion. It is that the primitive a checkpointer
would provide is one this architecture already requires for a different reason:
PS-R3 prescribes an append-only run log plus a derivable index. **That log is the
checkpointer** — it gives resume, cancel, replay *and* the per-turn audit trail
that WS-R14 demands, from one mechanism instead of two, and it is the same event
stream the UI renders. A second checkpointing store would compete with it.
Secondary: cassette replay keys on the fully-rendered prompt (§13.3), so a
framework owning retries and state reduction sits between FORGE and its replay key.
**Rejected alternative:** adopt it in `web/` only, where the dependency cap does
not bind. Cheap to do, but it would own turn state — and turn state is where the
action→effect safety of WS-R3 lives.
**Tripwire, written so this is not re-litigated quarterly:** adopt a graph runtime
when a single turn has **≥2 human interrupt points** *and* **≥3 model calls whose
completed work must survive a process restart**. Neither holds today.

### AD-18 · Retrieval plumbing is deferred, not rebuilt *(new — revision 4)*
**Problem:** the obvious reflex when adding attachments is to import LangChain.js
loaders and splitters, or to write our own.
**Decision:** do neither yet. Attachments are currently passed whole under a
character budget, and nothing consumes chunks. Writing splitters with no consumer
is the speculative generality AD-1 rejects. Revisit at WS-R22 level L2 with a
real consumer, and prefer a small first-party implementation then, because the
core already ships ripgrep and a pinned tokenizer.

### AD-19 · The workspace uses the Vercel AI SDK; the core does not *(new — revision 4)*
**Problem:** two model paths now exist — the core's `ModelProvider` (raw fetch,
cassette-replayable, boundary-governed) and the workspace's SDK path.
**Decision:** keep both, with a stated division. The core keeps its own provider
because boundary replay and the no-network test guarantee (NFR-007) depend on it.
The workspace uses the SDK because protocol breadth and streaming are exactly what
it is good at, and it lives outside the core dependency cap.
**Consequence, recorded honestly:** this is a seam, and streaming, cancellation
and retry must not be implemented twice. It funnels through `web/lib/forge.ts`;
closing or bridging it is V2-A work, not an accident to discover later.

### AD-20 · SQLite is an index, never truth *(new — revision 4)*
**Problem:** flat per-conversation JSON does not support candidates, branches, or
querying, and inlines attachment payloads into the conversation record.
**Decision:** `node:sqlite` (built into Node 22, so no native-module build
friction), wrapped behind a repository interface because it is flagged
experimental. It indexes content-addressed objects plus an append-only run log,
and **rebuilding it from those must reproduce it exactly** (PS-R3, AC-032).
**Rejected alternative:** SQLite as the source of truth. Simpler, but it inverts
the only persistence principle this project has stated, and it discards the
replay and audit properties the log gives for free.

### AD-21 · Two packages, one core *(new — revision 4, supersedes AD-7)*
**Problem:** AD-7 said "single package, not a monorepo"; the repository has been a
two-package pnpm workspace since the workspace shipped.
**Decision:** ratify two packages — `forge` (portable, embeddable, capped at eight
runtime dependencies) and `web` (the workspace, its own budget). The boundary is
enforced by direction: `web` may depend on `forge`; `forge` may never depend on
`web`, and no dependency may be added to the core to serve the workspace.

### AD-22 · Classification is a judgment boundary *(new — revision 4)*
**Problem:** `conversation.classify` cannot be post-validated the way
`intent.extract` can. There is no deterministic check that a label is *correct* —
only that it parses, which Zod already did. §13.2's "a parser, not an architect"
framing does not stretch to cover it.
**Decision:** name it what it is — FORGE's **first judgment boundary** — and move
the validation from the label to the **effect**: a read-only action accompanied by
a version write is a failure (WS-R3). That check is deterministic, and it is where
the damage would actually occur. `required: false`, `onFailure: "skip"`, and the
skip path degrades to `DISCUSS`, the least destructive action — never to letting
the model decide whether to write a version, which is the behaviour classification
exists to remove.
**Resolved in V2-A — `conversation.generate` is registered.** The incoherence
stood: governing the cheap call and exempting the expensive one would have left
the only call that can *produce* a version outside the contract. The objection
that its output is prose is answered by scoping what the boundary governs. It
does not govern the prose. It governs

- the **envelope** (`{reply, prompt}`), which Zod can check, and
- the **action → effect** relation of WS-R3, which is deterministic: a read-only
  action accompanied by a prompt is a post-validator failure.

Its input is the rendered `{action, system, user}` triple rather than a template
the core owns, because the workspace composes the prompt from targets,
attachments and history. The cassette key is content-addressed over exactly what
was sent, which is the property §13.3 requires.

Both conversation boundaries are `required: false`, `onFailure: "skip"`. A
classifier that fails degrades to `DISCUSS`; a response FORGE cannot read
degrades to reply-only. Neither degradation can produce a version, which is the
property that matters — and both emit a diagnostic, so neither is silent
(INV-012). The pipeline re-applies the WS-R3 check before writing, because a
boundary failure must not be the only thing between a question and a spurious
version.

---

## 22. Architecture V2 — the reconciliation

### 23.1 What the audit found

The core and the product did not touch. The workspace imported seven symbols from
`forge/dist` — the model providers, the profile registry, `intent.extract`, and
the strategy source — and **nothing** from `src/ir/`, `src/compile/`,
`src/critic/`, `src/trace/` or `src/context/`.

The Task IR, the six-stage compiler, the byte-level trace system, the diagnostics
engine and the WorkspaceGuard context engine were orphaned from the product they
were built to serve, while carrying the majority of the test suite.

### 23.2 The shape

```
┌──────────────────────────────────────────────────────────────┐
│ web/ — Next.js · React                                       │
│   Conversations │ Agent activity │ Prompt Studio             │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTP + SSE (TurnEvent)
┌───────────────▼──────────────────────────────────────────────┐
│ TURN RUNTIME  (FORGE-owned — AD-17)  · built in V2-A          │
│   classify → pipeline → TurnEvent stream                      │
│   owns: conversation state transitions, cancel/resume         │
│   web/lib/turn/{events,pipeline}.ts + web/lib/store.ts        │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ DETERMINISTIC CORE (src/ — behaviour unchanged)              │
│   ir · compile · profile · critic · trace · context · strategy│
│   owns: IR, provenance, trust, diagnostics, determinism       │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ MODEL LAYER — boundary registry (core) │ AI SDK (web, AD-19) │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│ PERSISTENCE (AD-20)                                          │
│   objects/<sha256>  +  runs/*.jsonl   ← truth                 │
│   index.sqlite                        ← derivable             │
└──────────────────────────────────────────────────────────────┘
```

**Ownership, stated once.** The turn runtime owns conversation state and nothing
else. The core owns the IR, provenance, trust, diagnostics and determinism, and
is never reached around. The model layer owns transport. Persistence owns
durability. No box owns state another box also owns.

### 23.3 How the core earns its keep

The retired thesis was that structured IR improves *downstream agent execution*.
That is dead and may not be resurrected. The live claim is auditability of the
artifact, and three reconnections cash it in:

1. **Requirement preservation, in two layers of different epistemic status**
   (spec §22.8). **Layer 1 is a user-pinned ledger**: the user promotes
   requirements that matter into user-authored, verbatim, hashed content, and
   checking a version against it is *deterministic and model-free* — that is the
   mechanical guarantee `intent.md` claims. **Layer 2 is semantic drift**: a
   TaskIR extracted once per version and stored content-addressed, diffed across
   versions to surface unpinned changes in meaning, emitted as `judged`,
   `warning`-severity advice. Layer 2 is the first genuine product use of
   `canonical.ts` and `projection.ts`; Layer 1 is what makes the promise
   trustworthy. **The judged layer may never weaken the pinned layer** (WS-R27) —
   it cannot suppress or downgrade a ledger finding, its silence is never
   evidence of survival, and Layer 1 reaches its verdict whether or not Layer 2
   ran at all.
2. **"Compile for target X"** — the orphaned compiler becomes an export action,
   which is P5 resequenced to serve the product rather than precede it.
3. **Attachments through `WorkspaceGuard`** — trust tiers, secret scanning and
   untrusted fencing applied to uploads (WS-R15).

**Two corrections recorded, because both were nearly built wrong.**

`checkGoalCoverage` checks goals against verification *within one IR*, and
`checkConstraintPreservation` requires `Span[]` from **compiled** artifacts.
Neither can diff two free-text prompt versions. A preservation check is therefore
a **new code with `source: "judged"`** — never `C001`/`C002`, whose
`deterministic` source feeds `deterministic_hash` and whose whole value is
reproducibility.

And **compiling the prompt *from* the IR is rejected on purpose.** `compile()`
would work unmodified and it is the reconnection this architecture was designed
for — but it replaces conversational authoring with IR editing, and it is the
retired thesis in a new costume. Written down so the next reviewer does not have
to ask why the compiler stays an export path.

### 23.4 Residual risk

Cross-version *semantic* matching is fuzzy: node ids are model-assigned per call,
so a reworded constraint can read as a dropped one. This is precisely why the
ledger is Layer 1 rather than a fallback. The guarantee the user relies on is
deterministic and model-free; the fuzzy layer sits above it as advice, at
`warning` severity, citing both versions' statements, off the critical path, and
with its false-alarm rate measured on the existing eval corpus and recorded in
`plan.md`.

The architecture is deliberately arranged so that Layer 2 being wrong is
survivable — a noisy advisory finding costs the user a dismissal — while Layer 1
being wrong would be a defect in a deterministic check, which is testable and
fixable. Inverting the two, so that the guarantee depended on a model's
paraphrase, would have made the product's central promise only as good as an
extraction call. That is the failure mode WS-R27 exists to prevent.

### 23.5 Requirement preservation as built *(V2-D, 2026-09-17)*

| Piece | Lives in | Owns |
|---|---|---|
| The presence rule and the ledger check | `src/critic/deterministic/ledger.ts` | Tokenization, contiguous-sequence matching, `FORGE-W005`, the ledger fingerprint, deterministic pin proposals |
| The drift comparison | `src/critic/judged/drift.ts` | Statement extraction, Jaccard similarity, `FORGE-W006`, citation rendering and DG-R4 discarding |
| The place they meet | `src/critic/preservation.ts` | Holding both results side by side, and refusing any construction that mixes them |
| Ledger state and persistence | `web/lib/store.ts`, `web/lib/store/*` | `requirement_pinned` / `requirement_unpinned` / `version_ir_extracted` events, the `pinned_requirement` and `version_ir` index tables |
| Layer 2's wiring | `web/lib/preservation.ts` | Extracting each version's IR **once**, storing it by hash, and running the comparison off the critical path |

Four decisions are worth recording because a reader will otherwise ask.

**The judged layer needs no new boundary.** `FORGE-W006` carries
`source: "judged"` because its *inputs* are model-authored — two Task IRs from
`intent.extract`, a boundary that is already registered and already governed.
The comparison itself is a pure function with no model in it. That is why AD-22's
registry is unchanged by V2-D and why `critic.judge` remains unbuilt: nothing here
asks a model for a finding, so there is no envelope to govern.

**The ledger is not reachable from the turn.** Only two functions mutate it,
both called from routes a user action reaches, and the turn pipeline takes a
fingerprint before its first model call and refuses the turn if it differs
afterwards. The tripwire is unreachable in ordinary use; it exists so a future
change that made it reachable fails loudly (WS-R27.4, AC-042).

**Layer 1 is strict about meaning and forgiving about surface.** Matching is on a
normalized token sequence, so a bullet, a capital or a line break can never break
a guarantee, and a paraphrase always does. A rule that tried to be cleverer than
that would be a similarity score wearing a guarantee's clothes — and similarity
scoring is exactly what Layer 2 is for.

**Layer 2 is opt-in per version pair.** It runs on its own request rather than
inside a turn, which keeps it off the critical path (WS-R13, WS-R29) and makes
AC-040 structural: a turn has no judged layer to switch off. Its measured
false-alarm rate under surface-only change is zero (`plan.md`, V2-D), but the
honest limit of that measurement is recorded there too — it says nothing about
judgements on genuine rewordings, which have no ground truth in the corpus.

### 23.6 Candidates as built *(V2-E, 2026-09-18)*

| Piece | Lives in | Owns |
|---|---|---|
| Paragraph blocks | `src/candidate/blocks.ts` | The comparison/merge unit, keyed by the **published ledger normalization** |
| The duplicate gate and the divergence measure | `src/candidate/distinct.ts` | Token-sequence equality, `FORGE-W007`, counted block differences |
| The merge | `src/candidate/merge.ts` | The deterministic union, its per-source attribution, and its refusals |
| The generation boundary | `src/conversation/candidate.ts` | The envelope and two deterministic relations |
| Everything around them | `web/lib/candidates.ts` | Archetype choice, one call per candidate, Layer 1 per candidate, promotion, merge |
| Candidate state | `web/lib/store.ts`, `web/lib/store/*` | `candidate_added` (now with origin, rationale, score) and `candidate_promoted`; the `candidate` and `candidate_promotion` index tables |

Five decisions are worth recording because a reader will otherwise ask.

**A fourth boundary was registered, and it had to be.** `MB-R1` admits no
ungoverned language-model invocation, and generating an alternative is one.
`conversation.candidate` governs what AD-22 says a conversation boundary
governs — the envelope, plus deterministic relations — and nothing about the
prose: a candidate must carry a prompt, and it must not be the base reworded.
It carries **no `action`**, which is `WS-R2` stated structurally rather than
asserted: the boundary has no action to write a version under, so no response
to it can become one. `critic.judge` remains unbuilt for the same reason V2-D
left it unbuilt — nothing here asks a model for a finding.

**Distinctness is the §9 system, reused, plus one gate it cannot cover.**
Candidates are generated one per archetype, and the archetypes are already held
pairwise distinct by `checkDistinctness` over derived overlays (§11.5) — that
result is returned with the set as the structural evidence. What §11.5 cannot
see is that a model may return the same prose under two different structures,
so `admitCandidates` adds a **token-sequence equality** check over the returned
texts. Equality, not a threshold: a similarity score deciding which
alternatives a user is shown would be a judgement wearing a mechanism's
clothes, which is the distinction Layer 1 of preservation already turns on.
How far apart the survivors are is reported as a *count* of differing blocks
and never as a gate, because `INV-008` forbids the composite score a gate would
need. No second strategy system was introduced; the plan's one prohibition.

**`MERGE` has no model in it.** The thing a user must believe about merging two
candidates is that nothing either of them said was lost, and that belief is
worth exactly what the mechanism behind it is worth. The mechanism is a union
of paragraph blocks keyed by the ledger's own normalization, emitted in
first-appearance order. The guarantee is stated exactly rather than generously:
**every block of every source reaches the result**, so a pinned requirement
lying inside one block survives by construction; and the **first** source keeps
its block order and adjacency, so anything contiguous across its blocks stays
contiguous. A later source's block that the first already had is emitted at the
first's position, which can separate two of that later source's blocks — so a
requirement spanning a block boundary *there* is not guaranteed by
construction. That residual is why the caller runs Layer 1 over the merged text
before the version is written: the guarantee is mechanical and bounded, and the
ledger check is what makes the remainder loud rather than silent (`INV-012`).

**Generating never promotes, and the code shape says so.** `generateCandidates`
writes to `convo.candidates` and to the run log and to nothing else; its result
carries `versionCreated: false` as a literal so a caller can see the property
without reading the implementation. Promotion and merge are separate routes,
each reachable only from a user gesture, and each records a `candidate_promoted`
event naming the artifacts it used (`ST-R6` — "the choice is recorded"). The
ledger fingerprint is taken before the first candidate call and checked after
the last, exactly as the turn pipeline does, so `WS-R27.4` holds on this path
too.

**One archetype failing costs one alternative.** `MB-R3` permits `skip`, and a
transport or envelope failure on one archetype drops that candidate with a
recorded diagnostic while the rest generate. When **every** archetype fails the
original error is re-thrown rather than returned as an empty set, because an
empty set reads as "the model had no alternatives to offer", which is not what
happened. This path exists because the first live run found it: Kimi K3 spent a
4000-token budget entirely on reasoning and returned nothing, which was a budget
defect (the candidate budget is now 12000 — a candidate is a full rewrite, not a
chat reply) surfacing as a total request failure.

**The calls run concurrently, and the result does not depend on who answers
first.** The second live failure was a five-minute client header timeout:
three reasoning-model calls in one request, one after another, is longer than
any real client waits. The calls are independent by construction — one per
overlay, none reading another's answer — so they are dispatched together and
their outcomes are consumed **in fit order**, which keeps the run log, the
diagnostics and the candidate list functions of the request rather than of the
network. Raising the timeout was considered and rejected: it moves the wall
instead of removing it, and a browser would still give up. Determinism under
concurrency is asserted offline rather than assumed, with a transport that
answers in a deliberately awkward order.


### 23.7 Verification as built *(V2-G, 2026-09-21)*

```
package dir ──read (safeJoin, regular files only)──▶ files: Map<path, bytes>
                                                          │
                              src/verify/contract.ts  validatePackage
                              schemas → listed hashes → REBUILD from own inputs
                              (IR, strategy, pinned reqs, named profile) → every
                              semantic byte equal?  ──no──▶ FORGE-V004, no verdicts
                                                          │ yes: semantic_id is now trusted
evidence file ──src/verify/evidence.ts (strict schema, hashes only)──┐
                                                          ▼
                              src/verify/verdict.ts   per record: other package → V003;
                              unknown / wrong kind / no exit code / log hash ≠ → V005;
                              per obligation: manual|review → REVIEW_REQUIRED,
                              none → UNVERIFIED (V001), any unexpected exit → FAILED (V002),
                              else VERIFIED
```

**Why a rebuild and not a hash check.** `semantic_id` covers the compiler's
inputs and the artifacts; `verification.json`, `trace.json` and the other
derived files are fixed by those inputs but not hashed into the id, and
`package.json` is anchored by nothing. Re-listing an edited file's hash is
therefore undetectable by hashes alone. `INV-005` makes the rebuild a
complete check: one input tuple has one set of semantic bytes. It costs one
deterministic compile and runs nothing (`INV-004`).

**One implementation, three surfaces.** `forge verify`, `forge explain
--package --evidence` and the Studio's Verify box (via `web/lib/verify.ts`)
all call `verifyPackage`. `tests/contract/verify-boundaries.test.ts` asserts
nothing else imports `src/verify/` — in particular nothing a model boundary
reaches (`EV-R1`) — and `tests/contract/no-execution.test.ts` covers every new
module.

**What it cannot do.** Evidence is unsigned. A fabricator who recomputes hashes
is undetectable, and `VERIFIED` is stated as exactly what it is: the supplied
evidence, taken at its word, shows the expected exit code.

---

## 23. Revision changelog

### Revision 4 — V2 reconciliation

Triggered by an audit that found the product and the core had stopped touching
each other. Documentation-only; no behaviour changed.

1. **Reconciled the workspace.** `web/` existed for weeks without appearing in
   `intent.md`, `spec.md`, this document, or `plan.md`. Now specified (spec §22,
   WS-R1…WS-R23) and architected (§22 here).
2. **AD-17** — rejected a graph runtime, on the grounds that the append-only run
   log PS-R3 already requires *is* the checkpointer. Tripwire written.
3. **AD-18…AD-22** — LangChain deferred entirely; AI SDK ratified for `web` only;
   `node:sqlite` as a derivable index; two packages ratified (retiring AD-7);
   classification named as the first judgment boundary.
4. **Corrected §13.** Earlier revisions showed `critic.judge` in the boundary
   registry. It was never built; the registry holds exactly `intent.extract`. The
   property-5 test's hardcoded input shape is now recorded as a sharp edge.
5. **Retired AD-7** — the repository has been a two-package workspace since `web/`
   shipped.
6. **Scoped NFR-010.** The eight-dependency cap is the *core's*; `web` has its own
   budget. AC-023 previously claimed an assertion that did not exist.
7. **Amended NFR-002 and PS-R4** — "no server" was written when FORGE was
   CLI-only. A local process the user starts is not a daemon or a hosted backend.
8. **Recorded two near-misses** in §22.3: `C001`/`C002` cannot diff prompt
   versions, and compiling the prompt from the IR is rejected deliberately rather
   than overlooked.

### Revision 3 — security and specification hardening (P1.4)

Found by auditing the P0/P1 implementation against this document and `spec.md`, and
**reproduced by execution** rather than by inspection. Each was live in the code.

| # | Defect | Correction |
|---|---|---|
| 1 | `assumptions` were outside the trust checks and `open_questions` had no `source_ref`. An assumption sourced from an untrusted page rendered as an unattributed `confidence: high` premise with **zero** diagnostics. | §5.1 `AGENT_STEERING`; `IR-R5`; `INV-002` widened to "instruction **or premise**"; `AD-14` |
| 2 | A model boundary could write `source_ref`, so injected content could relabel itself `user_input`. The prescribed post-validator was bypassable by construction. | §5.1a input segments; `INV-016`, `IR-R15`, `MB-R6`; `AD-13` |
| 3 | Only 4 of 11 emitters honoured advisory demotion, so `C052` described a rendering the renderer did not perform for goals, verification, deliverables, objective, scope, assumptions or questions. | §5.3; one shared `advisoryNodeIds`; `AC-028` |
| 4 | A profile omitting a section silently deleted the content only that section renders — reproduced against this repository's own AC-017 fixture. `C001`/`C002` gave false assurance. | §8.5 `FORGE-C102`; `INV-017`, `FR-050`; `AD-16` |
| 5 | `native_topology` required ≥ 2 artifacts, contradicting `AP-R8` for two single-artifact-by-nature targets; the spec's fidelity table was unverified prose. | §6.2 arity is not fidelity; AP-R8 verified by contract test; `AD-15` |
| 6 | The tokenizer took its encoding from the package's *default* export while declaring a specific one, recorded a hand-typed version against a `^` range, and was asserted only for truthiness. | Explicit `o200k_base` import; exact pin; identity asserted against the installed package; recorded on `CompileResult` |
| 7 | The CLI had no tests. Exit 4 was unreachable (`error.name.includes("Error")` is true of every error) and commander's parse failures exited 1, colliding with "diagnostics at error severity". | Allowlisted usage errors; `exitOverride`; `parseAsync` so P1.5's async command cannot escape the handler; `tests/contract/cli.test.ts` |
| 8 | `AOC-10` (byte-level trace coverage unproven) was resolved in P1 but still documented as open. | Marked resolved in `spec.md` §21 |

### Revision 2 changelog

| # | Defect in revision 1 | Correction |
|---|---|---|
| 1 | Claimed "byte-identical package" (`:73, :536, :744`) while the IR carried `created_at` and `retrieved_at` (`:232, :277`) | §2 semantic/run split; §3.2 allowlist projection; AD-8 |
| 2 | "Exactly four LLM calls" as an architectural invariant (`:162`) | §13 boundary registry with eight properties; AD-11 |
| 3 | "Every span maps to an IR node" (`:49, :215, :666, :745`) unachievable given renderer and compiler-generated text | §9 typed `TraceOrigin`; byte-level coverage; AD-9 |
| 4 | `llm_novel` strategy candidate (`:460, :480, :664`) | §11.1 archetypes only; AD-4 narrowed |
| 5 | Kiro marked `renderer: generic` (`:394`) with a "zero TypeScript changes" claim (`:431`) it could not satisfy | §8 declarative topology; §6.2 fidelity ladder; `C101`; AD-10 |
| 6 | `C050` claimed to check verification (`:503`) but only goals and constraints carried `source_ref` (`schema.ts:120, :130`) | §5.1 closed instruction-bearing set; `non_goals` structured; `IR-R5` |
| 7 | `materialization` stored in the IR (`schema.ts:154`) while the compiler decided it | §4.3 removed; it is a compilation result |
| 8 | Hash exclusion was a **denylist** (`schema.ts:291`) — new fields hashed by default | §3.2 allowlist projection; `INV-015` |
| 9 | `ModelCall.site` hardcoded four sites (`schema.ts:255`) | §13 registry-derived boundary ids |
| 10 | Product requirements and acceptance criteria lived in the architecture document | Moved to `spec.md`; this document cross-references ids |

**Consequence for existing code.** `src/ir/*.ts` was written against revision 1 and
contradicts items 1, 6, 7, 8, and 9. It is stale and must be discarded or rewritten before
P0 — see `plan.md` §P0.

---

## 24. Risks

| Risk | Severity | Mitigation | Tracked as |
|---|---|---|---|
| FORGE does not beat handing the raw task to a strong agent | **critical — realized** | Ran twice (P1.5 RECONSIDER, P1.6 FAIL); thesis retired and project repositioned as an auditable compiler (`intent.md` P1.7). Closed as a risk; retained here as history. No win-seeking trial without a new mechanism. | `AOC-1`, `AC-025` |
| Model invents goals/constraints from vague input | high | `open_questions` and `assumptions` give the model a *legal place to be uncertain*; post-validators; adversarial corpus subset | `FR-002` |
| IR schema thrash | high | `ir_version` + migrations from P0; small regenerable fixtures; schema not frozen until after P1.5 | `AOC-4` |
| Fit rules cruder than model judgment for strategy | medium | Measured against corpus; reintroducing a boundary is additive | `AOC-2` |
| Retrieval-derived justification too coarse | medium | Precision measured; interface admits a boundary | `AOC-3` |
| Byte-level trace coverage impractical for some emitters | medium | Prototyped in P1 before being relied upon; revise `spec.md` if needed rather than relaxing silently | `AOC-10` |
| Profile topology insufficient for some target | medium | Fidelity ladder provides an honest fallback | `AOC-5` |
| `semi_trusted` repository content genuinely unsolved | medium | Advisory rendering + visible attribution; documented as a limitation | `AOC-6` |
| Tokenizer drift breaks reproducibility | medium | Tokenizer pinned in the semantic input tuple | `AOC-7` |
| Package assumes the pinned commit | medium | `runtime-contract.json` pins commit + dirty flag; executor's responsibility | `AOC-8` |
| FORGE latency/cost exceeds patience | medium | `--no-llm`, hand-authored IRs from P0, one required boundary, content-hash caching | `AOC-9` |
| Diagnostic codes proliferate into noise | low | Every code needs a triggering fixture (`DG-R5`) | — |
| Generic-fidelity targets produce bland output | low, accepted | Explicit tradeoff; overrides added on evidence | `AP-R6` |

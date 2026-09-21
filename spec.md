# FORGE — Specification

> **Authority:** this document owns *what must be built* — product behavior,
> requirements, invariants, and acceptance conditions. It is the contract.
>
> - *Why* → [`intent.md`](intent.md)
> - *How* → [`docs/architecture.md`](docs/architecture.md)
> - *In what order* → [`plan.md`](plan.md)
>
> Where this document and `docs/architecture.md` disagree, **this document wins** and
> the architecture document is wrong and must be corrected.
>
> **Status:** P0, P1, P1.4, P1.5, P1.6, P2, P3 and P4 are implemented and verified.
> P5 (Execution Package, persistence, `forge explain`) and P6 (full-fidelity
> renderer, judged diagnostics) are **not started**. The P1.5/P1.6 thesis gates ran
> and returned RECONSIDER then FAIL; the structure-beats-raw claim is retired
> (`intent.md`, AOC-1). IR 1.0 was **frozen at P3** (AOC-4). A conversational web
> workspace now exists and is specified here from §22 onward.
> **Spec version:** 0.3.0 · **IR version:** 1.0 (frozen)

---

## Table of contents

1. [Terminology](#1-terminology)
2. [Product Behavior](#2-product-behavior)
3. [Core Invariants](#3-core-invariants-inv)
4. [Functional Requirements](#4-functional-requirements-fr)
5. [Non-Functional Requirements](#5-non-functional-requirements-nfr)
6. [Task IR Requirements](#6-task-ir-requirements)
7. [Agent Capability Requirements](#7-agent-capability-requirements)
8. [Context Engine Requirements](#8-context-engine-requirements)
9. [Strategy Requirements](#9-strategy-requirements)
10. [Diagnostic / Evaluation Requirements](#10-diagnostic--evaluation-requirements)
11. [Execution Package Contract](#11-execution-package-contract)
12. [Provenance Requirements](#12-provenance-requirements)
13. [Security Requirements](#13-security-requirements)
14. [Model Boundary Requirements](#14-model-boundary-requirements)
15. [CLI Requirements](#15-cli-requirements)
16. [Persistence Requirements](#16-persistence-requirements)
17. [Testing Requirements](#17-testing-requirements)
18. [Open-Source Extension Contract](#18-open-source-extension-contract)
19. [Acceptance Criteria](#19-acceptance-criteria-ac)
20. [Explicit Deferred Work](#20-explicit-deferred-work)
21. [Areas of Concern](#21-areas-of-concern)

---

## 1. Terminology

| Term | Meaning |
|---|---|
| **Task IR** | The canonical, provider-independent structured representation of a task. |
| **Semantic layer** | The subset of any FORGE object that is canonical, deterministic, and hashed. |
| **Run instance** | Volatile execution metadata (timestamps, latency, model identity). Never hashed. |
| **`semantic_hash`** | `sha256` over the canonical serialization of an object's semantic projection. |
| **DraftIR** | Unvalidated Task IR proposed by a model boundary; carries no identity. |
| **EffectiveIR** | Task IR after a strategy overlay has been applied. The compiler's actual input. |
| **AgentProfile** | Versioned YAML data describing one target agent's capabilities and output topology. |
| **Fidelity** | An honest claim about how well FORGE can target an agent: `full`, `native_topology`, or `compatibility`. |
| **Legalization** | Reconciling the IR's required capabilities against a profile; refusing or degrading. |
| **Materialization** | The compile-time decision to emit a context reference `by_reference`, `by_value`, or `summary`. |
| **Section emitter** | A pure function rendering one named section of an artifact. |
| **Artifact topology** | A profile-declared list of output files and the sections each contains. |
| **Strategy overlay** | A structured delta applied to a Task IR. Never prose. |
| **TraceOrigin** | A typed attribution for a span of rendered output. |
| **Diagnostic** | A coded finding with severity and mandatory evidence. Never a score. |
| **Execution Package** | The reviewable output bundle. FORGE's terminal product. |
| **Model boundary** | A registered, schema-constrained, replayable site where a language model is called. |
| **Instruction-bearing node** | An IR node that tells the target agent what to do or not do. |
| **Influence-bearing node** | An IR node that steers the agent without commanding it: a premise it is told to work from, or an undecided question shown with the default it will proceed under. |
| **Agent-steering node** | Instruction-bearing ∪ influence-bearing. **The set the trust model applies to** (§13.2, SC-R1). Agents read tokens, not trust labels, so "a premise, not an instruction" is not a distinction the threat model may rely on. |
| **Input segment** | One numbered unit of the input FORGE hands to a model boundary, with a FORGE-assigned `source_ref`. A boundary cites a segment; it never states a source (INV-016). |

---

## 2. Product Behavior

### 2.1 The primary flow

```
$ forge task "debug the intermittent auth session drop without changing
              the AuthProvider interface"
```

FORGE moves through these observable stages. Each is inspectable and each can be
entered directly via its own subcommand.

| # | Stage | What the user sees | Model involved |
|---|---|---|---|
| 1 | **Intake** | Repo detected, commit pinned, config loaded. | no |
| 2 | **Intent extraction** | A DraftIR is proposed from the natural-language input. | **yes** — `intent.extract` |
| 3 | **Clarification** | Blocking questions asked interactively. Non-blocking questions become recorded assumptions. | no |
| 4 | **Canonical IR** | The Task IR is printed for review, with its `semantic_hash`. The user may edit it and re-validate. | no |
| 5 | **Context resolution** | Ranked, justified context references. Each shows what it justifies and why it was found. | no |
| 6 | **Target selection** | The chosen agent profile, its fidelity claim, and any capability gaps. | no |
| 7 | **Legalization** | Hard capability gaps refuse compilation. Soft gaps degrade with a visible diagnostic. | no |
| 8 | **Strategy** | Archetype candidates, each a structured overlay, with the fit rule that selected it. | no |
| 9 | **Compilation** | Rendered artifacts for the target's topology. | no |
| 10 | **Diagnostics** | Coded findings with evidence; a ranking with the deciding rule step named. | optional — `critic.judge` |
| 11 | **Execution Package** | A directory the user can read, keep, diff, and hand to an agent. | no |

**FORGE stops at step 11.** It never launches an agent (INV-004).

### 2.2 Interaction principles

- **The IR is the review surface.** The user reviews structure, not prose. `forge ir show`
  and `forge ir edit` are first-class, and a hand-authored IR is a fully supported input
  requiring no model call at all.
- **Uncertainty is never silently resolved.** Ambiguity becomes an `open_question`.
  Blocking questions halt; non-blocking questions become explicit `assumptions` visible
  in the package.
- **Nothing is unexplained.** Any byte of any artifact can be traced to its origin with
  `forge explain`, without a model call.
- **Refusal beats guessing.** A hard capability gap, an untrusted instruction, or a
  schema failure that survives repair is an error, not a degraded best effort.

### 2.3 Non-interactive use

Every command must be usable non-interactively (`--yes`, `--strict`, machine-readable
`--json` output) so FORGE can run in CI and inside other agents' tool loops.

---

## 3. Core Invariants (INV)

Invariants are properties that must hold in **every** release. Each is mechanically
verified by at least one test (see §17). A change that breaks an invariant is a design
change requiring an update to this document, not a bug fix.

| ID | Invariant | Verified by |
|---|---|---|
| **INV-001** | The Task IR contains no vendor name, agent name, concrete tool name, output filename, prose formatting directive, model identifier, or token budget. It speaks abstract capabilities only. | AC-001 |
| **INV-002** | Content whose resolved trust is `untrusted` can never become an authoritative instruction **or premise** through **any** Task IR field. The check applies to every *agent-steering* node (§1), instruction-bearing and influence-bearing alike. | AC-010 |
| **INV-003** | A `hard` constraint present in the EffectiveIR always appears in the rendered artifacts. It can never be dropped by budgeting, degradation, or rendering. | AC-004 |
| **INV-004** | FORGE never executes an agent, a shell command from an IR, a worktree operation, or a container. Verification specs are emitted as data, never run. | AC-020 |
| **INV-005** | For a fixed semantic input tuple (§6.4), all semantic outputs are byte-identical across runs, machines, and wall-clock times. | AC-005 |
| **INV-006** | Every `ContextRef` in a valid Task IR has a non-empty `justifies` list, and every entry resolves to an existing node. | AC-007 |
| **INV-007** | Every diagnostic carries a code, a severity, and at least one piece of evidence (a node id, a span, or a measured quantity with units). | AC-012 |
| **INV-008** | No FORGE output contains a synthesized composite quality score. Only measured quantities with units and coded diagnostics. | AC-013 |
| **INV-009** | Every language-model invocation goes through a registered model boundary satisfying all eight boundary properties (§14.1). | AC-016 |
| **INV-010** | 100% of non-whitespace bytes in every rendered artifact belong to exactly one trace span with a typed, resolvable origin. | AC-006 |
| **INV-011** | All filesystem reads for context flow through the single `WorkspaceGuard` gateway. No other module performs filesystem access for context. | AC-011 |
| **INV-012** | No degradation, drop, redaction, demotion, or refusal is silent. Each emits a diagnostic recorded in the package. | AC-009 |
| **INV-013** | Volatile run data (timestamps, latency, model identity, scores, host metadata) never participates in any semantic hash. | AC-005 |
| **INV-014** | A profile's declared `fidelity` never exceeds what its renderer can actually produce. | AC-018 |
| **INV-015** | The canonical hash is computed over an explicit **allowlist** projection. A newly added field is excluded from hashing until deliberately added to the projection. | AC-005 |
| **INV-016** | **A model boundary never states provenance.** No boundary output may carry `source_ref`. Every attributable node in a boundary's output cites an **input segment** id, and FORGE resolves segment → `source_ref` from the table it built when it assembled the input. Trust is therefore a property of the input, not a claim the model makes about it. | AC-026 |
| **INV-017** | Content present in the EffectiveIR is never absent from the rendered artifacts because the target's topology declared no destination for it. A missing destination for instruction-bearing or advisory-required content **refuses** compilation; for other content it emits `FORGE-C102` and is recorded. | AC-027 |

---

## 4. Functional Requirements (FR)

### 4.1 Intake and intent

| ID | Requirement | Phase |
|---|---|---|
| **FR-001** | Accept a natural-language task via `forge task "<text>"`, plus optional flags for target agent, strategy, and explicit file inclusions. | P3 |
| **FR-002** | Produce a `DraftIR` from natural language through the `intent.extract` model boundary. The boundary must never invent goals, constraints, or scope not derivable from the input; unsupported material must instead surface as an `assumption` or `open_question`. | P3 |
| **FR-003** | Repair a schema-invalid `DraftIR` by re-invoking the boundary with the validation errors, at most twice. A third failure is a hard error. No fallback, no partial acceptance. | P3 |
| **FR-004** | Classify uncertainty as `blocking` or non-blocking. Blocking questions halt the pipeline and are asked interactively (or fail under `--yes`). Non-blocking questions become recorded `assumptions`. | P3 |
| **FR-005** | Accept a hand-authored Task IR file as a complete substitute for FR-001–FR-004, requiring no model call and no API key. | P0 |

### 4.2 Task IR

| ID | Requirement | Phase |
|---|---|---|
| **FR-006** | Define the Task IR as a Zod schema that is the single source of truth for TypeScript types, runtime validation, and exported JSON Schema. | P0 |
| **FR-007** | Compute `semantic_hash` over an allowlist projection using a canonical serialization (§6.4). | P0 |
| **FR-008** | Validate an IR in two separable stages: **shape** (schema) and **semantics** (referential integrity and lint), so semantic failures produce coded diagnostics rather than raw parser errors. | P0 |
| **FR-009** | Refuse to load an IR whose `ir_version` major is unknown. Apply explicit registered migrations for known older minors. | P0 |
| **FR-010** | Export the JSON Schema as a build artifact under `schema/`, and verify in CI that it matches the current Zod definitions. | P0 |
| **FR-011** | Provide `forge ir show`, `forge ir validate`, `forge ir edit`, and `forge ir hash`. | P0/P5 |

### 4.3 Agent profiles and legalization

| ID | Requirement | Phase |
|---|---|---|
| **FR-012** | Load agent profiles from `profiles/*.yaml` as pure data, validated against the `AgentProfile` schema. The compiler must not import any profile as code. | P1 |
| **FR-013** | Ship validated profiles for all seven v0.1 targets: `claude-code`, `openai-codex`, `opencode`, `kiro`, `hermes-agent`, `deepseek-harness`, `claude-design`. | P1 |
| **FR-014** | Each profile declares a `fidelity` of `full`, `native_topology`, or `compatibility`, and a `verified_against` date. | P1 |
| **FR-015** | Legalize `required_capabilities` against the profile: an absent **hard-required** capability refuses compilation (`FORGE-C030`); an absent soft capability applies a registered degradation rule and emits `FORGE-C031`. | P1 |
| **FR-016** | Degradation rules are a closed, named registry. Each rule records what it changed and why in the trace and the diagnostics. | P1 |
| **FR-017** | `forge doctor` reports stale profiles (by `verified_against` age), missing external tools, and configuration problems. | P6 |

### 4.4 Compilation and rendering

| ID | Requirement | Phase |
|---|---|---|
| **FR-018** | Apply a strategy overlay to a Task IR producing an `EffectiveIR`, recording for each added or modified node the `TraceOrigin` that introduced it. | P4 |
| **FR-019** | Decide materialization per context reference from `profile.retrieval.autonomous_search`, the reference's role, and the token budget. Default to `by_reference` for `strong`-retrieval targets. | P2 |
| **FR-020** | Allocate a token budget across sections by a published policy. Goals and hard constraints are never droppable. Every drop emits `FORGE-C061` naming the item and the reason. | P1 |
| **FR-021** | Render via a closed registry of named **section emitters**, composed according to the profile's declared **artifact topology**. Profiles select and order section keys; they cannot define new emitters. | P1 |
| **FR-022** | Support per-profile **section overrides** for `full`-fidelity targets: a registered override replaces one section emitter without replacing the renderer. | P6 |
| **FR-023** | Emit a trace assigning every non-whitespace byte of every artifact to exactly one span with a typed `TraceOrigin` (§12.2). | P1 |
| **FR-024** | Support path templating in artifact topologies from a closed, validated variable set. | P1 |
| **FR-050** | Verify, per compilation, that the target's artifact topology declares a destination for every class of content the task contains. A missing destination emits `FORGE-C102` naming the content class, the acceptable destination sections, and the affected nodes. It **refuses compilation** when the class is instruction-bearing or carries nodes the trust model demoted to advisory; otherwise it is recorded as an explicit degradation. | P1 (hardened pre-P1.5) |
| **FR-051** | Suppress rendered lines that restate content the same artifact already carries, from a **closed whitelist of categories** and never from `constraints` or `stop_conditions`. A line may be suppressed only when its token sequence still occurs contiguously in the artifact that ships, so no presence verdict under §22.8 can change. Every suppression emits `FORGE-C103` citing the node and the withheld text. Size is never a reason to suppress and no section is ever removed. | V2-R |

### 4.5 Context engine

| ID | Requirement | Phase |
|---|---|---|
| **FR-025** | Generate context candidates deterministically: lexical search (ripgrep) over terms derived per instruction node, path globs from `scope`, git history restricted to scope, and explicit user-supplied files. No embeddings. | P2 |
| **FR-026** | Derive `justifies` from **retrieval provenance**: a candidate found by a query derived from node `X` justifies `X` by construction. Explicitly supplied files require an explicit justification or are rejected with `FORGE-C010`. | P2 |
| **FR-027** | Rank candidates by a published, inspectable deterministic function. Ranking inputs and outputs are recorded in the run instance. | P2 |
| **FR-028** | Assign `role` by a documented deterministic rule table, emitting a diagnostic where the rule is low-confidence. | P2 |
| **FR-029** | Route every context filesystem read through `WorkspaceGuard`, which enforces the path jail, ignore rules, deny globs, and secret scanning before content becomes representable. | P2 |
| **FR-030** | Assign a trust tier to every context reference from its source class, and enforce the trust rules of §13.2. | P2 |

### 4.6 Strategy

| ID | Requirement | Phase |
|---|---|---|
| **FR-031** | Define strategy archetypes as **data** in `strategies/*.yaml`: an overlay template with typed, bounded parameters. v0.1 ships `surgical`, `rigorous`, `autonomous`, `exploratory`. | P4 |
| **FR-032** | Select and parameterize archetypes **deterministically** from IR signals via a published fit-rule engine. **No model boundary participates in strategy generation in v0.1.** | P4 |
| **FR-033** | Generate the strategy `rationale` deterministically from the fit-rule trace (which signals matched which rule), not as free prose. | P4 |
| **FR-034** | Verify pairwise structural distinctness of candidate strategies above a published threshold; reject and record any candidate that fails. | P4 |
| **FR-035** | Provide a `StrategySource` extension point such that a future non-archetype source can contribute candidates **without any change to the Task IR schema**. | P4 |

### 4.7 Diagnostics and evaluation

| ID | Requirement | Phase |
|---|---|---|
| **FR-036** | Implement the deterministic diagnostic codes of §10.2 as pure functions over `(EffectiveIR, AgentProfile, artifacts, trace)`. | P1/P4 |
| **FR-037** | Support optional LLM-judged diagnostics via the `critic.judge` boundary, disabled by default. Any judged finding whose citation does not resolve to a real node or span is **discarded before display**. | P6 |
| **FR-038** | Rank candidates by the published lexicographic rule (§10.3) and report **which rule step decided the outcome**. | P4 |
| **FR-039** | Report measured quantities with explicit units alongside diagnostics. Never aggregate them into a composite score. | P4 |

### 4.8 Package, provenance, persistence

| ID | Requirement | Phase |
|---|---|---|
| **FR-040** | Emit an Execution Package conforming to the contract in §11. | V2-F |
| **FR-041** | Emit a `runtime-contract.json` declaring required tools, permissions, network policy, and the pinned repository commit. It **declares**; it never grants. | V2-F |
| **FR-042** | Emit a `verification.json` of executable command specifications with expected outcomes, as data. | V2-F |
| **FR-043** | Implement `forge explain` as a pure provenance lookup over the trace and provenance graph. It must never invoke a model. | V2-F |
| **FR-044** | Persist objects in a content-addressed store, runs in an append-only log, and an index for query. No server or daemon. | V2-F |
| ~~**FR-045**~~ | ~~Provide `forge history` and `forge diff <a> <b>` over stored IRs and packages.~~ **Dropped 2026-09-21.** The workspace has been the history and diff surface since V2-C, and a second CLI surface over the same store is duplicate product, not portability. Package-to-package comparison is covered by `AC-005`, which any `diff -r` satisfies. | ~~P5~~ |
| **FR-046** | Provide `forge export` producing a self-contained, relocatable package directory. | V2-F |
| **FR-052** | Assign every requirement a stable, conversation-scoped identity with a FORGE-assigned immutable `origin`, per §22.9. | V2-F |

### 4.9 Model provider

| ID | Requirement | Phase |
|---|---|---|
| **FR-047** | Access all models in the **core** through a `ModelProvider` interface. Ship an Anthropic implementation and a minimal OpenAI-compatible implementation. No framework may own the Task IR, the compiler, provenance, trust, or diagnostics (AD-17). | P3 |
| **FR-048** | Support cassette record/replay keyed by content hash so the full suite runs deterministically without network or API keys. | P3 |
| **FR-049** | Record every model invocation in the run instance: boundary id, provider, model identifier, prompt hash, output hash, repair count, latency, timestamp. | P3 |

---

## 5. Non-Functional Requirements (NFR)

| ID | Requirement | Acceptance |
|---|---|---|
| **NFR-001** | **Determinism.** Semantic outputs are byte-identical for a fixed semantic input tuple. Achieved by architectural separation of semantic and run layers — **not** by freezing time in tests. | AC-005 |
| **NFR-002** | **Local-first.** No hosted backend, no multi-user service, no telemetry, no background daemon. The workspace is served by a local process the user starts and stops. In the **CLI**, network access is off by default and requires an explicit domain allowlist; in the **workspace**, the only permitted egress is to model providers the user configured, and it is recorded (§22.4). | AC-021, AC-031 |
| **NFR-003** | **Provider independence.** No vendor-specific concept appears in the IR or the compiler core. Swapping `ModelProvider` requires no change outside `src/model/`. | AC-001 |
| **NFR-004** | **Extensibility.** Adding a target at `compatibility` or `native_topology` fidelity requires only a YAML profile and zero TypeScript changes. | AC-017 |
| **NFR-005** | **Explainability.** Attribution is mechanical and total (INV-010), never generated. | AC-006 |
| **NFR-006** | **Security.** The boundaries of §13 are enforced by code and verified by adversarial corpora, not by prompt instructions. | AC-010, AC-014, AC-015 |
| **NFR-007** | **Testability without credentials.** The entire suite except explicitly-marked live evaluations passes with no API key and no network. | AC-019 |
| **NFR-008** | **Performance.** On a repository of ≤50k files, non-model stages complete in ≤3s wall-clock; context resolution in ≤5s. Budgets are asserted, and regressions fail CI. | AC-022 |
| **NFR-009** | **Reproducibility.** Compilation is reproducible across machines and operating systems given the same pinned inputs. Path separators, locale collation, and line endings must be normalized. | AC-005 |
| **NFR-010** | **Minimal dependencies, per package.** The `forge` **core** package is capped at **eight** runtime dependencies (6 today); it is the portable, embeddable artifact and the cap is what keeps it so. The `web` package has its own declared budget of **fourteen** (11 today) and must justify each addition in `docs/architecture.md` §21. Exceeding either cap requires an ADR. A dependency may not be added to the core to serve the web package. | AC-023 |
| **NFR-011** | **Observability.** Every stage emits a structured run event. `--json` produces machine-readable output for every command. | AC-024 |
| **NFR-012** | **Versioning.** Three independent axes — `forge_version`, `ir_version`, `profile.version` — are pinned in every package. Unknown IR majors are refused. | AC-008 |

---

## 6. Task IR Requirements

> Full schema and field-level rationale: [`docs/architecture.md` §4](docs/architecture.md).
> This section states the *requirements* the schema must satisfy.

### 6.1 Structural requirements

- **IR-R1.** Every node carries a stable id matching `^<prefix>[0-9]+$` — `g`(goal),
  `c`(constraint), `n`(non-goal), `ctx`(context ref), `a`(assumption), `q`(open question),
  `v`(verification), `d`(deliverable). Strict ids make model citations mechanically
  checkable and keep `forge explain` readable.
- **IR-R2.** All node id references (`justifies`, `satisfies`, `source_ref`,
  `default_assumption_ref`) must resolve. Dangling references are a coded error.
- **IR-R3.** The IR contains no compile-time decisions. `materialization`, `est_tokens`,
  and budget outcomes belong to the compilation result, not the canonical IR.
- **IR-R4.** The IR contains no operational metadata. Timestamps, scores, retriever
  identity, and model identity belong to the run instance.

### 6.2 Instruction provenance requirements

- **IR-R5.** Every **agent-steering node** (§1) carries `source_ref`.
  - **Instruction-bearing** (commands the agent): `objective`, `goals`, `constraints`,
    `non_goals`, `verification`, `deliverables`, `scope`.
  - **Influence-bearing** (steers without commanding): `assumptions`, `open_questions`.

  Both sets are subject to identical trust rules (SC-R1). A structural test asserts every
  member's schema declares `source_ref`; adding a member without one fails the build.

  > **Corrected before P1.5.** `open_questions` previously carried no `source_ref` at all,
  > so their trust could not be resolved even in principle, and `assumptions` were excluded
  > from the trust checks. Both were trust-laundering channels: untrusted material reached
  > the artifact as an unattributed `confidence: high` premise, or as a question rendered
  > beside the default the agent was told to proceed under, with no diagnostic.
- **IR-R6.** `source_ref` is one of: `user_input`, `forge_derived`, a `StrategyId`, or a
  `ContextRefId`.
- **IR-R7.** Trust is **resolved**, never stored redundantly on the node — a stored copy
  can desynchronize from its source. `resolveTrust(ir, source_ref)` is the single
  authority.
- **IR-R8.** `non_goals` are structured nodes (`{id, statement, source_ref}`), not bare
  strings, so they can be attributed and cited like every other instruction.
- **IR-R15.** A `DraftIR` — the output shape of any model boundary that proposes IR
  content — carries **no `source_ref` and no `context_refs`**. Each attributable node
  carries `derived_from`: an **input segment** id. FORGE performs the segment →
  `source_ref` mapping (INV-016). Citing a segment FORGE did not issue is a boundary
  failure, never a defaulted source.

### 6.3 Semantic vs run separation

- **IR-R9.** The Task IR file contains **only** the semantic layer. It has no
  `created_at`, no `provenance.model_calls`, no retrieval timestamps.
- **IR-R10.** Semantic provenance — `source_ref`, trust, `introduced_by` — is part of the
  IR and **is** hashed, because it changes compiler behavior.
- **IR-R11.** Operational provenance — when, which model, how long, what score — lives in
  the run instance and is **never** hashed.

### 6.4 Canonicalization and hashing

- **IR-R12.** Canonical form: object keys sorted lexicographically and recursively;
  array order preserved (order is semantic); `undefined` dropped; `null` preserved;
  non-finite numbers and BigInt rejected; UTF-8; no insignificant whitespace; `-0`
  normalized to `0`.
- **IR-R13.** `semantic_hash` is computed over an **allowlist** projection (INV-015).
- **IR-R14.** The **semantic input tuple** governing determinism is:

  ```
  ( SemanticTaskIR.semantic_hash,
    StrategyOverlay.semantic_hash,
    AgentProfile.id + AgentProfile.version,
    forge_compiler_version,
    ir_version,
    tokenizer_id + tokenizer_version,
    { ContextRef.id → content_hash } )
  ```

  Every input that can change rendered bytes appears here. The tokenizer is included
  because budgeting affects output.

---

## 7. Agent Capability Requirements

- **AP-R1.** A profile is data. Adding one must not require a code change for
  `compatibility` or `native_topology` fidelity.
- **AP-R2.** Capabilities use the **same closed vocabulary** as `TaskIR.required_capabilities`,
  so legalization is a total function rather than a string match. Each capability is
  `supported`, `conditional`, or `absent`, with an optional note.
- **AP-R3.** `retrieval.autonomous_search` ∈ {`none`, `weak`, `strong`} and is the primary
  driver of materialization (FR-019).
- **AP-R4.** A profile declares an **artifact topology**: an ordered list of output files,
  each with a path template and an ordered list of section keys.
- **AP-R5.** Every section key referenced by any profile must exist in the section emitter
  registry — verified by contract test.
- **AP-R6.** **Fidelity ladder (INV-014).** A profile must declare exactly what FORGE can
  deliver. **Arity is not fidelity**: the number of artifacts a target's convention calls
  for says nothing about how idiomatic the output is.

  | Fidelity | Meaning | Requirement to claim it | Mechanically enforced by `FORGE-C101` |
  |---|---|---|---|
  | `full` | Idiomatic output matching the target's native conventions | Registered section overrides **and** a recorded manual verification against the real agent | Every declared override exists in the renderer; at least one is declared |
  | `native_topology` | The artifact paths and section placement follow the target's own convention, **at whatever arity that convention has**; generic prose | A declared topology that a contract test compiles losslessly, plus `verified_against` and any `limits.known_gaps` | Compiles the contract fixture with no `FORGE-C102`; declares no overrides |
  | `compatibility` | One **portable**, generic artifact the target can read. No claim of idiomatic layout | Profile validates and compiles | Exactly one declared artifact; declares no overrides |

  > **Contradiction resolved before P1.5.** The previous rule required `native_topology` to
  > declare **two or more** artifacts. That contradicted AP-R8 for `hermes-agent` and
  > `claude-design`, which are single-artifact *by nature* (one AGENTS.md with SKILL.md
  > deferred; one design brief), forcing both to under-claim `compatibility` to keep
  > INV-014 true. File count was also a poor proxy in the other direction: `claude-code`
  > declares two artifacts and emits one for most tasks. The distinction is now
  > **portability versus native convention**, and the honest limit of mechanical
  > enforcement is stated rather than dressed up in a check that does not test the claim.

- **AP-R9.** **Topology completeness (INV-017, FR-050).** A profile's topology must
  declare a destination for every class of content the task actually contains. A profile
  may not delete the author's content by omission. See FR-050 for the refusal policy.

- **AP-R7.** Known gaps must be declared in `limits.known_gaps` and surfaced by
  `forge agents show`. Example: Kiro's EARS requirements phrasing is a content
  transformation the generic emitters do not perform; Kiro is therefore
  `native_topology`, not `full`, and the gap is stated.
- **AP-R8.** v0.1 fidelity assignments:

  | Profile | Fidelity | Notes |
  |---|---|---|
  | `claude-code` | `full` | Bespoke section overrides; the dogfooding target. **Ships `native_topology` until overrides land in P6 (FR-022)** — claiming `full` earlier is an overclaim `FORGE-C101` correctly rejects |
  | `openai-codex` | `full` | Bespoke overrides in P6; same interim state as above |
  | `kiro` | `native_topology` | 3-file spec topology; **EARS phrasing not performed** |
  | `opencode` | `native_topology` | AGENTS.md + `.opencode/task.md` |
  | `hermes-agent` | `native_topology` | Single AGENTS.md — its native convention; **SKILL.md emission deferred** |
  | `claude-design` | `native_topology` | Single prompt artifact — its native convention; no shell, no repo — forces `by_value` |
  | `deepseek-harness` | `compatibility` | Single portable artifact; no native layout claimed |

  This table is verified by contract test, not asserted in prose: a profile disagreeing
  with it fails the build.

---

## 8. Context Engine Requirements

- **CE-R1.** Context resolution is deterministic. No model boundary participates in v0.1.
- **CE-R2.** Retrieval queries are derived **per instruction node**, so justification is a
  byproduct of retrieval rather than a judgment (FR-026).
- **CE-R3.** **By reference is the default.** For a `strong`-retrieval target, FORGE emits
  ranked pointers plus a retrieval plan. Inlining is a degradation applied only where the
  target cannot retrieve.
- **CE-R4.** Every retained reference must justify itself (INV-006).
- **CE-R5.** Budget drops are recorded, never silent (INV-012).
- **CE-R6.** `WorkspaceGuard` is the sole filesystem gateway (INV-011) and enforces, in
  order: path jail → ignore rules → deny globs → secret scan → trust assignment.
- **CE-R7.** v0.1 sources: working tree, explicit files, project docs, git history, prior
  FORGE sessions. Deferred: issues, web, external docs, images, video — the URI scheme
  already accommodates them.
- **CE-R8.** The interface must permit a future bounded multi-pass refinement loop without
  a schema change.

---

## 9. Strategy Requirements

- **ST-R1.** A strategy is a **structured overlay**, never a prose variant. Short/medium/long
  wordings of the same instruction are not strategies.
- **ST-R2.** v0.1 uses **fixed archetypes only**. There is no free-form or model-invented
  strategy candidate.
- **ST-R3.** Archetypes are data with typed, bounded parameters. Selection and tuning are
  deterministic (FR-032).
- **ST-R4.** Overlay dimensions, at minimum: `added_constraints`, `autonomy`
  (decision authority, ask threshold, stop conditions), `change_budget`,
  `verification_intensity`, `context_policy`, `exploration`.
- **ST-R5.** Distinctness is a mechanical property (FR-034), not an aspiration.
- **ST-R6.** Selection is never fully automatic: FORGE presents candidates with the
  deciding rule and the user chooses. The choice is recorded.
- **ST-R7.** The `origin` field is an open enum whose only v0.1 value is `archetype`,
  reserving space for future sources without an IR schema change (FR-035).

---

## 10. Diagnostic / Evaluation Requirements

### 10.1 Principles

- **DG-R1.** Diagnostics, never scores (INV-008).
- **DG-R2.** Every diagnostic carries evidence (INV-007).
- **DG-R3.** Deterministic checks are the baseline; model-judged checks are optional,
  additive, and discardable.
- **DG-R4.** A model-judged finding whose citation does not resolve is discarded silently
  from output and recorded as a boundary quality signal in the run.

### 10.2 Diagnostic codes

| Code | Name | Severity | Source | Condition |
|---|---|---|---|---|
| `FORGE-C001` | `uncovered_goal` | error | deterministic | No verification entry `satisfies` this goal |
| `FORGE-C002` | `dropped_constraint` | error | deterministic | A `hard` constraint has no span in any artifact |
| `FORGE-C010` | `orphan_context` | error | deterministic | `justifies` empty or unresolvable |
| `FORGE-C011` | `redundant_context` | warning | deterministic | Duplicate `content_hash` or fully-contained range |
| `FORGE-C020` | `unverifiable_goal` | warning¹ | deterministic | Every verification satisfying the goal is `manual`/`review` |
| `FORGE-C030` | `capability_gap_hard` | error | deterministic | Required capability absent in profile — compile refused |
| `FORGE-C031` | `capability_degraded` | warning | deterministic | Soft capability absent; a named degradation rule applied |
| `FORGE-C040` | `unsupported_assumption` | warning | judged | Assumption not traceable to input or context — must cite |
| `FORGE-C041` | `residual_ambiguity` | warning | judged | Node admits materially different readings — must quote |
| `FORGE-C050` | `untrusted_influence` | error | deterministic | **Agent-steering** node (instruction- or influence-bearing) resolves to `untrusted` |
| `FORGE-C051` | `injection_suspicion` | warning | judged | Imperative language inside an untrusted block — must cite |
| `FORGE-C052` | `semi_trusted_instruction` | warning | deterministic | **Agent-steering** node resolves to `semi_trusted`; node **is** rendered as **advisory** (the artifact must reflect it, not only this diagnostic) |
| `FORGE-C053` | `untrusted_role_violation` | error | deterministic | Untrusted ref declared `role: constraint_source` |
| `FORGE-C060` | `budget_overflow` | error | deterministic | Artifact exceeds the profile's context share |
| `FORGE-C061` | `context_dropped` | info | deterministic | Budget forced a drop; names item and reason |
| `FORGE-C070` | `unbounded_scope` | warning | deterministic | Scope matches > N files, or `blast_radius: repo` with hard architectural constraints |
| `FORGE-C080` | `blocking_question_unanswered` | error | deterministic | A blocking open question remains open at emit |
| `FORGE-C090` | `dangling_reference` | error | deterministic | A node id reference does not resolve |
| `FORGE-C091` | `duplicate_id` | error | deterministic | Two nodes share an id |
| `FORGE-C092` | `hash_mismatch` | error | deterministic | Stored `semantic_hash` ≠ recomputed |
| `FORGE-C100` | `untraced_span` | error | deterministic | Non-whitespace artifact bytes without an origin (INV-010) |
| `FORGE-C101` | `fidelity_overclaim` | error | deterministic | Profile claims fidelity its topology/overrides cannot support (INV-014) |
| `FORGE-C102` | `topology_gap` | error¹ | deterministic | The target's topology declares no section able to render a class of content the task contains (INV-017, FR-050) |
| `FORGE-C103` | `redundant_line_suppressed` | info | deterministic | A rendered line restated content the artifact already carried elsewhere and was suppressed; cites the node it came from and the text withheld (INV-012, FR-051) |

**Workspace codes (W-series).** The turn runtime does not own a second diagnostic
system; it emits instances of codes catalogued here, through the same factory and
with the same evidence requirement (INV-007).

| Code | Name | Severity | Source | Condition |
|---|---|---|---|---|
| `FORGE-W001` | `classification_degraded` | warning | deterministic | Action resolution failed or was skipped; the turn was treated as `DISCUSS` (WS-R4) |
| `FORGE-W002` | `action_unsupported_by_state` | warning | deterministic | The resolved action is one the conversation state cannot express; it is refused, naming what is missing (WS-R5) |
| `FORGE-W003` | `response_envelope_degraded` | warning | deterministic | The response was not a readable envelope; it was kept as chat and no version was written (INV-012) |
| `FORGE-W004` | `read_only_write_blocked` | error | deterministic | A read-only action came back carrying a prompt; the write was blocked (WS-R2, WS-R3) |
| `FORGE-W005` | `pinned_requirement_dropped` | error | deterministic | A requirement the user pinned into the ledger is absent from a prompt version by the presence rule of §22.8; cites the pinned text and the version that dropped it (WS-R24, WS-R25) |
| `FORGE-W006` | `semantic_drift` | warning | judged | A statement in one version's Task IR vanished or changed meaning in another's, and no pinned entry covers it; cites both versions' statements (WS-R26) |
| `FORGE-W007` | `candidate_duplicate_rejected` | warning | deterministic | A generated alternative's prose is token-identical to another candidate or to the base it was derived from; the alternative is rejected rather than offered as a choice that is not one (WS-R8, ST-R5) |
| `FORGE-W008` | `stated_requirement_demoted` | warning | deterministic | A requirement expressed in the user's own input reaches the artifact only as an assumption or an open question, never as a goal, constraint, non-goal or deliverable; cites the user's wording and the node that carries it (INV-016) |

¹ `FORGE-C102` is `error` — refusing compilation — when the unrenderable class is
instruction-bearing or carries nodes demoted to advisory by the trust model. It is
`warning` for influence-bearing and supporting content (assumptions, open questions,
context pointers, the untrusted appendix, environment notes), where an explicit recorded
degradation is proportionate.

¹ Downgraded to `info` when `objective.kind` ∈ {`analysis`, `research`, `design`, `review`},
where manual verification is legitimate.

- **DG-R5.** Adding a diagnostic code requires a fixture demonstrating a real defect it
  catches. Codes without fixtures are removed.

### 10.3 Ranking

Candidates are ranked by a **published lexicographic rule**, never a weighted score:

1. Any candidate with an `error`-severity diagnostic is disqualified.
2. Fewer diagnostics in precedence order:
   `C002` → `C001` → `C050` → `C080` → `C041` → `C040` → `C070` → `C010`/`C011`.
3. Tie-break: lower estimated token cost.
4. Still tied: configured archetype order.

**DG-R6.** The output must name **which step decided** the outcome.

### 10.4 Measured quantities

Reported with units, never aggregated: estimated tokens per section and per artifact ·
files in scope · goals with ≥1 machine-checkable verification (a ratio of counts) ·
context references by trust tier · dropped references · applied degradations ·
artifact byte counts.

---

## 11. Execution Package Contract

**PK-R1.** A package is a directory with this exact layout:

```
<package>/
  package.json            # semantic manifest — hashed → semantic_id
  task-ir.json            # semantic Task IR
  strategy.json           # semantic strategy overlay
  requirements.json       # requirement manifest (§22.9) — not a compiler input, but hashed → semantic_id
  artifacts/…             # rendered files, at topology-declared paths
  trace.json              # spans + typed origins
  provenance.json         # semantic provenance graph
  runtime-contract.json   # declared requirements — declares, never grants
  verification.json       # executable specs as data
  diagnostics.json        # derived findings
  run.json                # ★ VOLATILE — never hashed, expected to differ every run
```

**PK-R2.** `package.json` contains `semantic_id`, `forge_version`, `ir_version`,
`compiler_version`, profile id and version, tokenizer id and version, the pinned
repository commit and dirty flag, and the content hash of every other semantic file.

**PK-R3.** `semantic_id` is computed over the semantic input tuple (§6.4), the
canonical hash of the requirement manifest, and the content hash of every emitted
artifact. `run.json` is excluded, and is the only file that is.

Two identities are distinguished. **Compilation identity** — the §6.4 tuple and the
artifact hashes — says the compiler consumed the same inputs and emitted the same
bytes. **Package identity** — `semantic_id` — names the whole Execution Contract,
and V2-G binds evidence to it (`EV-R2`). The requirement manifest changes no
artifact byte, but it is part of what the package claims (who stated which
requirement, `RQ-R3`). Two packages with different manifests are therefore
different contracts and must have different ids; otherwise evidence produced
against one would bind silently to the other, and `INV-005` would be false of
`requirements.json` and `package.json`. The manifest is hashed as a value, not the
ledger, so storage keys and pin times never reach identity (`RQ-R2`). Two packages
of one compilation with different manifests share every artifact hash in
`package.json`, which is how "same compilation, different contract" stays visible.

> Corrected 2026-09-21 in the V2-F closure audit. The first V2-F text excluded the
> manifest as "a record, not an input"; that let two packages with different
> semantic files share one id, contradicting `INV-005`.

**PK-R4.** `runtime-contract.json` declares required capabilities, required tools,
network policy, filesystem scope, and the repository commit the package assumes.
It is a **declaration for a future executor**; FORGE grants nothing and enforces nothing
at runtime (INV-004).

**PK-R5.** `verification.json` entries are `{id, kind, spec, expected, satisfies[]}` —
data only. FORGE never executes them.

**PK-R6.** `diagnostics.json` separates `deterministic` from `judged` findings and carries
a `deterministic_hash` so the reproducible portion is checkable independently.

**PK-R7.** A package is relocatable: `forge export` produces a directory with no absolute
paths and no dependency on the originating object store (`.forge/` in PS-R1's CLI
layout; `FORGE_DATA_DIR` in the served workspace — see the 2026-09-17 V2-C deviation).
"No absolute paths" is a privacy requirement as much as a portability one: an absolute
path discloses a username and a directory layout to whoever receives the package.

**PK-R8.** Consuming a package requires only JSON parsing and the published JSON Schema.
No FORGE runtime is needed to read one.

---

## 12. Provenance Requirements

### 12.1 Two provenance kinds

| Kind | Content | Hashed | Location |
|---|---|---|---|
| **Semantic provenance** | `source_ref`, resolved trust, `introduced_by`, context `content_hash` | **yes** | `task-ir.json`, `provenance.json` |
| **Operational provenance** | run id, timestamps, latency, model identity, prompt/output hashes, retrieval scores, host metadata | **no** | `run.json` |

**PV-R1.** The split is architectural, not a filter: semantic provenance changes compiler
behavior; operational provenance describes an execution.

### 12.2 TraceOrigin

**PV-R2.** Rendered content originates from more than the IR. The origin type must cover
every producer:

| Origin kind | Payload | Produces |
|---|---|---|
| `ir_node` | `node_id` | Goals, constraints, verification, deliverables |
| `strategy` | `strategy_id`, `overlay_path` | Constraints and stop conditions added by an overlay |
| `agent_profile` | `profile_id`, `profile_path` | Convention-driven text (stop-condition idiom, permission notes) |
| `context_ref` | `ref_id`, `materialization` | Pointer lists, inlined content, fenced untrusted blocks |
| `compiler_rule` | `rule_id` | Degradation notices, budget notes, legalization output |
| `renderer_template` | `renderer_id`, `section_key`, `slot` | Headings, separators, structural boilerplate |

**PV-R3.** Coverage is **byte-level and total** (INV-010): spans are non-overlapping,
ordered, and their complement within each artifact contains only whitespace. Violations
emit `FORGE-C100` and fail the build.

**PV-R4.** Chains are resolved, not duplicated: an `ir_node` origin whose node was
introduced by an overlay carries `introduced_by` on the EffectiveIR node.
`forge explain` follows the chain.

**PV-R5.** `forge explain` is a pure lookup and must never invoke a model (FR-043).

---

## 13. Security Requirements

### 13.1 Threat model

FORGE assembles untrusted content and hands it to a privileged agent. It is a security
boundary whether or not it claims to be. The core insight it is built around: *agents
read tokens, not trust labels* — so FORGE must not flatten provenance.

**Two distinct targets:** injection against the **downstream agent**, and injection
against **FORGE's own model boundaries**. Both are in scope.

### 13.2 Trust model

| Tier | Sources | Compiler behavior |
|---|---|---|
| `trusted` | User input, FORGE-derived, first-party archetypes | May become authoritative instructions |
| `semi_trusted` | Repository files, git history, project docs | **Attributable, not safe.** May inform instructions but is rendered as **advisory** with visible attribution; emits `FORGE-C052` |
| `untrusted` | Web, issues, external/dependency docs | **Never** an instruction or premise. Renders only inside a fenced, data-marked block with visible source |

**SC-R1.** Trust changes behavior in at least four mechanical places, and applies to every
**agent-steering** node (§1) — instruction-bearing and influence-bearing alike:
1. **Admissibility** — untrusted agent-steering node → `C050`, compile refused.
2. **Advisory demotion** — semi-trusted agent-steering node → `C052`, **and the rendered
   artifact places it in an advisory section with its source URI visible**. A diagnostic
   alone does not satisfy this: the artifact is what the agent reads. Every authoritative
   section must exclude demoted nodes, and a topology with no advisory destination refuses
   (`C102`, FR-050) rather than dropping them.
3. **Role restriction** — untrusted ref may not hold `role: constraint_source` → `C053`.
4. **Provenance assignment** — a model boundary may not state a node's source at all
   (INV-016). Attribution is resolved by FORGE from the input segment the node cites, so
   an injected instruction cannot relabel itself `user_input`.

**SC-R2.** `semi_trusted` means *attributable*, not *safe*. A repository can contain
injected content via vendored dependencies, PR branches, or fixtures. This is documented
as a known limitation, not claimed as solved.

### 13.3 Controls

| ID | Control |
|---|---|
| **SC-R3** | **Path jail.** All context reads resolve absolutely, follow `realpath`, and assert the workspace-root prefix. Symlink escapes denied. Enforced by lint rule (no `fs` import outside the guard) and by test. |
| **SC-R4** | **Ignore and deny.** `.gitignore` and `.forgeignore` honored; `.env*`, key/certificate extensions, and configured deny-globs hard-denied. |
| **SC-R5** | **Secret detection.** High-confidence provider-key patterns plus an entropy heuristic run before content is representable. Optional shell-out to `gitleaks` when installed. |
| **SC-R6** | **Redaction is recorded, never silent.** A detection redacts and records a provenance entry with rule and occurrence count — never the secret itself. A secret that would be **inlined** is a hard error, not a warning. |
| **SC-R7** | **Untrusted fencing.** Untrusted content renders inside a delimited block, explicitly framed as data rather than instructions, with its source URI shown. |
| **SC-R8** | **Boundary self-defense.** FORGE's own model boundaries fence retrieved content identically, and their outputs are **structurally validated** — citations must resolve to existing ids. A successful injection can at worst cause a rejected candidate, never an injected instruction. |
| **SC-R9** | **Network off by default.** `--allow-net` requires an explicit domain allowlist. Every fetch is recorded. No telemetry, no phone-home. |
| **SC-R10** | **Declare, don't grant.** The package declares required permissions; FORGE never widens permissions and never emits instructions to disable a safety mechanism. |
| **SC-R11** | **No execution.** Verification specs are data (INV-004). |

**Out of scope for v0.1:** renderer plugin sandboxing (renderers are first-party only),
package signing, multi-user access control.

---

## 14. Model Boundary Requirements

### 14.1 The boundary invariant

> The architectural invariant is **not** a fixed number of model calls. It is that every
> model call is a registered boundary with all eight properties below. The count is kept
> minimal as an engineering discipline, not as a specification.

**MB-R1.** Every language-model invocation must be a registered boundary satisfying:

| # | Property | Mechanism |
|---|---|---|
| 1 | **Explicitly registered** | Present in a frozen registry, enumerable at runtime |
| 2 | **Schema constrained** | Zod input and output schemas |
| 3 | **Deterministically post-validated** | Post-validators that pass or fail without judgment (e.g. every cited id resolves) |
| 4 | **Replayable** | A content-addressed cassette key derived from the input |
| 5 | **Observable** | Recorded in the run instance (FR-049) |
| 6 | **Replaceable** | Invoked only through `ModelProvider`; no provider-specific code |
| 7 | **Provenance recorded** | Prompt and output hashes stored |
| 8 | **Independently testable** | A dedicated test file per boundary id, asserted structurally |

**MB-R2.** A structural test enumerates the registry and asserts all eight properties for
every entry. Adding a boundary without satisfying them fails the build.

**MB-R3.** No boundary may have a "guess" fallback. Permitted failure modes are `fail`
(hard error) and `skip` (the optional feature is omitted, recorded).

**MB-R6.** **Segment attribution (INV-016).** A boundary that proposes IR content must:
1. receive its input as numbered **input segments**, each carrying a FORGE-assigned
   `source_ref`;
2. emit `derived_from: <segment id>` per attributable node, and **no `source_ref`** —
   enforced by the output schema, not by a post-validator;
3. have FORGE resolve segment → `source_ref` deterministically before the output becomes a
   Task IR.

Rationale, and why a post-validator is insufficient: `resolveTrust` resolves from
`source_ref`, so a boundary free to write that field could label content it lifted from a
retrieved file as `user_input`. The prescribed check *"no constraint may cite an untrusted
ref"* is bypassed by not citing it, and no deterministic check can recover the truth
afterwards. Removing the field removes the capability. The worst a successful injection can
then achieve is citing a **different segment**, whose trust FORGE still owns.

Consequence for SC-R8: the guarantee *"a successful injection can at worst cause a rejected
candidate, never an injected instruction"* holds for `intent.extract` only under MB-R6.
Without it, that claim was false for any boundary that sees retrieved content.

### 14.2 v0.1 boundaries

| Boundary | Required | Purpose | Failure mode |
|---|---|---|---|
| `intent.extract` | **yes** | Natural language (+ optional prior draft and clarification answers) → `DraftIR` | `fail` after 2 repairs |
| `conversation.classify` | no | User message + conversation state → one of the ten actions (WS-R3) | `skip` → `DISCUSS` (WS-R4) |
| `conversation.generate` | no | Resolved action + rendered prompts → the `{reply, prompt}` envelope | `skip` → reply-only, never a version |
| `conversation.candidate` | no | Strategy overlay + base prompt + rendered prompts → one alternative, as the same envelope (WS-R8) | `skip` → that alternative is dropped and recorded, never a version |
| `critic.judge` | no (off by default) | Additive judged diagnostics `C040`/`C041`/`C051` | `skip` |

`critic.judge` is **catalogued, not built** (P6). The registry holds
`intent.extract`, `conversation.classify`, `conversation.generate` and
`conversation.candidate`.

**Why `conversation.candidate` is registered** (V2-E): MB-R1 admits no
ungoverned language-model invocation, and generating an alternative prompt is
one. It governs what `conversation.generate` governs — the envelope, plus
deterministic relations, never the prose: a candidate must carry a prompt, and
it must not be the base reworded (ST-R1, ST-R5, checked by the same token rule
the candidate set uses). Its input carries **no action**, which makes WS-R2
structural on this path: the boundary has no action under which a version could
be written, and promotion is a separate, explicit user act (ST-R6).

**Why `conversation.generate` is registered** (V2-A's decision on the question
AD-22 left open): governing the cheap classification call while exempting the
expensive generation call is incoherent, and the objection — that its output is
prose — is answered by what the boundary governs. Not the prose: the **envelope**,
and the **action → effect** relation of WS-R3, which is deterministic.

**MB-R4.** Boundaries **deliberately removed** relative to earlier design, with rationale:

| Removed | Why |
|---|---|
| `strategy.propose` | With free-form strategies eliminated (ST-R2), archetype selection and bounded parameter tuning are deterministic functions of IR signals. A model adds nondeterminism and no capability. |
| `context.justify` | Deriving `justifies` from retrieval provenance (FR-026) is **strictly more trustworthy** than a model's judgment: if a reference was found by a query derived from goal `g1`, then it justifies `g1` as a fact rather than an opinion. |

**MB-R5.** Consequence: the entire pipeline **except `intent.extract`** runs with no API
key. A hand-authored IR (FR-005) makes the whole product usable with no model at all.

---

## 15. CLI Requirements

**CLI-R1.** Commands (final v0.1 surface; each ships in the phase that implements it):

```
forge init                                   # workspace detection, .forge/ store, config
forge task "<text>"                          # full pipeline
forge ir show|validate|edit|hash <id|path>   # the IR is the review surface
forge context resolve --ir <id>              # inspect retrieval and justification
forge agents [show <id>]                     # profile registry + fidelity + known gaps
forge strategies --ir <id>                   # candidates + deciding rule
forge compile --ir <id> --target <profile> --strategy <id>
forge check <package>                        # diagnostics only
forge explain <package> [--span N|--byte N|--artifact P]
forge export <package> --out <dir>
forge history | forge diff <a> <b>
forge doctor
```

**CLI-R2.** Global flags: `--json`, `--strict`, `--yes`, `--no-llm`, `--allow-net <domains>`,
`--cassette <dir>`, `--profile-dir <dir>`.

**CLI-R3.** `--strict` promotes every warning to an error.
**CLI-R4.** `--no-llm` refuses any model boundary; the command fails rather than degrades.
**CLI-R5.** Exit codes: `0` success · `1` diagnostics at error severity · `2` usage error ·
`3` refused (capability gap, untrusted instruction, blocking question) · `4` internal error.
**CLI-R6.** No command invents a capability that does not exist. Commands are added to the
CLI only in the phase that implements them.

---

## 16. Persistence Requirements

**PS-R1.** `.forge/` in the workspace, gitignored by default:

```
.forge/
  objects/<sha256>.json     # content-addressed: IRs, overlays, packages, artifacts
  runs/<YYYY-MM-DD>.jsonl   # append-only run event log
  index.sqlite              # queryable index for history/diff
  config.json
```

**PS-R2.** Objects are immutable and content-addressed. The store is a cache plus a
history, never a source of truth that can drift from its content.
**PS-R3.** The index is **derivable**: deleting `index.sqlite` and rebuilding from
`objects/` and `runs/` must reproduce it exactly.
**PS-R4.** No daemon and no background process. The workspace is served by a
single local process the user starts and stops explicitly; it holds no state the
store does not hold, so killing it loses nothing.
**PS-R5.** `profiles/` and `strategies/` are checked into the repository as first-party
data, not stored in `.forge/`.

---

## 17. Testing Requirements

### 17.1 Principle

The core is deterministic, so the backbone is **golden tests with zero model calls**.
CI runs everything except explicitly-marked live evaluations, with **no network and no
API key** (NFR-007).

### 17.2 Required suites

| Suite | Asserts | Guards |
|---|---|---|
| **golden** | One IR compiled to multiple targets produces stable, reviewable artifacts | FR-021, AC-002 |
| **property/ir** | Referential integrity; id uniqueness; hash stability; allowlist projection excludes new fields by default; every agent-steering kind declares `source_ref` | INV-015, AC-008 |
| **property/attribution** | A draft cannot state provenance; segment → `source_ref` mapping; unissued segment fails the boundary | INV-016, AC-026 |
| **property/advisory** | Every semi-trusted agent-steering kind renders as advisory and nowhere authoritative | SC-R1, AC-028 |
| **property/topology** | Every profile carries the canonical fixture losslessly; a missing destination refuses or degrades per policy | INV-017, AC-027 |
| **property/tokenizer** | Declared estimator id, version and encoding match the installed package and the encoding actually used | IR-R14, NFR-009 |
| **contract/cli** | Exit codes per CLI-R5; `--json` and `--strict` behaviour; no command advertised before its phase | CLI-R5, AC-024 |
| **property/determinism** | Two full compilations differ only in `run.json` | INV-005, INV-013, AC-005 |
| **property/trace** | Byte-level total attribution; non-overlapping spans | INV-010, AC-006 |
| **property/constraints** | Every hard constraint appears in every target's artifacts | INV-003, AC-004 |
| **property/context** | Every retained ref justifies itself and resolves | INV-006, AC-007 |
| **property/strategy** | Pairwise distinctness above threshold; reworded duplicate rejected | ST-R5, AC-003 |
| **contract/profiles** | Every profile validates, every section key exists, every profile compiles the canonical fixture | AP-R5, AC-018 |
| **contract/extensibility** | A synthetic profile compiles with zero TypeScript changes | NFR-004, AC-017 |
| **contract/boundaries** | Every registered model boundary satisfies all eight properties | INV-009, AC-016 |
| **security/injection** | Planted payloads never escape fenced blocks; never become instructions | INV-002, AC-010 |
| **security/secrets** | Planted credentials never appear in any artifact; inlining is a hard error | SC-R6, AC-014 |
| **security/pathjail** | Symlink, traversal, absolute-path, and ignored-file escapes denied; no `fs` import outside the guard | INV-011, AC-015 |
| **replay** | Cassette replay reproduces boundary outputs deterministically | FR-048, AC-019 |
| **perf** | Stage budgets respected | NFR-008, AC-022 |

### 17.3 Rules

- **TS-R1.** A phase is not complete until its verification commands have been **run** and
  their output shown. Claiming completion without evidence is a process failure.
- **TS-R2.** Tests are never deleted or weakened to obtain a green result. A failing test
  means the implementation is fixed and verification re-run.
- **TS-R3.** Determinism is achieved architecturally. **Freezing the clock in tests is
  forbidden** — it would hide exactly the defect the test exists to catch.
- **TS-R4.** Every diagnostic code has a fixture that triggers it (DG-R5).
- **TS-R5.** Model-dependent tests are isolated behind a marker and excluded from the
  default suite.

### 17.4 Evaluation corpus (design now, build later)

**TS-R6.** FORGE's own model-dependent behavior must eventually be regression-testable
against a corpus of real tasks. Designed now so nothing blocks it later; **not built in
v0.1**.

Corpus categories, each with observable expected outcomes: debugging · architecture
change · frontend/design · refactoring · research · security-sensitive change ·
deliberately ambiguous request · internally conflicting constraints.

Each corpus entry records: input text, repository fixture, expected extracted goals and
constraints (as a set-containment assertion, not string equality), expected
`open_questions`, expected diagnostics, and forbidden outputs (constraints that must
**not** be invented).

Changes to any of the following must eventually be evaluated against the corpus:
intent-extraction prompts · agent profiles · section emitters · `CLAUDE.md` · skills ·
model provider or model version.

---

## 18. Open-Source Extension Contract

### 18.1 Adding an agent target

**Compatibility or native_topology fidelity — no code:**

1. Add `profiles/<id>.yaml` validating against the published `AgentProfile` JSON Schema.
2. Declare capabilities from the closed vocabulary, `retrieval.autonomous_search`, an
   artifact topology using existing section keys, `fidelity`, `verified_against`, and any
   `limits.known_gaps`.
3. Add a golden fixture. `pnpm test` must pass with zero TypeScript changes.

**Full fidelity — requires code review:**

4. Register section overrides for the sections needing idiomatic treatment.
5. Record a manual verification against the real agent, with date.
6. Justify the `full` claim; `FORGE-C101` fails the build on overclaim.

### 18.2 Adding a strategy archetype

Add `strategies/<id>.yaml` with a typed, bounded parameter set and fit rules. It must pass
the distinctness property test against all existing archetypes.

### 18.3 Adding a diagnostic

A code, a severity, a deterministic or judged implementation, and a fixture that triggers
it. Judged diagnostics must cite resolvable evidence.

### 18.4 Stability guarantees

- The Task IR JSON Schema is published and versioned; breaking changes bump the major.
- The Execution Package format is consumable with JSON parsing alone (PK-R8).
- Profiles and strategies are data with independent versions.
- The section emitter registry is a public, documented catalogue.

---

## 19. Acceptance Criteria (AC)

Each is falsifiable and mapped to a test suite.

| ID | Criterion | Verifies |
|---|---|---|
| **AC-001** | A structural test asserts the Task IR schema contains no vendor name, agent name, tool name, filename, or format directive. | INV-001, NFR-003 |
| **AC-002** | One IR compiles to `claude-code`, `kiro`, and `claude-design` producing artifacts differing in ≥5 enumerable ways (artifact count and paths, materialization mode, verification kinds after legalization, section ordering, stop-condition presence) while every hard constraint appears in all three. | FR-021, INV-003 |
| **AC-003** | Four archetypes on one IR are pairwise distinct above threshold; a deliberately reworded duplicate is rejected and the rejection recorded. | ST-R5 |
| **AC-004** | For every profile and every archetype, every `hard` constraint has ≥1 span in the artifacts. | INV-003 |
| **AC-005** | Two full compilations of the same inputs on different days produce directories that `diff -r` reports identical **except** `run.json`. No test freezes the clock. | INV-005, INV-013, INV-015, NFR-001 |
| **AC-006** | For every artifact, trace spans are non-overlapping and their complement contains only whitespace. An artificially untraced span produces `FORGE-C100` and fails. | INV-010, NFR-005 |
| **AC-007** | A deliberately bloated IR emits one `C010` per unjustified reference; `--strict` exits non-zero. | INV-006 |
| **AC-008** | An IR with an unknown major `ir_version` is refused. A known older minor migrates and re-hashes correctly. Adding a new schema field does not change existing hashes until the field enters the projection allowlist. | FR-009, INV-015, NFR-012 |
| **AC-009** | Every degradation, drop, redaction, demotion, and refusal appears in `diagnostics.json` with a code. A test asserts no code path performs these silently. | INV-012 |
| **AC-010** | Injection corpus: zero untrusted spans outside fenced blocks; zero untrusted-derived **agent-steering** nodes (instruction- **and** influence-bearing); `C050`/`C053` fire as expected. | INV-002, SC-R1 |
| **AC-011** | No `fs` import exists outside `WorkspaceGuard` (lint rule + test). | INV-011 |
| **AC-012** | Every emitted diagnostic carries a code, a severity, and resolvable evidence. A judged finding with an unresolvable citation is discarded. | INV-007, DG-R4 |
| **AC-013** | A repository-wide test asserts no composite score is emitted anywhere. | INV-008 |
| **AC-014** | Secret corpus: zero credentials in any artifact; attempted inlining is a hard error; redaction recorded with rule and count but never the secret. | SC-R5, SC-R6 |
| **AC-015** | Path-jail suite: symlink escape, `../..`, absolute path, and gitignored access all denied. | SC-R3 |
| **AC-016** | The boundary registry test enumerates every boundary and asserts all eight properties, including the existence of a dedicated test file. | INV-009, MB-R2 |
| **AC-017** | Adding `fixtures/profiles/synthetic-agent.yaml` yields a working target with zero TypeScript changes. | NFR-004 |
| **AC-018** | Every profile's declared fidelity is supported by its topology and overrides; an overclaim produces `FORGE-C101`. | INV-014, AP-R6 |
| **AC-019** | The full suite passes with `ANTHROPIC_API_KEY` unset and network disabled. | NFR-007, FR-048 |
| **AC-020** | A static test asserts no code path executes a command derived from an IR or package. | INV-004 |
| **AC-021** | With no `--allow-net`, no outbound socket is opened. Asserted by test. | NFR-002 |
| **AC-022** | Stage timing budgets asserted on a synthetic large-repository fixture. | NFR-008 |
| **AC-023** | Core runtime dependency count ≤ 8 **and** web runtime dependency count ≤ 14, each asserted from its own `package.json` by a test. *(The assertion did not exist before V2; adding it is V2-0 work.)* | NFR-010 |
| **AC-024** | Every command supports `--json` and every stage emits a structured run event. | NFR-011 |
| **AC-025** | **Thesis gate.** On a benchmark of ≥12 real tasks, blind comparison of raw task versus FORGE package handed to the same agent shows FORGE winning on ambiguous and multi-constraint tasks, measured by constraint violations, scope overruns, and correction cycles. | intent.md Success Signals |
| | **Result (recorded, not reinterpreted).** P1.5: RECONSIDER — 6 execution pairs, no measurable difference. P1.6 validation (frozen discriminative design, 8 pairs): FAIL — 0 FORGE wins, one genuine over-blocking loss, zero FORGE-caused defects anywhere. The structure-alone execution claim is retired (`intent.md`); this criterion stays green-as-run precisely because a negative result was its valid, publishable outcome. | |
| **AC-026** | A draft carrying `source_ref` is rejected by the schema. The same draft, attributed against a `user_input` segment, a `semi_trusted` segment and an `untrusted` segment, yields `trusted` / `C052` / `C050` respectively — so attribution is a function of the input, not of the model's claim. Citing an unissued segment fails the boundary with no defaulted source. | INV-016, MB-R6 |
| **AC-027** | For every shipped profile, compiling the canonical fixture produces zero `FORGE-C102`. A profile whose topology omits an instruction-bearing destination refuses and emits `C102` naming the class and nodes; one omitting only influence-bearing or supporting destinations compiles and records the gap. | INV-017, FR-050 |
| **AC-028** | For every agent-steering node kind, a `semi_trusted` instance appears in the advisory section with its source URI and appears **nowhere** authoritative; a `semi_trusted` node still has a trace span, so relocation is not a drop. | SC-R1, INV-012 |

**AC-025 is allowed to fail the thesis.** A negative result triggers the repositioning
described in `intent.md`, not a quiet retention of the claim.

---

## 20. Explicit Deferred Work

Not built in v0.1. Each requires evidence before reconsideration.

| Deferred | Condition for revisiting |
|---|---|
| Execution / orchestration (worktrees, containers, agent launch, loops) | A separate project; never inside FORGE |
| Post-execution result evaluation (tests passed, trajectories, cost) | Requires an executor to exist. The package format already supports attaching results to a run id. |
| Prompt optimization (GEPA, DSPy, RL) | Requires the evaluation corpus **and** execution outcomes |
| Free-form / discovered strategies | Requires evidence that archetypes are insufficient |
| Model-judged context justification | Requires evidence that retrieval-derived justification is insufficient |
| Embeddings, vector DB, semantic index | Requires evidence that lexical retrieval of *pointers* is insufficient |
| Tree-sitter symbol extraction and repo maps | v0.2; ripgrep plus import heuristics first |
| Repomix integration for large `by_value` payloads | When a real target needs bulk inlining |
| SKILL.md emission | v0.2, for Hermes and Claude Code |
| EARS phrasing for Kiro | Requires a bespoke Kiro renderer; the gap is declared today |
| Web, issues, papers, images, video as context sources | URI scheme already accommodates them |
| MCP server exposing FORGE | v0.3 |
| ~~Web UI~~ | **RETIRED — built.** The local workspace shipped and is specified in §22 |
| TUI, IDE extension, daemon | Still deferred; the workspace is the interactive surface |
| Hosted service, multi-user, auth, teams, sharing | Never in the local-first core |
| An agent framework owning the IR, compiler, provenance, trust or diagnostics | **Never** — that is the architecture we rejected |
| A framework orchestrating the conversational turn only | Evaluated in AD-17; currently rejected, with a written condition for revisiting |
| Package signing, renderer plugin sandboxing | Requires third-party renderers to exist |
| Composite quality score | **Never.** Permanent non-goal (INV-008). |

---

## 21. Areas of Concern

Stated openly. Each is a hypothesis this specification does not yet prove.

| # | Concern | Why it matters | How it gets resolved |
|---|---|---|---|
| **AOC-1** | **The thesis was false.** FORGE did not beat handing the raw task to a strong agent — tested at P1.5 (RECONSIDER) and P1.6 (FAIL), with zero FORGE-caused defects in either trial. | Was existential; resolved by the evidence. | Tested as placed, before the expensive phases. The structure-alone execution claim is retired and the project repositioned as an auditable compiler (`intent.md` P1.7). No further win-seeking trials without a new mechanism and a discriminative design. |
| **AOC-2** | **Deterministic strategy selection may be too crude.** Fit rules over IR signals may pick poorly where a model would pick well. | Determines whether MB-R4's removal of `strategy.propose` holds. | Compare rule-selected against human-selected archetypes on the corpus. Reintroducing a boundary is cheap and additive if evidence demands it. |
| **AOC-3** | **Retrieval-derived justification may be too coarse.** A reference found via a `g1` query may be genuinely irrelevant to `g1`. | Determines whether removing `context.justify` holds. | Measure precision on the corpus. The interface already accommodates a boundary. |
| **AOC-4** | **The IR may be under- or over-specified.** Expect 2–3 breaking revisions. | Schema thrash is costly once fixtures exist. | `ir_version` and migrations from P0; small regenerable fixtures; the IR is not frozen until after P1.5. |
| **AOC-5** | **Profile-declared topology may not stretch far enough.** Some target may need content transformation, not just section placement. | Determines whether "new agent = YAML only" survives contact. | The fidelity ladder makes an honest fallback available (`native_topology` rather than `full`). Kiro's EARS gap is the first known instance. |
| **AOC-6** | **`semi_trusted` is a genuinely unsolved trust problem.** A repository can carry injected content. Advisory demotion mitigates; it does not solve. | Security claim honesty. | Documented as a limitation. Advisory rendering plus visible attribution is the v0.1 answer, and as of the P1.4 pass it applies to **every** agent-steering node kind and is enforced in the rendered artifact, not only in diagnostics (SC-R1 mechanism 2, AC-028). |
| **AOC-7** | **Token estimates are approximate across providers**, yet budgeting affects output bytes. | Determinism depends on it. | The tokenizer is pinned and included in the semantic input tuple (§6.4). Estimates are labelled as estimates. As of P1.4 the encoding is selected explicitly, the dependency is pinned exactly, the declared identity is asserted against the installed package by test, and the identity is recorded on every `CompileResult`. **Still open:** the estimator is one provider's tokenizer applied to all targets; per-profile estimators are admitted by the interface without a caller change. |
| **AOC-8** | **`by_reference` assumes the executor has the repository at the pinned commit.** | A package handed to the wrong tree is silently wrong. | `runtime-contract.json` pins commit and dirty flag; honoring it is the executor's responsibility, stated explicitly. |
| **AOC-9** | **FORGE's own latency and cost may exceed patience** for small tasks. | Adoption. | `--no-llm` and hand-authored IRs from P0; content-hash caching; a single required boundary. |
| **AOC-10** | ~~**Trace granularity is unproven.**~~ **Resolved in P1.** Byte-level total coverage holds for every emitter and every shipped profile. | INV-010 is a strong claim. | `TracedTextBuilder` makes untraced non-whitespace text unrepresentable, so coverage holds by construction; `verifyCoverage` checks the assembly step. Verified for every shipped profile and for a synthetic third-party profile. The invariant stands as written. |
| **AOC-11** | **Attribution is single-segment.** `DraftIR.derived_from` cites one input segment per node, so a node genuinely synthesised from two sources records only one. | Provenance precision. | Deliberate for v0.1: `TaskIR.source_ref` is single-valued, and the safe rule for multi-source attribution (take the least-trusted segment) is available later as a **DraftIR-only** change. Recorded so the simplification is visible rather than assumed. |

---

## 22. Workspace Requirements (WS-R)

> **New in V2.** The conversational workspace shipped before it was specified.
> This section makes it a contract rather than an accident. It governs the `web`
> package; the core sections above are unchanged and still authoritative for the
> compiler.

### 22.1 Conversation action model

**WS-R1.** Every user message resolves to exactly one **conversation action**
before any artifact is written. The closed set is: `DISCUSS`, `CREATE`,
`REVISE`, `CRITIQUE`, `EXPLAIN`, `COMPARE`, `MERGE`, `RESTORE`, `ANALYZE`,
`CLARIFY`.

**WS-R2.** Only `CREATE`, `REVISE`, `MERGE` and `RESTORE` may produce a new
prompt version. The other six are read-only with respect to the artifact.
A message that merely asks a question must never mutate the current prompt.

**WS-R3.** Action resolution is a registered model boundary
(`conversation.classify`, §14). Its post-validators check the **action → effect**
relation, not the label: an action in the read-only set that is accompanied by a
version write is a boundary failure. The label itself is unverifiable; the effect
is, and that is where the safety lives.

**WS-R4.** When action resolution fails or is skipped, the turn degrades to
`DISCUSS` — the least destructive action — and emits a diagnostic. It must never
degrade into a mode where the model itself decides whether to write a version.

**WS-R5.** The workspace never invents an action the current state cannot
express. `COMPARE` and `MERGE` require two addressable artifacts; `RESTORE`
requires the cited version to exist; `CLARIFY` requires a pending question that
survives across turns. Where state is insufficient, the action is refused with a
diagnostic, not silently downgraded.

### 22.2 Prompt artifact model

**WS-R6.** A prompt is a first-class artifact, not a chat message. A
`PromptArtifact` has an identity, an ordered version history, and at most one
current version.

**WS-R7.** A `PromptVersion` is immutable once written and records its text, its
`source` (`model` | `manual` | `import` | `restore` | `merge`), the action that
produced it, and the conversation turn that produced it. Versions are never
mutated or deleted; `RESTORE` moves the current pointer and records that it did.

**WS-R8.** A `PromptCandidate` is an alternative artifact within one
conversation. Candidates are generated only when the user or the request asks
for alternatives — never by default. Candidate generation reuses the strategy
archetypes of §9; it does not introduce a second strategy system.

**WS-R9.** The semantic/run split of §6 applies to artifacts. Version text,
target, strategy and derived structure are semantic. Latency, model identity,
token counts and timestamps are run data and are never hashed (INV-013).

### 22.3 Turn runtime

**WS-R10.** A turn is executed by a FORGE-owned pipeline that emits a stream of
typed `TurnEvent`s. The event stream is the same object the UI renders and the
run log persists — one mechanism, not two.

**WS-R11.** Turn events carry named, user-meaningful stages (for example
"analyzing current prompt", "checking requirements"). They **never** expose
model chain-of-thought.

**WS-R12.** A turn is cancellable. A cancelled turn leaves the conversation
exactly as a failed turn does: the user's message is kept, no assistant message
and no version are written.

**WS-R13.** The per-turn model-call budget is declared and bounded. A simple
revision costs one generation call plus at most one classification call.
Multi-call work (candidate generation, requirement checking) is opt-in or
background and never on the critical path of an ordinary revision.

### 22.4 Provenance and auditability of the product

**WS-R14.** Every model call made by the workspace persists a
`ModelCallRecord` — provider, model, boundary id and version where applicable,
prompt hash, output hash, repair count, replay flag, latency. Auditability that
is claimed but not persisted is not auditability.

**WS-R15.** Uploaded attachments pass through `WorkspaceGuard` (§13) before any
content reaches a model: path and type checks, secret detection with recorded
redaction, and trust-tier assignment. Attachment content is `semi_trusted` at
best and is fenced as data, never presented as instruction (SC-R7).

**WS-R16.** No credential ever appears in a diagnostic, a log line, an event, or
an API response. Base URLs are stripped of query strings before display.

### 22.5 Persistence

**WS-R17.** Truth is content-addressed immutable objects plus an append-only run
log. Any index (SQLite) is **derivable**: deleting it and rebuilding from objects
and runs must reproduce it exactly (PS-R3). The index is an optimization, never a
second source of truth.

**WS-R18.** Large attachment payloads are stored as objects, not inlined into a
conversation record.

**WS-R19.** Provider credentials are encrypted at rest under a key derived from
an operator-supplied secret, stored separately from configuration, and never
returned to the browser in plaintext.

### 22.6 Target intelligence

**WS-R20.** Target behaviour comes from AgentProfile data (§7). A model
identifier is never a display name and a display name is never sent to an API;
where a target exposes multiple wire protocols, the protocol is part of the
model's declared metadata and selects the transport.

**WS-R21.** A model whose routing cannot be determined from declared data is
reported as unsupported. Guessing a protocol produces a misleading upstream
error and is forbidden.

### 22.7 Progressive context

**WS-R22.** Context acquisition is a ladder, and each rung requires evidence that
the previous one is insufficient:
**L1** direct user input · **L2** selective retrieval from attached files ·
**L3** indexed retrieval over a project · **L4** semantic/vector retrieval.
L1 and L2 are in scope for V2; L3 is evidence-gated; L4 remains deferred and
requires measured failure of lexical retrieval (§20).

**WS-R23.** Retrieved or attached content never becomes an authoritative
instruction through any path (INV-002). This holds identically in the workspace
and in the CLI.

### 22.8 Requirement preservation

> The product's central promise is that a revision changes what was asked and
> nothing else. That promise is kept by **two layers with different epistemic
> status**, and the distinction between them is load-bearing: one is a mechanical
> guarantee, the other is advice. Collapsing them would make the guarantee only
> as trustworthy as a model's paraphrase.

**WS-R24 — Layer 1: the requirement ledger (deterministic, authoritative).**
A conversation carries a **ledger** of requirements the user has **pinned**.
FORGE may *propose* candidates for pinning; only the user promotes a candidate
into the ledger. A pinned requirement is stored verbatim as user-authored text,
is semantic content (hashed, versioned, attributable to `user_input`), and is
never rewritten, summarized, or re-derived by a model.

**WS-R25.** Checking a new prompt version against the ledger is **deterministic
and involves no model call**. Every pinned requirement is either present or
absent by a published, reproducible rule, and the result is identical on repeated
runs over identical inputs (INV-005). A pinned requirement found absent is an
`error`-severity deterministic diagnostic citing the pinned text and the version
that dropped it.

**The presence rule (WS-R25), published.** A pinned requirement is **present**
in a version when the token sequence of the pinned text occurs contiguously in
the token sequence of the version text. Tokens are produced by one published
normalization: Unicode NFKC, case-folded, every character that is not a letter
or a digit treated as a separator, empty tokens discarded. Nothing else is
consulted — no model, no similarity threshold, no clock. Reformatting, bullet
markers, punctuation and case therefore never break a match, and a paraphrase
always does: a paraphrase is Layer 2's subject, not Layer 1's. FORGE may
*propose* pin candidates deterministically from text already present in the
conversation, and a proposal is not a ledger entry until the user pins it.

**WS-R26 — Layer 2: semantic drift (judged, advisory).**
A Task IR is extracted **once** when a version is created and stored
content-addressed. Comparing the stored IRs of two versions yields **semantic
drift** findings — requirements that appear to have changed meaning or vanished
without being pinned. These are emitted under a code whose `source` is
`"judged"`, at `warning` severity, and always cite both versions' statements as
evidence.

**WS-R27 — The judged layer may never weaken the pinned layer.** Specifically:

1. A judged finding may not suppress, downgrade, resolve, or annotate away a
   Layer 1 diagnostic.
2. The **absence** of a judged finding is never evidence that a pinned
   requirement survived. Only Layer 1 can make that statement.
3. Layer 1 runs, and reaches its verdict, whether or not Layer 2 ran, succeeded,
   or was enabled at all.
4. A model may not remove, edit, or unpin a ledger entry. Unpinning is a user
   action.

A violation of any of these is a specification violation, not a tuning choice.

**WS-R28.** The two layers are visibly distinct wherever they surface. A
deterministic ledger result and an advisory drift finding are never rendered as
one undifferentiated list, because a user acting on them needs to know which one
is a guarantee.

**WS-R29.** Layer 2 is opt-in or background and never blocks a revision
(`WS-R13`). Layer 1, being deterministic and cheap, runs on every version that
has a non-empty ledger.

### 22.9 Requirement identity (RQ-R)

Preservation (§22.8) answers *did this survive?* for one version. Identity
answers *is this the same requirement?* across all of them. The two are
separable, and this section owns only the second.

**RQ-R1 — Identity is conversation-scoped, never IR-scoped.** A requirement's
id is stable for the life of the conversation. It may not be a Task IR node id:
the IR is re-extracted per version, so `g1` in version 3 and `g1` in version 7
are unrelated. A requirement that must be traceable from version 3 to version 7
therefore cannot live in the IR, and identity is recorded beside the
conversation instead. A resolution from a requirement to the IR nodes of one
version is **derived and recomputed**, never stored as truth.

**RQ-R2 — The id is deterministic and model-free.** It is derived from
FORGE-held facts by a published rule, reproducibly (`INV-005`). No model
boundary proposes, returns, or influences an id.

**RQ-R3 — `origin` is FORGE-assigned and immutable.** Every requirement carries
`origin ∈ {user_stated, inferred}`. FORGE sets it from how the requirement was
obtained; **no model boundary output may carry or alter it**, which is
`INV-016`'s rule applied to requirements rather than to IR nodes. `user_stated`
is reserved for text the user wrote. A requirement may never be promoted from
`inferred` to `user_stated` by any path, model or deterministic — the promotion
is not an operation the system offers.

> The lifecycle above `origin` — `status`, supersession, conflict — is **V2-H**,
> not this section. Recording identity without a workflow is deliberate: an id
> and an immutable origin are what the Execution Package needs, and states
> nobody has yet used would be invented workflow.

---

## 23. Workspace Acceptance Criteria

| ID | Criterion | Verifies |
|---|---|---|
| **AC-029** | A message classified `DISCUSS` produces no new prompt version. Asserted over the action corpus. | WS-R2, WS-R3 |
| **AC-030** | A failed classification degrades to `DISCUSS` and emits a diagnostic; no version is written. | WS-R4 |
| **AC-031** | Every workspace model call writes a `ModelCallRecord`; a conversation's run log accounts for every call made. | WS-R14 |
| **AC-032** | Deleting the SQLite index and rebuilding from objects and runs reproduces it exactly. | WS-R17, PS-R3 |
| **AC-033** | An attachment containing a planted credential is redacted before any model call, and the redaction is recorded. | WS-R15 |
| **AC-034** | A display name supplied where a model id belongs is refused, not transmitted. | WS-R20 |
| **AC-035** | An undocumented model id is reported unsupported rather than routed to a default endpoint. | WS-R21 |
| **AC-036** | A cancelled turn leaves the conversation byte-identical to a failed turn. | WS-R12 |
| **AC-037** | No credential appears in any diagnostic, event, log line, or API response, asserted adversarially. | WS-R16 |
| **AC-038** | The real browser workflow — configure provider, chat, produce a prompt, revise it, refresh — passes against a live provider. | WS-R1…WS-R13 |
| **AC-039** | A pinned requirement dropped by a later version is reported as an `error`, deterministically, with **no model call**, and the result is byte-identical on repeated runs. | WS-R24, WS-R25 |
| **AC-040** | With Layer 2 disabled entirely, Layer 1 still reaches the same verdict on the same inputs. Asserted by running the ledger check with the judged layer switched off. | WS-R27.3 |
| **AC-041** | No judged finding can suppress, downgrade or resolve a Layer 1 diagnostic; asserted adversarially with a drift finding that contradicts a ledger miss. | WS-R27.1, WS-R27.2 |
| **AC-042** | No model-originated path can add, edit, remove or unpin a ledger entry. | WS-R24, WS-R27.4 |
| **AC-043** | Deterministic ledger results and advisory drift findings are distinguishable in every surface that renders them. | WS-R28 |
| **AC-044** | A requirement's id is unchanged across prompt versions, and no model-reachable path can set or alter its `origin`. | FR-052, RQ-R1, RQ-R3 |
| **AC-045** | An exported package validates against the published JSON Schemas and is readable with JSON parsing alone — asserted by a test that imports no FORGE module. | PK-R7, PK-R8 |
| **AC-046** | A package built by the workspace and one built by the CLI from the same IR, profile and pinned requirements are byte-identical except `run.json`; with different pinned requirements they carry different `semantic_id`s. | INV-005, PK-R3 |

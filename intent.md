# FORGE — Intent

> **Authority:** this document owns *why* FORGE exists and what would falsify it.
> It deliberately contains no architecture. See [`spec.md`](spec.md) for requirements
> and [`docs/architecture.md`](docs/architecture.md) for design.

---

## Problem

A person with a real engineering task and a capable coding agent has no reviewable
artifact between them.

Today the options are:

1. **Type a sentence and hope.** The agent infers goals, invents constraints, and
   picks a scope. Nothing records what it assumed. When it goes wrong, there is no
   object to inspect — only a transcript.
2. **Hand-write a long prompt.** It works once. It is not portable to another agent,
   not versioned, not diffable, carries no provenance, and cannot be evaluated before
   it is spent.
3. **Dump the repository into context.** This actively degrades agents that retrieve
   better than you do, and buries the instruction under noise.

All three share the same defect: **the task itself is never represented.** Intent
exists only as prose, and prose cannot be type-checked, diffed, ranked, attributed,
or recompiled for a different target.

## Why Now

Prompt enhancement solved a problem that no longer dominates. When models were weak
at instruction-following, adding structure and detail to a prompt reliably helped.
That is no longer where the failure mass sits.

Three things changed:

- **Agents diverged.** Claude Code, Codex, OpenCode, Kiro, Hermes Agent, and DeepSeek
  Harness differ in retrieval autonomy, permission model, and artifact topology — not
  merely in prose preference. A prompt tuned for one is wrong for another in ways that
  rewording cannot fix.
- **Agents retrieve well.** Modern coding agents search better than a static
  pre-injection pass. Adding context is now frequently *negative*: it burns attention
  budget, anchors the agent on the compiler's guesses, and suppresses better retrieval.
  "More context" and "better prompt" have decoupled.
- **Retrieved content became an attack surface.** Repository files, issues, dependency
  docs, and web pages now flow into agent context. Agents read tokens, not trust
  labels. Anything that assembles context is a security boundary whether it admits it
  or not.

So the remaining problem is not *phrasing*. It is **representation, targeting,
attribution, and review** — a compilation problem.

## Product

FORGE is a **conversational prompt specialist and context-engineering
workspace**, built on an intent-and-context compiler.

A person describes an idea, pastes a prompt or a specification of any size,
attaches supporting files, and chooses the agent they are targeting. FORGE
shapes that into one working artifact — the **current prompt** — and then
iterates on it, one requested change at a time, preserving everything the user
did not ask to change.

They can discuss it, critique it, revise one section, generate alternatives,
compare and merge them, edit it by hand, restore an earlier version, compile it
for a specific target agent, and export it.

**Output length is proportional to the task.** A simple task deserves a concise,
excellent prompt; a complex specification deserves a detailed one. Padding for
the appearance of sophistication is a defect, not a feature.

## User

The engineer who already uses coding agents daily, works in a non-trivial
repository, and has been burned by an agent that widened scope, violated an
architectural boundary, or confidently solved the wrong problem.

They own the repository and are willing to review an artifact before spending an
agent run on it — because they have learned that the review is cheaper than the
cleanup.

**Not:** non-technical users, teams needing a hosted multi-user service, or
anyone wanting a general-purpose chatbot.

> **Correction (V2).** Earlier revisions of this document listed "anyone wanting
> a chat UI" as out of scope. That was wrong about our own product. The primary
> surface is now a **local conversational workspace**; the CLI remains the
> scriptable, non-interactive path over the same core. What stays out of scope is
> a *hosted* service, not an interactive one.

## Desired Outcome

When FORGE succeeds, a person can:

- State a task once, in their own words, and receive a **structured object** they can
  read, correct, and keep — not a wall of generated prose.
- See **exactly what the agent will be told and why**, with every line attributable to
  something they said, something in their repository, or a named rule.
- Send the same task to a **different agent** without rewriting it.
- Get told, *before* spending a run, that a goal has no verification, that a constraint
  never made it into the output, that half the retrieved context justifies nothing, or
  that the target agent cannot do something the task requires.
- Choose deliberately between **materially different execution strategies** — minimal
  change versus rigorous versus autonomous versus exploratory — rather than discovering
  after the fact which one the agent picked.
- Keep a **history** of tasks that can be diffed, re-run, and reused.

## Core Thesis

```
Human Intent
   → Intent Analysis          extract structure; never invent; record uncertainty
   → Context Resolution       retrieve by justification, not by volume
   → Canonical Task IR        provider-independent; content-addressed; reviewable
   → Agent Compilation        legalize against real capability; render to topology
   → Strategy                 structured overlays, not prose variants
   → Evaluation               coded diagnostics with evidence, not scores
   → Execution Package        reviewable, portable, attributable; FORGE stops here
```

The load-bearing claim is the **Task IR**: that intent has enough recurring structure
to be represented canonically, independent of any vendor — checkable, diffable,
attributable, and reusable — rather than living only in wording. What the
representation does not do, per the retired dogfood gate below, is make agents
execute better on its own.

## Constraints

- **The IR is the product.** Prose is a rendering artifact. If the IR is wrong, no
  wording fixes it.
- **The deterministic core is the source of truth.** Language models sit at explicitly
  registered, schema-constrained boundaries. They parse; they do not architect. Every
  boundary must be replayable and independently testable.
- **FORGE never executes anything.** It emits an Execution Package. Launching agents,
  worktrees, containers, and loops belongs to a separate system that does not exist yet.
- **Local-first.** Everything runs on the user's machine: no hosted backend, no
  multi-user service, no telemetry. The workspace is served by a local process the
  user starts and stops; there is no daemon and no background process outside it.
  Network access to model providers is explicit and configured by the user.
- **Provider- and agent-independent.** No vendor name, tool name, or output format
  belongs in the canonical representation.
- **Security is architectural, not a filter.** Trust tier is a field that changes
  compiler behavior. Untrusted content can never become an authoritative instruction.
- **Honest capability claims.** FORGE never claims support for a target beyond what
  its renderer can actually produce.
- **Minimal dependencies.** Every runtime dependency must justify itself.

## Non-Goals

FORGE will not become:

- **An executor or orchestrator.** FORGE never launches an agent, a worktree, a
  container, or a loop. It ends at the artifact (INV-004). Permanent.
- **A hosted service, a team platform, or a multi-user product.** Permanent.
- **A repository dumper.** By-reference is the default; inlining is a recorded
  degradation.
- **A prompt marketplace or a prompt-beautification toy.**
- **A scorer that emits "prompt quality: 97/100".** Permanent, not pending
  (INV-008).
- **A wrapper that makes one vendor's agent look like a product.**

Two former non-goals have been narrowed rather than dropped, because the
blanket versions were contradicted by what shipped:

- **Agent frameworks.** FORGE is still not *an agent*, and no framework may own
  the Task IR, the compiler, provenance, trust, or diagnostics. Whether a
  framework orchestrates the conversational turn is an engineering decision
  recorded in `docs/architecture.md` AD-17, not a matter of identity. That ADR
  currently rejects one, with a written condition for revisiting.
- **Retrieval.** FORGE is not a vector database and does not index a repository
  by default. Retrieval is a ladder: direct context, then selective file
  retrieval, then indexed retrieval — each step taken only on evidence that the
  previous one is insufficient. Embeddings remain unbuilt and evidence-gated.

## Success Signals

The thesis is **falsifiable**, and the project is built so it can fail honestly.

**Primary signal — the dogfood gate (TESTED: claim retired).** On a benchmark of real tasks, a blind comparison
of *raw task handed to the agent* versus *FORGE Execution Package handed to the same
agent* was required to show FORGE winning on tasks that are ambiguous, multi-constraint, or
architecturally sensitive. Measured by: constraint violations, scope overruns, and
correction cycles required.

The gate ran twice. AC-025 at P1.5 returned RECONSIDER (no measurable difference
across 6 execution pairs). P1.6, a harder validation with violation opportunities
and a frozen discriminative design, returned FAIL (0 FORGE wins in 8 pairs, with
one genuine over-blocking loss and zero FORGE-caused defects anywhere). The claim
that **structured Task IR alone improves execution quality over a raw task is
therefore retired** — tested and not demonstrated, not merely unproven. Both
records stand as run; neither is reinterpreted.

This gate is placed **early and deliberately** (phase P1.5, before the context engine
and the strategy system are built) so that a negative result costs weeks rather than
months.

**Supporting signals — each individually checkable:**

- The same Task IR compiles to materially different targets, and every hard constraint
  survives in all of them.
- Adding a new agent at compatibility fidelity requires a YAML file and no code.
- Every non-whitespace byte of every emitted artifact is attributable to a named
  origin, verified mechanically rather than asserted.
- Deterministic compilation reproduces byte-identically across machines and days.
- The full non-model test suite passes with no API key and no network.
- Planted injection payloads and planted credentials never reach an emitted artifact.
- Diagnostics catch real defects — uncovered goals, dropped constraints, unjustified
  context, capability gaps — on tasks a competent engineer agrees were defective.

**What failure looked like, stated in advance — and what happened.** If FORGE did not beat the raw prompt
on ambiguous tasks, the honest conclusion would be that its value is *specification,
portability, review, and attribution* — not prompt quality. That is what the evidence
showed, so the project has narrowed accordingly and says so here publicly.

**Core thesis (V2, current).** FORGE is an auditable Intent & Context Compiler
wearing a conversational workspace: it converts human engineering intent and
justified context into provider-independent Task IR and target-native artifacts
while preserving constraints, provenance, trust boundaries, verification
requirements, portability, capability honesty, deterministic diagnostics, and
explainability. Execution-quality improvement is a possible downstream effect,
NOT a core guarantee — and no future work may be justified as an attempt to
rescue the retired claim. The load-bearing claim is the **auditability of the
artifact**: checkable, diffable, attributable, and reusable — verified
mechanically (a deterministic suite that runs with no API key and no network,
byte-level trace coverage, honest refusal) rather than by agent-outcome
comparisons.

**What that obliges the product to do.** Auditability is a property of the
running product, not a sentence in this file. A prompt the user is iterating on
must carry the same guarantees the CLI's artifacts do: every version recorded,
every model call's provenance persisted, every dropped requirement surfaced with
evidence, and uploaded files subject to the same trust and secret controls as
repository files. Where the product does not yet do this, `plan.md` says so and
names the phase that closes it.

**And the guarantee must not rest on a model's paraphrase.** Requirements the
user has **pinned** are checked deterministically, with no model call — that is
the mechanical verification this thesis claims. A broader, model-judged check for
semantic drift sits above it as *advice*, and may never suppress, downgrade, or
stand in for the deterministic one. Mixing the two would make the central promise
only as trustworthy as an extraction call.

# FORGE — Functional roadmap V2-F … V2-I

> **Authority:** this document is subordinate to [`plan.md`](../plan.md), which owns
> sequencing and gates. It exists because the roadmap's *reasoning* — what was
> considered and rejected, and why the phase order changed — does not fit in a phase
> table and would otherwise be lost. `plan.md` carries the phase entries; this carries
> the argument behind them.
>
> - *Why* → [`intent.md`](../intent.md) · *What* → [`spec.md`](../spec.md)
> - *How* → [`architecture.md`](architecture.md) · *Rules* → [`CLAUDE.md`](../CLAUDE.md)
>
> Approved 2026-09-21, after V2-R. Four decisions were taken by the project owner
> before planning and are recorded in "Context" below; they are not open questions.

## Context

V2-R is complete and verified at `e9b3c68` on `v2r/product-convergence`: 1078 tests
passing / 65 skipped, web E2E 64/64, the P1.6 manifest untouched, diagnostics visible in
the product, `forge explain` attributing 100% of bytes on all seven profiles, and CLI/web
compilation byte-identical against the deployed server.

That closed the gap between the *core* and the *product*. What remains open is the gap
between the product and the **thesis** in `intent.md`: FORGE claims to be an auditable
intent-and-context compiler, but the pipeline stops at a rendered artifact. There is no
portable object to hand an external agent, no way to know afterwards whether the
requirements were met, and no stable identity for a requirement across the versions it
survives. Those three absences are what this roadmap closes.

**The pipeline, with today's truth marked.**

```
Human Conversation        ✅ V2-A…V2-E
Requirement Governance    ◐  pinned ledger only — no identity, no lifecycle
Canonical Task IR         ✅ P0
Code/Repository Linkage   ❌ CLI-only context engine; workspace has no repo binding
Target Compilation        ✅ P1 + V2-R step 9
Execution Contract        ❌ never built (P5 → V2-F, still not started)
External Agent Execution  ⛔ out of scope, permanently (INV-004)
Mechanical Verification   ❌ obligations exist as IR data; no verdict path
Requirement Evidence      ❌
Explainability            ◐ `forge explain` covers IR → artifact bytes only
```

**Four decisions taken before planning** (confirmed with the user):

1. **FORGE never executes.** `INV-004` stands unamended. Verification ingests a
   structured evidence file produced by the user, their agent, or CI. This is also the
   safer reading: `verification[].spec` is authored by the `intent.extract` model, so
   executing it would mean executing a model-derived command string.
2. **Repository binding, deterministic evidence only.** Linkage reuses `WorkspaceGuard`
   and `resolveContext`. Model-suggested links are stored separately and always advisory.
   No symbol graph, no embeddings — `intent.md`'s retrieval ladder requires evidence that
   the previous rung was insufficient, and there is none.
3. **Minimal requirement lifecycle.** `origin ∈ {user_stated, inferred}` (immutable,
   FORGE-assigned) is orthogonal to `status ∈ {open, accepted, superseded, conflicted}`.
   "Pinned" stays the existing deterministic ledger, not a state.
4. **Optimise for shortest path to a usable product.**

---

## Phase order — changed from the proposal

The proposed order was V2-F → V2-G (governance+linkage) → V2-H (verification) → V2-I.
**I recommend swapping G and H**, for one structural reason: verification depends on the
Execution Contract (obligations must be *in* the package) but does **not** depend on
requirement lifecycle or code linkage. Linkage, conversely, is nearly worthless until
there are verdicts to link to — a requirement→file map with no verdict column is a
bookmark list.

Minimal **stable requirement identity** moves forward into V2-F, because the package
manifest needs it regardless. Lifecycle, linkage and the traceability matrix stay together
in the later phase, where they pay off at once.

| Phase | Name | Ships |
|---|---|---|
| **V2-F** | Execution Contract + requirement identity | A portable package a developer or CI can consume without FORGE |
| **V2-G** | Evidence-based verification | A verdict: did the run satisfy the obligations? |
| **V2-H** | Requirement governance + code linkage | Lifecycle, repo binding, traceability matrix |
| **V2-I** | Productization | One-command start, Docker, release, bounded verbosity work |

---

# V2-F · Execution Contract + requirement identity *(absorbs P5)*

### 1. Product capability gained
`forge package --ir <path> --target <profile> --out <dir>` and a **Export package**
action in the Studio produce a self-contained directory a developer hands to Claude Code,
Codex or CI. It is readable with JSON parsing and the published schema alone — no FORGE
runtime (`PK-R8`). Two packages built from the same inputs on different days are
byte-identical except `run.json`.

### 2. Architectural changes
New `src/package/`: `manifest.ts` (`semantic_id` over the §6.4 tuple plus every
artifact's `content_hash`), `assemble.ts` (the nine semantic files), `export.ts`
(relocatable; no absolute paths). New `src/requirement/identity.ts` for stable ids.
`forge explain` gains a package mode. One new CLI command (`package`), one web route.

### 3. Existing components reused
Everything the package contains already exists. `compile()` returns artifacts, spans,
diagnostics, materialization, degradations, droppedContext, topologyGaps, tokenizer and
`refused`; `semanticHash` computes the IR hash; `src/store/{objects,runlog,index-store}.ts`
are **already built** (P5's file list in `plan.md` is stale and claims otherwise);
`web/lib/compile.ts` is the workspace path; `src/cli/explain.ts` already resolves every
`TraceOrigin` kind. **The package is assembly, not new computation.**

### 4. New IR / schema requirements
**No Task IR change.** `verification.json` is projected from the existing
`verification[]` nodes — `{id, kind, spec, expected, satisfies[]}` is already `PK-R5`'s
shape exactly. New JSON Schemas emitted under `schema/` and covered by `pnpm schema:check`:
`package`, `runtime-contract`, `verification`, `diagnostics`, `trace`, `provenance`.

Requirement identity is **conversation-level, not IR-level**, and this is load-bearing:
the Task IR is re-extracted per version, so `g1`/`c1` are stable only *within* a version.
A requirement that must survive version 3 → 7 cannot live there. The registry extends
`LedgerEntry` (which already has `id`, `text`, `contentHash`, `origin`) and links to IR
nodes as a per-version *resolution*, recomputed, never stored as truth.

### 5. Tests / evals required
| Test | Asserts |
|---|---|
| `property/determinism` | Two compilations `diff -r` identical except `run.json`; `run.json` **does** differ; **no frozen clock** (`TS-R3`) |
| `contract/no-execution` | Static: no code path executes a command derived from an IR or package (`AC-020`) |
| `contract/package-portable` | No absolute paths; parses against the published schema with no FORGE import |
| `contract/explain-is-pure` | `explain` imports no module under `src/model/` (`FR-043`, `PV-R5`) |
| `property/requirement-identity` | An id survives version churn; `origin` is never writable from a model path |

### 6. Acceptance criteria
`AC-005` (determinism, unfrozen clock) · `AC-020` (static no-execution) · `PK-R1`–`PK-R8`
· a package produced by the web route and by the CLI for the same IR+profile is
byte-identical except `run.json`.

### 7. Non-goals
No execution, no orchestration, no daemon. **No `forge history`** — the workspace already
*is* the history UI and a second surface over the same store is duplicate product.
No new representation of anything the IR already holds.

### 8. Migration / backward compatibility
Purely additive; no existing output changes. One real hazard: `semantic_id` must be
computed over the **allowlist projection** (`INV-015`), so every new package field is
excluded from the hash until deliberately added. Getting this backwards makes every future
field a determinism break.

### 9. Security / trust
`runtime-contract.json` **declares, never grants** (`PK-R4`) — enforcement belongs to an
executor that does not exist. Export is an exfiltration surface: it must carry redaction
*records* and never redacted content, and must not leak absolute paths (which disclose
usernames and directory layout).

### 10. Scope / risk
**M / Low–Medium.** Largest new module ~250 lines. The risk is determinism discipline, not
novelty — and `TS-R3` names the forbidden fix (freezing the clock) in advance.

---

# V2-G · Evidence-based verification

### 1. Product capability gained
`forge verify --package <dir> --evidence <file>` and a Studio panel answer: **did this run
satisfy its obligations?** Per obligation: `VERIFIED` · `FAILED` · `UNVERIFIED` ·
`REVIEW_REQUIRED`. Never a score (`INV-008`), never a model's opinion.

### 2. Architectural changes
New `src/verify/`: `obligations.ts` (project obligations from the package),
`evidence.ts` (schema + integrity), `verdict.ts` (the deterministic matcher). No model
boundary is added and none is needed — this layer has no judgement in it.

### 3. Existing components reused
The verdict taxonomy **already exists in the IR** and needs no invention:
`VERIFICATION_KINDS = [command, test, manual, review]` with
`EXECUTABLE_VERIFICATION_KINDS = [command, test]`. Executable kinds are mechanically
checkable; `manual`/`review` are `REVIEW_REQUIRED` **by construction**, which is exactly
the honest answer for "subjective UX quality". `satisfies[]` already links an obligation
to the goals it discharges, so goal-level rollup is a join, not a new model. Diagnostics
reuse `diagnostic()` and the existing registry.

### 4. New IR / schema requirements
**No Task IR change.** One new schema, `evidence.json`:

```
{ obligation_id, kind, exit_code, stdout_hash, stderr_hash,
  started_at, duration_ms, runner, repo_commit, package_semantic_id }
```

Plus new spec requirements and codes (**specification first**, per the V2-D1 precedent the
step-4 cross-check test now enforces):
- **EV-R1.** Evidence is never model-authored. No model boundary may emit an evidence
  record, and no evidence field may be filled from a model response.
- **EV-R2.** Evidence binds to the package it verifies by `semantic_id`; evidence for a
  different package is `UNVERIFIED`, never silently accepted.
- New codes: `FORGE-V001 obligation_unverified` (info) · `FORGE-V002 obligation_failed`
  (error) · `FORGE-V003 evidence_package_mismatch` (warning).

### 5. Tests / evals required
The full verdict matrix (kind × evidence-present × exit-code); tampered evidence rejected
by hash; evidence for a different `semantic_id` → `UNVERIFIED` not `VERIFIED`; the
no-execution static test **extended to `src/verify/`**; a `manual` obligation can never
reach `VERIFIED` however much evidence is supplied.

### 6. Acceptance criteria
Every obligation in a package receives exactly one verdict · no `manual`/`review`
obligation is ever `VERIFIED` · a `FAILED` verdict cites the exit code and the evidence
record · `AC-020` still passes with `src/verify/` in the tree · verdicts are byte-identical
across runs for fixed package + evidence.

### 7. Non-goals
**No execution** — this is the whole point of the phase's shape. No sandbox, no runner, no
container. No model-judged verification. No auto-remediation.

### 8. Migration / backward compatibility
Additive. A package without evidence is fully `UNVERIFIED`, which is a legitimate and
useful state, not an error — so verification never blocks the V2-F workflow.

### 9. Security / trust
Evidence is **untrusted input**: it arrives from outside and must never become an
authoritative claim without integrity checking (`INV-002`'s reasoning applies directly).
Raw stdout is hashed rather than stored in the semantic layer, because command output
routinely contains tokens and paths — an excerpt is opt-in and secret-scanned through the
existing `scanSecrets`.

### 10. Scope / risk
**M / Medium.** The logic is simple; the risk is *claiming too much*. The single rule that
keeps it honest: a verdict is a statement about evidence, never about the world.

---

# V2-H · Requirement governance + code linkage

> **Status: COMPLETE 2026-09-22.** As built in `spec.md` §22.10 and
> `docs/architecture.md` §23.8; deviations from this entry are in `plan.md`'s log.

### 1. Product capability gained
Requirements acquire identity, lifecycle and location: a **traceability matrix** —
requirement × files × tests × verdict — that says which requirements are real, which were
superseded, which conflict, and which are backed by a passing test.

### 2. Architectural changes
`src/requirement/` grows `status` and supersession. The web workspace gains **repository
binding**: a conversation may name a local repo path, opened through the existing
`WorkspaceGuard`. `src/requirement/linkage.ts` derives links deterministically.

### 3. Existing components reused
`WorkspaceGuard` (path jail, ignore rules, deny globs, secret scan — `INV-011`),
`resolveContext` (ripgrep term derivation, scope globs, git history, deterministic
ranking, `justifies` from retrieval provenance), `assignTrust`, and the
`FORGE-W008` demotion detector, which is already the mechanism preventing an inferred
requirement from being presented as stated.

### 4. New IR / schema requirements
Requirement registry gains `status` and `superseded_by`. `origin` is **immutable and
FORGE-assigned** — a test must assert no model-reachable path can set `user_stated`, which
is `INV-016`'s rule applied to requirements. Links carry
`{requirement_id, path, kind: file|test, evidence: rg_term|scope_glob|git_history|test_naming, advisory: boolean}`.
Model-suggested links set `advisory: true` and are stored in a **separate collection** —
not a flag on the same list, because a flag on a shared list is one rendering bug away from
looking authoritative.

### 5. Tests / evals required
Linkage is deterministic across runs · a model path cannot write `origin` or a
non-advisory link · supersession chains resolve and cannot cycle · repo binding cannot
escape the path jail (extend `tests/security/pathjail.test.ts`) · a bound repo's secrets
never reach a conversation or a package.

### 6. Acceptance criteria
Every requirement has exactly one `origin` and one `status` · a superseded requirement
remains readable with its successor named (evolution is traceable, never destructive) ·
deterministic and advisory links are separable in the API and on screen · the traceability
matrix is a pure join over V2-F/V2-G data with no new inference.

### 7. Non-goals
No symbol graph, no LSP, no embeddings, no index — rungs of the ladder that need evidence
the previous rung failed. No auto-acceptance of inferred requirements. No conflict
*resolution*; conflicts are surfaced, and the human decides.

### 8. Migration / backward compatibility
Existing ledger entries migrate to `origin: user_stated, status: accepted` — which is what
pinning has always meant, recorded rather than changed. Conversations with no bound repo
keep working with an empty linkage set.

### 9. Security / trust
**This is the phase's real cost.** Repository binding gives the *served workspace*
filesystem reach it has never had. Every read must go through `WorkspaceGuard` (`INV-011`)
and every ingested file through `scanSecrets`, exactly as V2-R step 10 did for
attachments. A bound repo must be explicit, per-conversation, and revocable.

### 10. Scope / risk
**L / Medium–High** — the highest-risk phase, and the new filesystem surface is why. The
mitigation is that the gateway, the scanner and the trust assignment all already exist and
are already tested; this phase must *route through* them, never around.

---

# V2-I · Productization

### 1. Product capability gained
A developer runs one command and has FORGE. Docker image, published JSON Schemas, a
release, and a UI that does not require reading `spec.md` to use.

### 2. Architectural changes
Minimal by design. A startup entry point, a Dockerfile, a first-run experience for "no
provider configured", config migration, and a terminology pass over user-facing strings.

### 3. Existing components reused
`README.md`, `CONTRIBUTING.md`, `LICENSE`, `.github/workflows/ci.yml` and the root export
all landed in **V2-R step 1**. The standalone Next build and `web/scripts/e2e.sh` already
produce the deployable artifact.

### 4. New IR / schema requirements
None. Schemas are *published*, not changed.

### 5. Tests / evals required
CI green on a clean clone · Docker image starts and serves `/api/health` · the documented
one-command start works from a fresh checkout with no API key (degrading to the
"no provider configured" screen, which already exists) · a live browser workflow against a
real provider as the release gate, not a mock.

### 6. Acceptance criteria
One documented command from clean clone to working workspace · Docker start documented and
tested · no user-facing string requires internal research vocabulary ("Task IR",
"boundary", "archetype", "semantic hash") without an inline plain explanation · schemas
published and versioned.

### 7. Non-goals
No hosted service, no multi-user, no telemetry, no auth — all permanent in `intent.md`.

### 8. Migration / backward compatibility
`FORGE_DATA_DIR` layout must not change; a Docker volume must mount an existing store and
work. This is the phase where an accidental store-layout change strands real users.

### 9. Security / trust
The Docker image must ship **no** default credential and must not bake `FORGE_APP_SECRET`.
Documentation must state plainly that the workspace binds locally and is not hardened for
public exposure.

### 10. Scope / risk
**M / Low.** Many small items, little architecture. The risk is schedule, not design.

### Bounded verbosity work — folded in here, gated
V2-R's compaction moved the corpus **0.2%** (18,710 → 18,681 words; T04/T07/T12 unchanged)
because the renderer can only suppress, and the repetition is authored by the
`intent.extract` and `conversation.generate` boundaries. A prompt-level fix is legitimate
**only** under all four conditions:
1. a versioned prompt change at a registered boundary (version bump + cassette
   regeneration, exactly as V2-R step 5 did);
2. before/after word counts on all twelve eval IRs, reported whatever they show;
3. the ledger check runs before and after with **zero** presence-verdict changes — brevity
   never buys itself with a dropped requirement;
4. **if the measured reduction is under 10%, the prompt change is reverted**, not kept as
   an unmeasured edit.

It may never be justified as improving execution quality — `intent.md` retires that claim
and forbids future work from rescuing it.

---

## `forge explain`, phase by phase

The target is `requirement → provenance → IR → target instruction → code linkage →
verification evidence`. It is built up, not rewritten:

| Phase | Adds |
|---|---|
| today | IR node → artifact byte ranges, origins, constraints → sections, coverage |
| V2-F | explain a **package**, not only an IR; resolve `semantic_id` and the input tuple |
| V2-G | obligation → evidence → verdict, with the evidence record cited |
| V2-H | requirement → IR node → artifact → file/test, deterministic and advisory separated |

No visual UI in this roadmap. `forge explain` stays CLI + JSON; the Studio surfaces the
traceability matrix, which is the part a user actually reads.

---

## Discard from the old V2-F / P5 design

| Discard | Why |
|---|---|
| `forge history` (`FR-045`) | The workspace **is** the history UI since V2-C. A second surface over one store is duplicate product. Keep `forge diff` for *packages* only — CI reproducibility needs it. |
| "Target metadata governs model routing" (`WS-R20`/`WS-R21`, `AC-034`/`AC-035`) | **Already done** in V2-R step 11 and covered by `tests/product/opencode-routing.test.ts`. Strike it from V2-F's exit gate. |
| Old V2-G "Attachments through WorkspaceGuard" | **Already done** in V2-R step 10. Strike the phase. |
| `src/trace/explain.ts` as a new module | V2-R built `src/cli/explain.ts`. Do not build a second resolver. |
| P5's file list for `src/store/*` | `objects.ts`, `runlog.ts`, `index-store.ts` already exist. The plan is stale. |
| `config.json` in `PS-R1` | Already deviated to `providers.json` + `providers.secrets` (V2-C), because `WS-R19` requires secrets stored separately. |
| P6's judged diagnostics (`C040`, `C041`, `C051`) and `critic.judge` | Keep unbuilt. Neither V2-D nor V2-E needed a model to produce a finding, and neither does anything here. Cataloguing them was correct; building them is not on the path. |
| P6's second full-fidelity renderer | `native_topology` is honest and sufficient; `full` buys section overrides nobody has asked for. |

---

## Worth borrowing from competing systems

| Borrow | From | Why it strengthens FORGE without cloning |
|---|---|---|
| **Traceability matrix** (requirement × file × test × verdict) | Requirements engineering (DOORS lineage) | The highest-value item here and nearly free: a join over data V2-F/V2-G/V2-H already produce. It is the artifact that makes the audit claim visible in one screen. |
| **Explicit human approval gate** between requirement set and compilation | spec-driven tools (Kiro, spec-kit) | FORGE already has the objects; it lacks the *moment*. One deliberate gate turns `status: open → accepted` into the review step `intent.md` says the user is willing to do. Cheap. |
| **Change proposals as first-class** | OpenSpec / spec-kit | Maps exactly onto `superseded_by`. Nothing new to build — only to name in the UI. |
| **CI-consumable artifacts with exit codes** | modern dev tooling generally | Package + evidence + verdict + non-zero exit is what makes FORGE usable in a pipeline rather than only at a desk. Already the direction of V2-F/V2-G. |

**Deliberately not borrowed:** agent orchestration and sandboxed runners (Devin, OpenHands,
SWE-agent) — `INV-004`; vector/RAG indexing (Cursor, Continue) — the ladder forbids it
without evidence; quality dashboards and scores — `INV-008`, permanent; multi-agent debate
or critic ensembles — expensive judgement where FORGE promises determinism.

---

## Impressive, low product value — do not build

- **Symbol-level code graph / LSP integration.** Large subsystem, new dependency class,
  freshness and invalidation problems, and file-level linkage has not yet been shown
  insufficient.
- **LLM-as-judge verification.** Directly contradicts the phase's premise and `WS-R27`.
- **Visual provenance graph.** Beautiful in a screenshot; the traceability matrix answers
  the question people actually ask.
- **Auto-fix for diagnostics.** A diagnostic exists so a human decides; auto-fixing
  converts an audit tool into the guesser it was built to replace.
- **Real-time agent monitoring / streaming execution view.** Requires being an executor.
- **Team dashboards, multi-user, prompt marketplace.** Permanent non-goals.
- **A second full-fidelity renderer.** Effort proportional to novelty, and there is none.

---

## Shortest path from today to a strong usable FORGE

```
V2-F  Execution Contract + requirement identity   ← the product becomes portable
V2-G  Evidence-based verification                 ← the product becomes accountable
V2-H  Governance + linkage + traceability matrix  ← the product becomes auditable over time
V2-I  Productization                              ← the product becomes installable
```

If the schedule tightens, **V2-F + V2-G + V2-I is a coherent, shippable product** on its
own: portable packages, honest verdicts, one-command install. V2-H is what makes the
auditability claim hold *across time* rather than per-run — valuable, and the one phase
that can be deferred without leaving something half-built.

---

## Verification (applies to every phase)

```bash
pnpm --filter forge build && pnpm typecheck && pnpm schema:check
pnpm test                                   # no API key, no network (NFR-007)
./web/scripts/e2e.sh                        # HTTP product suite
sha256sum -c evals/p16/MANIFEST.sha256      # frozen; nothing under evals/p16/ may change
```

Plus, per phase, in the **running app** — a mock passing is not a feature working:
- **V2-F:** export a package from the Studio; `diff -r` two CLI packages built minutes
  apart (identical except `run.json`); parse the package with schema only, no FORGE import.
- **V2-G:** run a real test suite, feed the evidence file to `forge verify`, and confirm a
  genuine `FAILED` when a test actually fails — not a synthesised one.
- **V2-H:** bind a real repository, confirm the path jail rejects an escape, confirm a
  planted credential in the repo never reaches a conversation or a package.
- **V2-I:** fresh clone → one command → working workspace; Docker start; live browser
  workflow against a real provider.

---

## Documentation debt — cleared 2026-09-21

Identified while writing this roadmap and cleared in the commit that added it, before
V2-F began:

- `CLAUDE.md` listed as unfixed three defects V2-R fixed (the root `exports` map,
  `irForVersion` protocol routing, `/preservation` latency), and its catalogue,
  test counts and "Not built" list all predated V2-R.
- `plan.md` had **no V2-R entry at all** — the phase shipped eleven commits without one —
  and its V2-F/V2-G/V2-H entries described a sequence this roadmap replaces.

Two of those old phases were struck rather than rewritten, because V2-R already did the
work: "Target intelligence and model routing" (V2-R step 11) and "Attachments through
WorkspaceGuard" (V2-R step 10).

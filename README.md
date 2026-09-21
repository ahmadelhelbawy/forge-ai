# FORGE

**An intent and context compiler for coding agents.** You describe a task; FORGE
turns it into a reviewable artifact you can read, correct, version, and compile for a
specific agent — and it tells you, mechanically, when something you asked for did not
survive.

FORGE never executes anything. It ends at the artifact.

> **Status: alpha (`0.1.0-alpha.0`).** The deterministic core is solid and well
> tested. The product around it is not finished. Read
> [What FORGE does not claim](#what-forge-does-not-claim) before adopting it — it is
> unusually specific, on purpose.

## Why it exists

A person with a real engineering task and a capable coding agent has no reviewable
artifact between them. You type a sentence and hope, or you hand-write a long prompt
that works once and is not portable, versioned, diffable, or attributable. In all
three cases **the task itself is never represented** — it lives only as prose, and
prose cannot be type-checked, diffed, ranked, attributed, or recompiled for a
different target.

FORGE represents it. The load-bearing idea is the **Task IR**: a provider-independent
structure for engineering intent that is checkable, diffable, attributable and
reusable.

## What it actually gives you

These are the properties that are mechanically verified, not aspirations:

- **A hard constraint always reaches the artifact** (`INV-003`), or compilation fails.
- **Untrusted content never becomes an authoritative instruction**, through any field
  (`INV-002`). Trust tier is a field that changes compiler behaviour, not a filter.
- **Honest capability refusal.** Compiling for a target that cannot do what the task
  requires is *refused* (`FORGE-C030`), not quietly downgraded.
- **No silent degradation.** Every drop, redaction, demotion and refusal emits a coded
  diagnostic with evidence (`INV-012`).
- **Deterministic compilation.** Same IR and profile in, byte-identical artifact out.
- **Pinned requirements are checked without a model.** If you pin a requirement and a
  later revision drops it, a deterministic check says so. A model asked "did you
  preserve this?" can be wrong; a mechanical check cannot.
- **No composite quality score.** Permanent (`INV-008`). FORGE will never tell you
  your prompt is 97/100.

## Install and run

Requires Node ≥ 22 and `pnpm`.

```bash
pnpm install
pnpm --filter forge build
```

The deterministic path needs no API key and no network:

```bash
pnpm forge agents                                   # list target profiles
pnpm forge ir validate <ir.json>
pnpm forge compile --ir <ir.json> --target claude-code --out ./out
pnpm forge explain --ir <ir.json> --target claude-code   # where every byte came from
pnpm forge package --ir <ir.json> --target claude-code --out ./pkg
pnpm forge verify --package ./pkg --evidence evidence.json   # did an external run satisfy it?
```

### The Execution Package

`forge package` emits the object FORGE is for: a directory you hand to a coding
agent or a CI job.

```
pkg/
  package.json            # identity, versions, and the hash of every other file
  task-ir.json            # the canonical task
  requirements.json       # every requirement, with a stable id and its origin
  artifacts/…             # the rendered instructions, at the target's own paths
  trace.json              # which bytes came from which node, rule or template
  provenance.json         # what each node was derived from, and its trust
  runtime-contract.json   # what an executor would need — declared, never granted
  verification.json       # how to check the work — data FORGE does not run
  diagnostics.json        # findings, deterministic and judged kept apart
  run.json                # the one volatile file; excluded from the identity
```

Reading one needs **JSON parsing and the published schemas under `schema/`** —
no FORGE. Every `content_hash` is `sha256` over the file's bytes, so a recipient
can verify the package with `sha256sum` alone. Two packages built from the same
IR and profile are byte-identical except `run.json`, whatever the clock says.

**FORGE runs none of it.** `verification.json` lists commands as data and the
runtime contract grants nothing; a static test asserts no code path in the core
could execute either (`INV-004`).

`forge explain --package ./pkg` reads a package back — requirements, obligations,
diagnostics and per-artifact span counts — using nothing but `JSON.parse`.

### Verifying an external run

Whoever executes the package — CI, Claude Code, Codex, a human — writes an
evidence file (`schema/verify/evidence.schema.json`): per obligation, the exit
code and **hashes** of stdout/stderr, never the raw output. `forge verify` then:

1. validates the package by **rebuilding it from its own inputs** and requiring
   every semantic byte to match, so an edited obligation cannot keep the old
   `semantic_id`;
2. ignores evidence recorded for any other package;
3. gives every obligation exactly one verdict: `command`/`test` are `VERIFIED`,
   `FAILED` or `UNVERIFIED` by exit code; `manual`/`review` are always
   `REVIEW_REQUIRED`.

It executes nothing. `VERIFIED` means *the supplied evidence, taken at its word,
shows the expected exit code*; evidence is unsigned, and the report says so.
`forge explain --package ./pkg --evidence evidence.json` shows obligation →
evidence → verdict, and the Studio has the same check under the package result.
`evals/v2g/` is a real run: a passing suite → `VERIFIED`, a genuinely broken one → `FAILED`.

### Requirement traceability

FORGE can answer, per requirement: who stated it, whether a human accepted,
superseded or found it in conflict, where the compiled artifact carries it, which
repository files and tests implement it, and what verdict external evidence gave its
obligations — the **traceability matrix**. It is a join over data FORGE already
holds; no model is asked.

```bash
pnpm forge explain --package ./pkg \
  --workspace ../my-repo \            # link requirements to files/tests (read via WorkspaceGuard)
  --governance decisions.json \       # accept / supersede / conflict (schema/requirement/)
  --evidence evidence.json            # join V2-G verdicts
pnpm forge explain --package ./pkg --json   # the matrix, byte-identical per input
```

Links are authoritative only with deterministic evidence (`rg_term`, `test_naming`);
anything asserted is shown separately as **advisory**. In the workspace, set
`FORGE_REPO_ROOTS` to the directories a conversation may bind (binding is refused
when it is unset), then use the Requirement traceability panel under Compile.
`evals/v2h/` is a real run.

Turning natural language into an IR uses a model boundary, so it needs a provider:

```bash
export FORGE_PROVIDER=openai-compatible   # or: anthropic
export FORGE_API_KEY=…
export FORGE_BASE_URL=…                   # for an OpenAI-compatible gateway
export FORGE_MODEL=…
pnpm forge task "Add rate limiting to /auth/login. Do not add dependencies." \
  --target claude-code --out ./out
```

The local workspace (conversational authoring, version history, pinned requirements,
alternatives):

```bash
pnpm --dir web dev      # http://localhost:3000
```

Everything runs on your machine. There is no hosted backend, no telemetry, and no
background process. Network access to model providers is explicit and configured by
you.

## Targets

Seven agent profiles ship today: `claude-code`, `claude-design`, `deepseek-harness`,
`hermes-agent`, `kiro`, `openai-codex`, `opencode`.

Adding a target is a YAML file in `profiles/`, not a code change. A profile declares
capabilities, retrieval strength, autonomy, and an output topology — which sections go
into which files. `kiro` gets a three-file native spec layout; `claude-design` refuses
tasks that need to write files.

## Architecture in one pass

```
Human intent
  → Intent analysis        extract structure; never invent; record uncertainty
  → Context resolution     retrieve by justification, not by volume
  → Canonical Task IR      provider-independent; content-addressed; reviewable
  → Target compilation     legalize against real capability; render to topology
  → Strategy               structured overlays, not prose variants
  → Evaluation             coded diagnostics with evidence, not scores
  → Artifact               FORGE stops here
```

The deterministic core is the source of truth. Language models sit at four explicitly
registered, schema-constrained, replayable boundaries — they parse; they do not
architect.

| Directory | Owns |
|---|---|
| `src/ir/` | Task IR: schema, hashing, attribution, trust, diagnostics |
| `src/compile/` | Lowering, legalization, budgeting, rendering, spans |
| `src/context/` | Workspace access, retrieval, secret scanning, trust assignment |
| `src/critic/` | Deterministic ledger and judged advisory checks |
| `src/intent/`, `src/conversation/` | The model boundaries |
| `web/` | The local workspace |

Deeper: [`intent.md`](intent.md) (why, and what would falsify it),
[`spec.md`](spec.md) (the contract), [`docs/architecture.md`](docs/architecture.md)
(design and ADRs), [`plan.md`](plan.md) (phases and a deviation log that records what
went wrong).

## What FORGE does not claim

This project pre-registered a falsifiable gate for its central claim, ran it twice, and
lost. That result is recorded rather than reinterpreted, and it constrains what is
written above.

**FORGE does not claim that a structured artifact makes an agent execute better than
the raw request.** A frozen, hash-pinned benchmark (`evals/p16/`) compared *raw task*
against *FORGE artifact* across 8 tasks with planted shortcut baits and an identical
executor. Result: **0 FORGE wins, 2 losses, 6 ties — FAIL.** An earlier gate returned
RECONSIDER. The claim is retired: tested, not demonstrated.

What survived is narrower and worth stating plainly: FORGE's value is
**specification, portability, review, and attribution** — the artifact being
checkable, diffable and attributable — not prompt quality. If you want a better
prompt, a competent frontier model will write you one, and in a blind comparison it
wrote better ones than FORGE did.

Known limitations today, all recorded in [`CLAUDE.md`](CLAUDE.md) and `plan.md`:

- Artifacts are more verbose than they need to be; sections restate one another.
- The workspace does not yet use the compiler, context engine or provenance system.
- `intent.extract` routes by provider rather than model protocol, so some gateway
  models are unreachable on that path.

## Development

```bash
pnpm typecheck
pnpm test            # 1017 passing — no API key, no network required
pnpm schema:check    # generated JSON Schema matches the Zod source
./web/scripts/e2e.sh # HTTP product suite against real routes
```

`schema/` is generated — never hand-edit it; run `pnpm schema:emit`.
`web/` imports the core through `forge/dist/*`, so run `pnpm --filter forge build`
before `pnpm test` after changing anything under `src/`.

A mock passing is not a feature working. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
the testing standard, which is stricter than usual and exists for a reason.

## License

Apache-2.0. See [`LICENSE`](LICENSE).

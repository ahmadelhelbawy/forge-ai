# V2-E live acceptance — candidates, comparison, merge

**Status: PASS — 43 checks, 0 failures, 3 of 3 candidates.**
Run 2026-09-20 against OpenCode Go (`opencode-go`), model `kimi-k3`, over
`chat-completions`. Evidence: [`2026-09-20-kimi-k3-acceptance.log`](2026-09-20-kimi-k3-acceptance.log).

This closes the one V2-E gate `plan.md` recorded as outstanding: a single clean
live run in which **all three** requested candidates complete on the concurrent
implementation. Every other V2-E gate had already passed deterministically.

## Why this exists alongside `web/scripts/live-smoke.mjs`

The standing live smoke covers V2-B, V2-D and V2-E together, and for this gate
it is not sufficient on three counts:

| | `live-smoke.mjs` | `v2e-acceptance.mjs` |
|---|---|---|
| candidate count asserted | `>= 2` | **exactly 3** |
| concurrency | not measured | measured: wall vs. per-call latencies |
| persistence | a re-read | a **real server restart** on the same data dir |

It deletes its data directory in `finally`, so it cannot prove restart
persistence. This harness keeps the directory, kills the server, starts a second
one on the same directory, and compares a full state snapshot across the
restart.

## What it asserts

Generation: all 3 archetypes return; provenance (`ST-R7`) and deciding rule
(`ST-R6`) on each; overlays pairwise distinct (§11.5); texts materially
different (`FORGE-W007`); `versionCreated: false` and the current prompt
untouched (`WS-R8`); Layer 1's verdict on every candidate, labelled and naming
the **candidate** rather than a version (`WS-R28`); the pinned requirement
present **verbatim** in every candidate (`WS-R24`); one model call per
alternative and nothing else (`WS-R13`); the ledger byte-identical (`WS-R27`).

Concurrency: the candidate phase's wall time against the sum of the per-call
latencies recorded in `ModelCallRecord`, and against the slowest single call.

Comparison, promotion, merge: content unique to each side; promotion writes
exactly one version, leaves earlier versions byte-identical and records the
choice; `MERGE` is a union that drops **nothing** either source said, keeps the
pin, reports per-source contributions, and is `action: "MERGE"`.

Truthfulness and persistence: provider and model as actually used, every
candidate call record `replayed: false`, no credential on any surface
(`WS-R16`), and the full state — candidates, promotions, versions, ledger,
provenance — unchanged across a real restart (`WS-R17`).

## Reproducing

Needs a built standalone server and a provider key. Never runs in CI; never
logs a credential.

```
pnpm --dir web build
FORGE_API_KEY=… FORGE_SMOKE_PROVIDER=opencode FORGE_SMOKE_MODEL=kimi-k3 \
  node web/scripts/v2e-acceptance.mjs
```

The key may instead live in a gitignored `.env.smoke.local` at the repository
root, in `KEY=value` lines, which the harness reads the same way
`live-smoke.mjs` does. Useful variables: `FORGE_SMOKE_PORT` (default 3621),
`FORGE_ACCEPT_DATA_DIR` (default: a fresh temp directory, kept after the run),
`FORGE_SMOKE_TIMEOUT_MS` (default 1200000).

Exit status is 0 on PASS, 1 otherwise.

## Choosing a model — read this first

**Use a `chat-completions` OpenCode Go model** (`kimi-k3`, `glm-5.3-flash`).

An `anthropic-messages` model (`qwen3.8-flash`, `minimax-m3`, …) will fail
before the gate is reached, and **not** because of V2-E: `irForVersion`
(`web/lib/preservation.ts`) still selects its transport from the *provider's*
kind rather than the *model's* documented protocol, so the prerequisite
`intent.extract` call goes to `/chat/completions` and the gateway answers
`HTTP 503` with an empty body. Measured on `qwen3.8-flash`: 3 attempts, 183s.
That is recorded as technical debt in `plan.md` and `CLAUDE.md`; it needs a
core change, because core's `AnthropicProvider` accepts no base URL.

The same defect in the candidate path itself **was** fixed on 2026-09-20 — see
`plan.md`'s deviation log — and is locked out by
`tests/product/opencode-routing.test.ts`.

## Stochastic prerequisite, not a lowered bar

Creating the base prompt is retried up to three times. It is a **prerequisite**
of the gate, not part of it: when a model's classifier returns non-JSON, FORGE
correctly degrades the turn to `DISCUSS` (`FORGE-W001`, `WS-R4`) and then
correctly blocks the write (`FORGE-W004`, `WS-R2`) — both invariants holding,
and no prompt to branch from. The candidate assertions themselves still get
exactly one attempt.

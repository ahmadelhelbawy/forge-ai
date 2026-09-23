# Product Sprint 2 — live-provider acceptance

Run 2026-09-23 against the providers configured in a throwaway data directory
(a copy of the provider settings only): **OpenCode Go** (`qwen3.8-flash` for the
browser Discovery run, `kimi-k3` for the scripted steps) and **OpenRouter**
(`nvidia/nemotron-3-super-120b-a12b:free` for reasoning effort). Nothing here is a
mock. `live-acceptance.mjs` drives a running server's own HTTP routes and wrote
every file in `live/`; it never reads or prints a credential.

    FORGE_URL=http://localhost:3001 node evals/sprint2/live-acceptance.mjs [step…]

## Result

First full pass: **32/36**. The four failures were real and are fixed or explained:

| Failure | Cause | Outcome |
|---|---|---|
| refine asked 3 questions | an instruction is a request, not a guarantee | the WS-R37 limit is now enforced (extra questions → open questions); rerun: 2 asked |
| verify: every obligation one verdict | the script's evidence omitted required nullable fields; the route correctly returned 400 | script fixed; rerun: 4 obligations, 4 verdicts, persisted |
| verify: persists across reload | same cause | rerun: pass |
| reasoning turn | upstream `Nvidia: Service temporarily overloaded` on a free model | rerun with a model list: pass on `nemotron-3-super` |

Rerun of the affected steps: **25/25** (`live/summary-paste-modes-compile-verify-reasoning.json`).

The live run also exposed a defect no check was written for: **Polish** added three
sections, because open questions were being written into the prompt as
assumptions. Under Polish they now go to the reply (WS-R32 amended); the polished
prompt went from 1217 to 696 characters for a ~630-character source.

## Files

| File | What it shows |
|---|---|
| `live/paste-refine.json` | A pasted prompt → `DISCOVER`, flavour `refine`, **no classification call**, 2 questions, no version. |
| `live/modes.json` | Polish / Strengthen / Rebuild on the same source: v1–v3, each mode recorded on its version, the pinned "Never approve a change that deletes a test" kept by all three (no `W005`), lengths 696 / 1844 / 2173. |
| `live/direct.json` | "Just improve it and compile this for Codex" → `CREATE` with no classification, target switched to `openai-codex`, `FORGE-W012` naming every assumed choice. |
| `live/kinds.json` | The same idea with artifact kind `agent` ("You are the issue triage agent…") vs `builder` ("# Build Instructions: … Build a lightweight…"). |
| `live/staged.json` | A staged builder prompt: 5 ordered stages, the pinned "zero downtime" carried by stages 1–5, no `W013`. `studio-stages.png` is the Studio's stage view of it. |
| `live/compile-multi.json` | One compile request for Claude Code, Codex and Kiro: one IR extraction, one semantic hash, per-target artifacts; Codex's bytes equal a single-target compile. |
| `live/package-verify.json` | The Execution Package, evidence for its executable obligation, verdicts (`test` VERIFIED; `review`/`manual` REVIEW_REQUIRED by construction), and the verification persisted on the conversation. |
| `live/reasoning.json`, `live/reasoning-refused.json` | OpenRouter support *discovered*; a turn with effort `low` succeeds and the effort is on its model-call events; `high` on `qwen3.8-flash` (no documented support) is refused with a 400 before any model call. |
| `live/provider-failure.json` | An unknown OpenRouter model → 502 with the provider's reason; only the user message kept, nothing written. |
| `live/discovery-after-restart.json` | The browser Discovery conversation (3 adaptive turns, confirmed kind `agent`, Generate → v1) read back after a server restart: brief, marks, version, `W010` + `W009`, and a call log with **one** classification across five calls. |

## Observed quality

- Discovery turn 1 filled the brief with guesses ("limited time/budget assumed");
  the stated/inferred marks exposed it and the instruction now forbids it — turn 2
  and 3 briefs held only stated facts and inferences marked as such.
- `FORGE-W009` reported **one** uncovered item on the live generate (Sprint 1's
  contiguous rule reported three paraphrases).
- Latency on the reasoning model `qwen3.8-flash`: discovery turns 17–37 s,
  Generate 90 s. On `kimi-k3`: 24–40 s per generate. Multi-target compile of a
  fresh version: 83–92 s, almost all of it the one IR extraction.

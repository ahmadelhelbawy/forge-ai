# Product Sprint 1 — Discovery, live-provider acceptance

Run 2026-09-22 against the configured provider: **OpenCode Go, `qwen3.8-flash`**
(a reasoning model, routed over anthropic-messages), in a throwaway data
directory seeded with a copy of the provider settings. Nothing here is a mock.

| File | What it shows |
|---|---|
| `live/turn1.json` | *"I want to build an AI agent but I don't know exactly what agent to build."* → `DISCOVER`, no prompt, three questions with options, a first brief. |
| `live/turn2.json` | Answers (business opportunity, bookkeeping practice, a few weeks, basic Python) → questions narrow to the bookkeeping pain, buyer and data; the brief gains target user, background, constraints, success criteria; `research_needed` flags that market validation needs current data. No classification call (WS-R31). |
| `live/turn3.json` | Answers (chasing documents, sell to other practices, Gmail, privacy, human approval) → the brief records "A human must approve every email before it is sent" and "Client data must remain private". |
| `live/before-generate.json` | After three discovery turns: **0 versions**, discovery `open`. |
| `live/generate-attempt1-budget-exhausted.json` | The first Generate: the model spent the whole 4000-token output budget reasoning and returned nothing. Reported as a failure (no blank message, no version, discovery still open). Fixed by raising the cap and naming the cause. |
| `live/generate.json`, `live/generated-prompt.md` | The explicit Generate after the fix: `CREATE`, version 1, discovery `generated`, `FORGE-W010` naming the 7 unresolved questions (each stated as a numbered assumption in the prompt), `FORGE-W009` naming 3 brief items the presence rule did not find verbatim — all three are paraphrases, not drops. Human approval, privacy, skill level, time and all five success criteria are in the prompt. |
| `live/provider-failure.txt` | An undocumented model id → HTTP 502 with the reason, conversation intact, no messages written. |
| `discovery-turn1.png`, `discovery-turn2.png` | The Discovery panel and the Studio brief in a real browser against the live model, before and after submitting answers through the UI. After a reload and reopening the conversation, the same questions and brief are shown. |

Two live defects were found and fixed in this sprint (see the commit log):
the classifier's and the generator's output caps were smaller than this
reasoning model's thinking, producing empty responses (measured: a 223-char
classify prompt returned empty at 1024 tokens, valid at 4000 after 47 s).

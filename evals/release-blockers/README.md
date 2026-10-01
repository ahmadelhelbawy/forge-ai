# Release blockers from manual acceptance — 2026-09-26

Live provider: OpenCode Go. Model: `qwen3.8-flash` (Anthropic Messages path) unless named.
Browser runs used a copy of the user's data store, never the store itself.

## 1. The 3-minute Strengthen that returned nothing

**Root cause.** `qwen3.8-flash` reasons without a bound when no thinking setting is
sent. FORGE sent none (it declared no reasoning support for the model), so the
model spent the whole 16,000-token output budget reasoning. FORGE's stream reader
drops reasoning parts, so the user watched "Generating prompt…" for 3½ minutes
with nothing on screen, then got `FORGE-W003` and a reply claiming a prompt had
been written.

Request chain for the user's failing turn (reconstructed from the stored
conversation, `web/scripts/probe-generation.ts`):

| | system | user (history + message) | input tokens |
|---|---|---|---|
| Generate — strengthen (CREATE) | 8,984 chars | 28,403 chars | ~7,700 |

Input is not the latency: first token arrives in 2.4 s. Latency is output
tokens × decode rate (≈ 75–100 tok/s):

| thinking sent | time | output tokens | reasoning chars | answer chars | finish | envelope |
|---|---|---|---|---|---|---|
| nothing (before) | **207 s** | 16,000 | 75,908 | **0** | `length` | none |
| `disabled` | 56 s | 5,255 | 0 | 24,793 | `stop` | valid |
| budget 2,048 (= `low`, new Default) | **84 s** | 5,538 | 3,307 | 23,113 | `stop` | valid |

User's store, same day: refine-discovery turn 118 s + 30 s repair; Generate 212 s,
`length`, no version.

**Browser, final build, same 10 kB prompt** (screenshots not published: they showed a personal conversation list):

| step | before | after |
|---|---|---|
| paste → refine discovery | 148 s (generate + repair) | **32.6 s**, one call, questions returned |
| Generate — strengthen (4 questions open) | 212 s, no version | **83.9 s, v1 saved** (16,591 chars) |
| "Strengthen this prompt…" on the saved 16.6 kB version (REVISE) | — | **116 s, v3 saved** (classify 2.2 s + generate 114 s) |

A REVISE run earlier in the session ended with the `prompt` string cut off at
char 20,369, finish reason not `length`, and was kept as chat (reply: "What
changed: …") with nothing saved. A rerun of the identical request succeeded
(99 s). Cause upstream not determined — FORGE did not record the finish reason.
That shape now fails the turn and names the finish reason (WS-R12a).

## 2. Thinking capability, measured per model (`web/scripts/probe-thinking.ts`)

| model | thinks by default | `disabled` honoured | budget honoured | declared |
|---|---|---|---|---|
| qwen3.8-flash, 3.8-max, 3.7-max, 3.7-plus, 3.6-plus | yes | yes | yes | yes, Default = low |
| minimax-m3 | no | yes | yes | yes, Default = nothing |
| minimax-m2.7, m2.5 | yes | **no** | — | no |

Chat-completions models on OpenCode Go (Kimi, DeepSeek, GLM, …) have no
documented setting: "Not supported", nothing sent.

Browser: Qwen shows `Default (Low) / Low / Medium / High`; Kimi K3 shows
"Not supported" (disabled, reason in the tooltip); MiniMax M3 and GPT 5.6 Luna show
`Default / Low / Medium / High`. High persisted across reload. Qwen turns recorded
`medium` on every call event; Kimi turns recorded none; the stored `medium`
survived a Kimi turn and returned on switching back.

## 3. Markdown download (Chromium, Playwright download events)

- v1 saved → `forge-prompt-v1.md`, byte-identical to the current prompt.
- hand edit → v2 → `forge-prompt-v2.md`, byte-identical, ends with the marker.
- after reload → `forge-prompt-v2.md` again; after the REVISE → title "Download version 3".
- conversation with no version → button disabled, title "Nothing to download yet — …".

Chromium downloaded correctly before the fix. Fixed anyway: the anchor was never
attached and the object URL was revoked in the same tick (Firefox ignores such a
click); the disabled button gave no reason. Not tested in Firefox or Safari.

## 4. Voice

No microphone exists here (WSL; `/dev/snd` has only `timer`). Real Google Chrome
was driven with speech synthesized by ffmpeg `flite` as a fake microphone
(`web/scripts/probe-voice.mjs`). Chrome's recognizer received the audio
(`audiostart → soundstart → speechstart`) but its speech service returned no text
(one run silent, later runs `no-speech`). **Transcription of real speech is NOT
verified.** Verified in real Chrome: no auto-send (0 message POSTs), draft editable,
cancel restores the draft. Defect found and fixed: a session that recognised
nothing ended silently; it now says so.

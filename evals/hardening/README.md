# Pre-release hardening — live acceptance

Run 2026-09-24/25 against the providers configured in a throwaway data directory
(a copy of the provider settings only): **OpenCode Go** — `qwen3.8-flash` (the
workspace default, a reasoning model) for flows A–F, `kimi-k3` for G. Nothing
here is a mock. `live-flows.mjs` drives a running server's HTTP routes; flow A
was driven by hand in a real browser (Playwright). No file here contains a
credential.

    BASE=http://localhost:3300 node evals/hardening/live-flows.mjs [B,C,D,E,F,J]

Offline, the same critical flows now also run in a real browser on every
`web/scripts/e2e.sh` (`web/scripts/browser-acceptance.mjs`, stub model).

## Result

| Flow | Outcome |
|---|---|
| **A** vague idea → Discovery (2 rounds) → *Generate with what we know*, 6 questions open | Version 1 written; Discovery closed (`generated`), the panel gone, the Studio on the Prompt tab, the composer "Ask for a change…". Only `FORGE-W010` (**info**, rendered as a grey note). The prompt has no questions and one 2-line *Assumptions* section; the reply lists "Decided for you". Coverage: G1 and C1 `worded`, C2 `cited` — a paraphrase the old 80 % overlap rule would have reported as a W009 warning. |
| **B** pasted prompt → refine fast path → Strengthen | Refine discovery, no classification call; Strengthen kept all four original rules (never approve failing tests, flag `eval()`/`exec()`, concise, file+line) and added inputs, missing-status handling and an output schema. No diagnostics. |
| **C** "Just strengthen this, no questions" | `CREATE` directly, no questions, usable prompt, no meta commentary. |
| **D** agent vs build-the-agent, same request | `agent`: "You are the support-triage agent…" with tags, actions, hard rules, output format. `builder`: "You are a coding agent tasked with building…" with workflow, components, config. Both keep "never promise refunds". |
| **E** staged builder | 5 stages, dependencies backwards only, each self-contained with acceptance criteria; no `W013`. |
| **F** one compile, three targets (`claude-code`, `opencode`, `openai-codex`) | **Failed first — a real defect, fixed:** every compile/package on an anthropic-messages model hit `…/v1/v1/messages` (404 HTML page, dumped whole into the error), then a missing `x-opencode-session`. After the fix: one IR extraction, one semantic hash, three artifacts, no refusals (≈3 min, almost all the reasoning model's extraction call). |
| **G** package → evidence → verify | Package built (`kimi-k3`; on `qwen3.8-flash` the extraction spent its whole output budget — the error now says so). Evidence: `v1` VERIFIED, `v3` FAILED (exit 1), `v2`/`v4` UNVERIFIED, `v5` REVIEW_REQUIRED; a record naming a forged package id ignored with `FORGE-V003`. |
| **J** unknown model | 502 with a named cause; no blank assistant message. The message was not kept server-side (by design for a configuration error) — the composer now hands it back. |

## Defects the live run found (all fixed unless marked)

1. **W003 on a Discovery turn that lost nothing.** 1 in 4 answers from `qwen3.8-flash` was invalid JSON after a complete reply; the user saw an amber warning and, before the fix, the raw JSON as the chat message. Now: trailing commas are tolerated (the one lossless syntactic repair), the recovered reply is shown, W003 names the parse error and is emitted only when something was lost.
2. **Discovery brief described the interview, not the agent** ("Clarify the scope…", "Identify the primary task" as success criteria). Instruction fixed; round 2 produced a real goal.
3. **Studio showed the brief under a highlighted "Prompt" tab**; now follows the work (Brief while discovering, Prompt the moment a version exists).
4. **Compile/package unreachable for every anthropic-messages model** (URL doubled `/v1`, session header dropped by the core provider). The existing test asserted `includes("/messages")`, which the broken URL satisfied; it now asserts the exact URL and the header.
5. **API conversations ignored the saved default model** and failed on a disabled provider; the resulting local config error was reported as "refused this model for your account".
6. **Generate wrote into a different conversation** when a message was sent while *New conversation* was still being created (browser acceptance). Composer now disabled during the create.
7. **Reload lost the open conversation**; now `#c=<id>` + last-opened fallback.
8. **Dictation duplicated text** when the recognizer re-delivered results (found by the browser suite before any user did).

Known, not fixed (see CLAUDE.md "Known defects"): the IR extractor raises a *blocking* "blast radius" question for non-code agent prompts (`FORGE-C080`, so such prompts compile with an error and cannot be packaged); the model sometimes restates its active questions as brief open questions, inflating the "N questions open" count.

## Files

`out/A.json` … `out/J.json` — per flow: the summary, the full reply and prompt (or artifacts / verdict report). `out/summary.json` — one line per flow.

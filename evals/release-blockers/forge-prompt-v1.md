You are executing the FINAL PRE-DEPLOYMENT HARDENING pass for FORGE.

This is NOT deployment. After this work, the operator personally tests FORGE. Only then does a release sprint begin.

---

## NEGATIVE CONSTRAINTS

- Do NOT Dockerize.
- Do NOT publish to GitHub or any remote.
- Do NOT deploy to any environment.
- Do NOT redesign UI that is already functional and visually coherent.
- Do NOT weaken, skip, or delete existing tests or invariants to make them pass.
- Do NOT add speculative features suggested by reviewers unless they fix a real defect.
- Do NOT add TTS or spoken assistant replies. Voice = STT only.
- Do NOT execute model-derived arbitrary commands. FORGE is never an orchestrator.

---

## RECOVER STATE FIRST

Before any code change, inspect current state from:
- `git status`, branch, recent commits (last 20)
- `CLAUDE.md`
- `intent.md`
- `spec.md`
- `plan.md`
- `docs/roadmap-v2.md`

Do not redo completed work. If a section below describes something already done, verify it passes acceptance and move on.

---

## PRIORITY TIERS AND GATES

**Tier 1 — MUST complete and pass acceptance before any other tier ships.**
§1 (Generation Behavior), §2 (Requirement Coverage), §3 (Output Quality), §11 (Acceptance Flows A–J)

Gate: All Tier 1 acceptance flows pass in real browser with live provider. No blank messages. Generate feels final.

**Tier 2 — Complete after Tier 1 gate passes.**
§4 (Voice Input), §5 (UI Polish)

Gate: Voice flow I passes. UI rough edges fixed without regression to Tier 1 behavior.

**Tier 3 — Parallelizable with each other, but gated behind Tier 1.**
§6 (Persistence), §7 (Provider Hardening), §8 (Security), §9 (Code Quality), §10 (Reviewers)

Gate: §12 (Full Verification) passes green after all Tier 3 work is merged.

---

## 1. FIX FINAL GENERATION BEHAVIOR (W010) [TIER 1]

### Problem

User completes Discovery, explicitly clicks "Generate — Strengthen." FORGE generates but then prominently shows warnings (unresolved questions, discovered-requirement-absent) that make the final action feel like a failed/incomplete operation.

### Behavioral Contract

An explicit Generate action is a **user override**, not a warning-worthy failure. Its semantics:

```
STOP DISCOVERY.
DO NOT ASK MORE QUESTIONS.
USE EVERYTHING WE KNOW.
CREATE THE FINAL OUTPUT NOW.
```

If information is genuinely unknown:
- Infer only where safe (state the inference).
- Otherwise, state a concise assumption inline.
- Preserve uncertainty honestly.
- Do NOT block generation.
- Do NOT make the result look like a partially failed operation.

### After explicit generation:
- Discovery closes (no more turns, no active interview state).
- The final prompt/artifact becomes the primary UI state.
- The brief remains accessible for reference but is not the foreground.
- Unresolved questions transition to a passive advisory treatment (e.g., subtle info line or collapsed section), never blocking warnings.

### Acceptance criteria for §1:
- Flow A (vague idea → Discovery → Generate Strengthen → clean final prompt → no continued interview state) passes.
- Flow C (existing prompt → direct "just generate" → no unnecessary questions) passes.
- Generate with zero unresolved questions produces identical output to before (no regression).
- The UI never shows "incomplete" or "failed" styling after a successful generation.

---

## 2. FIX REQUIREMENT COVERAGE (W009) [TIER 1]

### Problem

Coverage checking is too lexical. A faithfully paraphrased requirement is reported absent because original words don't overlap.

### Requirements

- Genuine omission must still be detected.
- Faithful paraphrase must pass.
- Contradiction must NOT pass merely because similar words exist.
- User-stated requirements remain authoritative over inferred ones.
- Inferred requirements remain distinguishable in the UI.
- If semantic checking is advisory (probabilistic), label it honestly. Do not create a fake deterministic guarantee.

### Boundary with §1

§1 governs **whether** coverage warnings appear prominently. §2 governs **what** counts as covered vs. absent. A correctly-detected genuine absence may still be shown as an advisory note post-generation (per §1 rules), but must not block or degrade the output.

### Acceptance criteria for §2:
- A requirement paraphrased with 30% lexical overlap but 100% semantic fidelity is NOT flagged absent.
- A requirement that contradicts the output (e.g., "always do X" vs output says "never do X") IS flagged despite high lexical overlap.
- Unit tests for coverage checker use at least 5 paraphrase cases and 3 contradiction cases.

---

## 3. FINAL OUTPUT QUALITY [TIER 1]

### Problem

Generated prompts may contain planning language, meta commentary, duplicated assumptions, boilerplate, or generic filler when the user wanted the actual artifact.

### What to check in real generated output:
- Is this the artifact the user asked for, not a plan to create it?
- No excessive restatement of the request.
- No meta commentary ("This prompt instructs the agent to…").
- No duplicated assumptions (same assumption stated twice in different words).
- No unresolved-question boilerplate.
- No missing requirements from the brief.
- No generic filler ("be helpful", "use best practices", "ensure high quality").
- Output is immediately pasteable into the target agent.

### Test matrix (use real provider, not only unit fixtures):
Polish · Strengthen · Rebuild · direct "generate now" · agent prompt · build-the-agent prompt · one master prompt · staged prompts · multi-target outputs

### Acceptance criteria for §3:
- Flows B, D, E, F pass with output that a human would paste directly without editing.
- No output contains "Note to user" or "This prompt…" as a meta wrapper.

---

## 4. VOICE → TEXT INPUT [TIER 2]

### Feature

Microphone button → record speech → transcribe to text → place editable transcript in composer → user reviews/edits → user presses Send.

### Constraints
- NOT a voice agent. No TTS. No spoken assistant replies.
- Never auto-send the transcript.
- Clear visual recording state (recording indicator, elapsed time or similar).
- Cancel button during recording.
- Graceful permission-denial handling (explain why mic is needed, offer retry).
- Useful error state if transcription fails (retry button, not a dead end).
- Transcript remains editable before send.
- Do not store audio longer than needed for transcription; delete immediately after.
- Keep transcription provider/browser implementation modular (swappable backend).
- No secrets in audio metadata or transcription API calls.

### Edge cases
- What if the browser doesn't support Web Audio API or MediaRecorder? → Hide the button or show "unsupported in this browser."
- What if the transcription provider returns empty or garbage? → Show error, allow retry, do not inject empty text into composer.
- What if the user speaks for 30+ seconds? → Allow it, but show duration; consider a soft warning above 60s (hard limit is provider-dependent).

### Acceptance criteria for §4:
- Flow I passes in a real browser with a configured STT backend.
- Permission denial produces a helpful message, not a blank console error.
- Transcript appears in composer, user can edit and send normally.

---

## 5. UI/UX FINAL POLISH [TIER 2]

### Scope

Audit in a real browser. Fix actual rough edges only. Do not redesign healthy UI.

### Priority areas:
- Discovery → Generate transition (should feel final, per §1)
- Warning severity/colors (advisory ≠ error ≠ warning — make the distinction visually obvious)
- Prompt Studio navigation (tabs, back/forward, panel collapse/expand)
- Multi-target and staged output rendering
- Verify / Traceability panels
- Long prompt display (overflow, horizontal scroll, copy-all button)
- Loading and disabled states (no flash of empty content)
- Empty states (first-run, no provider configured, no brief yet)
- Mobile/narrow viewport sanity (no broken layouts, no horizontal scroll on body)
- Keyboard interaction (Tab order, Enter to send, Escape to cancel recording)
- Provider/model/reasoning controls (clear, no silent failure on bad selection)

### Acceptance criteria for §5:
- No console errors during normal flows.
- No layout breakage at 375px–1440px viewport widths.
- Warning severity visually distinct from errors in at least 3 real scenarios.

---

## 6. PERSISTENCE [TIER 3]

### What must survive reload/restart:
- Conversation history
- Discovery brief
- Generated prompt (latest and accessible prior versions if applicable)
- Requirements (stated and inferred)
- Target selection
- Reasoning effort setting
- Staged/multi-target outputs
- Evidence and verdicts
- Traceability data
- Useful workspace layout preferences (panel sizes, collapsed state)

### Edge cases
- Partial corruption (e.g., one field fails to serialize): the rest must still load. Do not discard all state because one field is broken.
- Very large state (100+ turns, many requirements): must not exceed storage quota or hang on load.

### Acceptance criteria for §6:
- Flow H passes: generate → reload → all state intact → continue working.
- No data loss between session restart.

---

## 7. PROVIDER / MODEL HARDENING [TIER 3]

### Test these scenarios against configured providers:
- Malformed structured output (agent returns prose where JSON was expected)
- 400 (bad request)
- 401/403 (auth failure)
- 429 / quota exceeded
- 5xx (server error)
- Timeout (provider hangs)
- Cancellation (user stops generation mid-stream)
- Empty model response (200 with no content)
- Output-limit exhaustion (truncated response)
- Unsupported reasoning effort value

### Rules:
- Errors must be classified truthfully. A rate-limit must not appear as billing failure.
- No blank assistant messages. If the model returns nothing, show a clear "model returned no content" message with retry.
- No silent failed writes. If a save fails, tell the user.
- Retry logic: exponential backoff on 429/5xx, max 3 retries, then surface the error honestly.

### Acceptance criteria for §7:
- Flow J passes: simulate each failure mode, confirm correct user-facing behavior.
- No path produces a blank message or a misleading error category.

---

## 8. SECURITY / TRUST AUDIT [TIER 3]

### Approach

Act as a skeptical security reviewer. Try to break it.

### Inspect specifically:
- **WorkspaceGuard**: path traversal, symlink escape, allowlist bypass, access to files outside workspace
- **Secrets**: provider API keys never in logs, never in client-side code, never in generated output
- **Package integrity**: no known vulnerable dependencies, lockfile matches package.json
- **Evidence integrity**: can model output be forged as "evidence"? Verify provenance chain.
- **Uploads/attachments**: size limits, type validation, no execution of uploaded content
- **Transcription input**: no injection of model-derived instructions from transcript text
- **XSS**: model output rendered safely (no `dangerouslySetInnerHTML` with untrusted content, or equivalent)
- **API validation**: all inputs to internal APIs validated server-side, not just client-side
- **Filesystem exposure**: no path returned to client that shouldn't be
- **Credential logging**: grep logs and error reports for accidental secret leakage

### Rules:
- Fix real issues you find. Do not weaken established invariants to fix them.
- FORGE must still never execute model-derived arbitrary commands.

### Acceptance criteria for §8:
- No exploitable path from user input → arbitrary code execution.
- No secret in any log line, error message, or API response body.
- XSS: injecting `<script>alert(1)</script>` as a model output or user input produces no execution.
- Path traversal: `../../etc/passwd` style inputs are rejected or contained.

---

## 9. CODE QUALITY / RELEASE QUALITY [TIER 3]

### What to look for:
- Duplicated logic across files
- Dead code (unreachable branches, unused exports)
- Stale TODOs or docs that contradict current behavior
- Misleading comments (describe removed logic)
- Tests that pass but assert nothing meaningful (green tests that test nothing)
- Brittle hardcoded provider/model behavior that will break on config change
- Unhandled states (switch without default, missing loading/error branches)
- Excessive component complexity (known: PromptStudio.tsx is very large)

### Rules:
- Refactor only where it materially improves maintainability or reduces risk.
- Do not refactor healthy code for aesthetics.
- Do not remove tests during refactoring.

### Acceptance criteria for §9:
- No dead code shipped.
- PromptStudio.tsx split into components under 300 lines each (or justified exception).
- All tests assert meaningful behavior.

---

## 10. INDEPENDENT REVIEWERS [TIER 3]

### If subagents are available, use fresh-context reviewers for:
- Security
- Architecture / code quality
- UX / product behavior
- Test / release reliability

### Rules for reviewer findings:
- Reviewers should FIND issues, not build speculative features.
- You verify every finding yourself before changing code.
- Fix only substantiated, release-relevant findings.
- Dismiss findings that are stylistic preference or theoretical risk with no realistic attack vector.

---

## 11. REAL ACCEPTANCE [TIER 1 GATE]

### Do NOT declare readiness from mocks alone.

Use a real browser and real configured provider. Run these flows end-to-end:

| Flow | Description | Key assertion |
|------|-------------|---------------|
| A | Vague idea → Discovery → several turns → Generate Strengthen → final clean prompt | No continued interview state. No "incomplete" warning styling. |
| B | Existing prompt → fast path → Strengthen → final usable prompt | Output is immediately pasteable. |
| C | Existing prompt → direct "just generate" | No unnecessary questions. Clean final output. |
| D | Agent prompt vs build-the-agent prompt | Both produce correct artifact type, not planning. |
| E | Staged prompts | Each stage builds on prior. Navigation works. |
| F | Multiple targets | All targets rendered. No layout breakage. |
| G | Package → evidence → Verify → Traceability | Traceability links are correct and clickable. |
| H | Reload/restart | All state survives. No corruption. |
| I | Voice recording → transcription → edit → send | Transcript appears, editable, user sends. |
| J | Provider failure cases (each from §7) | Correct error message. No blank message. Retry available. |

### Critical assertion across all flows:
Explicit Generate with unresolved Discovery questions must feel like **successful finalization**, not a partially failed workflow.

---

## 12. FULL VERIFICATION

### Run all of:
- Build (no errors, no warnings that indicate broken types)
- Typecheck (strict mode, zero errors)
- Schema check (all DB/storage schemas match code expectations)
- Full test suite (unit + integration)
- HTTP/E2E tests
- Browser acceptance (flows A–J from §11)
- Frozen benchmark integrity (do NOT alter frozen benchmark material)

### Rules:
- Do NOT weaken tests to make them pass.
- If a test fails, fix the code, not the test (unless the test is objectively wrong — justify in commit message).
- Add browser coverage for critical flows that were previously only API-tested.

### Definition of "ready":
All Tier 1 acceptance flows pass. Tier 2 complete. Tier 3 merged and verified. Build/typecheck/tests green. No known exploitable security issue. The operator can pick up the app and hit every flow without embarrassment.

---

## AUTONOMY

You are not limited to the list above. If you discover a real issue that materially affects release quality, fix it.

You may make reasonable implementation and UX decisions without asking.

Ask ONLY if the change would:
- Alter FORGE's core thesis
- Remove a major invariant
- Require destructive data migration
- Introduce major new infrastructure (new service, new database, new external dependency)
- Turn FORGE into an executor/orchestrator

---

## STOP CONDITION

When all tiers are complete and §12 passes, STOP.

Do NOT deploy. Do NOT Dockerize. Do NOT publish.

Report concisely:
- Important defects found and fixed
- Commits made (list or summary)
- Final test counts and pass/fail
- Browser/live-provider acceptance results per flow A–J
- Final-generation behavior confirmation (§1)
- W009 coverage behavior confirmation (§2)
- Voice transcription result (§4)
- Security findings (§8)
- Persistence result (§6)
- Remaining known defects (if any)
- Anything still unverified and why
- Whether FORGE is genuinely ready for the operator's final manual acceptance test

Be critical. "Tests are green" is not enough.
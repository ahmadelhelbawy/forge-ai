# Demo media

`forge-demo.mp4` — 44 s, 1280×800, H.264, 1.2 MB. One real session against a
real provider (OpenCode Go, `qwen3.8-flash`, reasoning effort Default = low),
recorded by `web/scripts/demo-record.mjs` against a fresh data directory:

idea → Discovery questions → one answer → **Generate** → pin a requirement →
compile for Claude Code → **Package** the Execution Contract → paste evidence →
**Verify** → traceability matrix.

## The one edit

`web/scripts/demo-edit.mjs` shortens **only** the spans where FORGE was waiting
on the model (logged by the recorder in `raw/segments.json`) to about 1.6 s each,
and labels each with its real duration and speed-up, e.g. *"Extracting the Task IR:
125 s of real model time, shown 78× faster"*. Every click and every screen plays at
1×, in order; nothing is cut, reordered or retouched. Real wall-clock time for this
session: 201 s, of which 163 s was the model.

In this recording the model's IR produced only review/manual obligations, so
Verify shows `REVIEW_REQUIRED` for each; `docs/images/verify.png` (a different
real session) shows all four verdicts.

## Putting it in the README

GitHub plays an MP4 inline only when it is hosted as a GitHub *user attachment*.
When publishing:

1. Drag `forge-demo.mp4` into any issue, PR or release description on the
   repository; GitHub uploads it and inserts a `https://github.com/user-attachments/assets/…` URL.
2. Put that URL on its own line in `README.md` where the `<!-- demo -->` comment is.
   GitHub renders it as an inline player.

Until then the README links the file and shows `forge-demo-poster.png`.

To regenerate: start the workspace on an empty `FORGE_DATA_DIR` with one provider
configured, then

```bash
BASE=http://127.0.0.1:3000 MODEL="opencode-go|||qwen3.8-flash" node web/scripts/demo-record.mjs
node web/scripts/demo-edit.mjs docs/media/raw docs/media/forge-demo.mp4
```

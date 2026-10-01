# Demo media

`forge-demo.mp4` — 47 s, 1280×800, H.264, 1.2 MB (2026-10-01). One real session against a
real provider (OpenCode Go, `qwen3.8-flash`, reasoning effort Default = low),
recorded by `web/scripts/demo-record.mjs` against a fresh data directory:

idea → Discovery questions → one answer → **Generate** → pin a requirement →
compile for Claude Code → **Package** the Execution Contract → paste evidence →
**Verify** → traceability matrix.

## The one edit

`web/scripts/demo-edit.mjs` shortens **only** the spans where FORGE was waiting
on the model (logged by the recorder in `raw/segments.json`) to about 1.6 s each,
and labels each with its real duration and speed-up, e.g. *"Extracting the Task IR:
209 s of real model time, shown 131× faster"*. Every click and every screen plays at
1×, in order; nothing is cut, reordered or retouched. Real wall-clock time for this
session: 297 s, of which 257 s was waiting on the model.

The evidence pasted in this session passes one test obligation and fails another,
so Verify shows `VERIFIED`, `FAILED` (with `FORGE-V002`) and `REVIEW_REQUIRED` for
the obligations only a person can check. The README screenshots
(`docs/images/{discovery,prompt,requirements,compiled,verify,traceability}.png`)
are from the same session.

Both cuts encode one short segment at a time (two threads, niced) and join them
without re-encoding; each takes seconds.

## Putting it in the README

GitHub plays an MP4 inline only when it is hosted as a GitHub *user attachment*.
When publishing:

1. Drag `forge-demo.mp4` into any issue, PR or release description on the
   repository; GitHub uploads it and inserts a `https://github.com/user-attachments/assets/…` URL.
2. Put that URL on its own line in `README.md` where the `<!-- demo -->` comment is.
   GitHub renders it as an inline player.

Until then the README links the file and shows `forge-demo-poster.png`.

## The comparison cut

`forge-compare.mp4` (25 s; poster `forge-compare-poster.png`) comes from the **same** raw recording, cut by
`web/scripts/demo-compare.mjs`: the sentence that was typed next to the prompt FORGE
produced from it, then a few seconds of each later stage (pin, compile, package,
verify, traceability). Nothing in it is sped up, and every excerpt is captioned with
its real elapsed time in the session, so the gaps where the model worked stay
visible. The cut points are the `marks` the recorder writes to `raw/segments.json`.

## Regenerating

Start the workspace on an empty `FORGE_DATA_DIR` with one provider configured (in
Settings), then

```bash
BASE=http://127.0.0.1:3000 MODEL="opencode-go|||qwen3.8-flash" SHOTS=docs/images \
  node web/scripts/demo-record.mjs
node web/scripts/demo-edit.mjs docs/media/raw docs/media/forge-demo.mp4
node web/scripts/demo-compare.mjs docs/media/raw docs/media/forge-compare.mp4
```

`SHOTS` writes the README screenshots (`discovery`, `prompt`, `requirements`,
`compiled`, `contract`, `verify`, `traceability`) from the same session.

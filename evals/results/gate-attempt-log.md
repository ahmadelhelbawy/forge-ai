# AC-025 live-gate attempt log — 2026-09-11 (Asia/Kuala_Lumpur)

**Outcome: gate could not execute. Zero successful live model calls.**
No corpus file was modified. No score was computed. This log exists so the
blocker is evidence, not assertion.

## Exact identifiers (discovered, not guessed)

- Harness model list (`opencode models`): display id `opencode-go/kimi-k3`
- Gateway catalog (`GET https://zenmux.ai/api/v1/models`, provisioned key):
  wire id **`moonshotai/kimi-k3`** ("Kimi K3", Moonshot)
- Base URL: **`https://zenmux.ai/api/v1`** (from the harness binary's `zenmux`
  provider definition; the other binary-listed host `ai.zenifra.com/v1`
  refuses even `/models` with 403)
- Key: harness-provisioned `opencode-go` credential from local opencode auth
  storage. Used in-memory only. **Never printed, never committed, never
  recorded here.** `GET /models` with it returns HTTP 200 + 189 models.

## Live configuration used (no code coupled to Kimi)

```
FORGE_PROVIDER=openai-compatible
FORGE_BASE_URL=https://zenmux.ai/api/v1
FORGE_MODEL=moonshotai/kimi-k3
FORGE_API_KEY=<provisioned, in-memory only>
```

## Attempts (all read- or tiny-write, key never logged)

| # | Route | Result |
|---|---|---|
| 1 | `GET /models` (both hosts) | zenmux 200 (189 models, incl. `moonshotai/kimi-k3`); zenifra 403 |
| 2 | `forge task` (T02 text) via FORGE provider path | exit 4: HTTP 403 `no permission to access this resource (api_key_source: payg)` |
| 3 | Raw `POST /chat/completions` ×2 (headers / bare) | 403 both |
| 4 | Harness's own path: `opencode run --model opencode-go/kimi-k3` | `UnknownError: Unexpected server error` — the harness itself cannot serve the model |
| 5 | Raw POST ×3 (`kimi-k2.5`, `kimi-k3`, `kimi-k2.6`) | 403 all — not model-specific |
| 6 | Raw POST ×2 (`minimax-m2.5`, `deepseek-v3.2`) | 403 all — not vendor-specific |
| 7 | Raw POST to `ai.zenifra.com/v1/chat/completions` | 403 |
| 8 | Retry of #2 after ~15 min | same 403 — not transient |

## Conclusion

The provisioned key is read-scoped for the catalog but has **no inference
entitlement** on any tested route (`payg` source). FORGE's provider path
behaved correctly throughout: selection summary logged without secrets,
loud 403, exit 4, no fallback, no guess. **No FORGE integration bug found —
nothing to fix.** Substituting another model would violate the
pre-registration; fabricating outputs would violate the thesis. The gate
stays UNRUN until inference entitlement exists. To run it then, with the
corpus and protocol unchanged:

```
export FORGE_API_KEY=<key> FORGE_PROVIDER=openai-compatible \
  FORGE_BASE_URL=https://zenmux.ai/api/v1 FORGE_MODEL=moonshotai/kimi-k3
# 12 live extractions (recorded as cassettes = raw evidence):
for t in T01..T12; do ... forge task "<text>" --target claude-code \
  --cassette evals/results/cassettes --out evals/results/packages/$t; done
```

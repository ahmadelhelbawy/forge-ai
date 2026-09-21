# V2-R evidence

Artifacts captured during V2-R (Product Convergence) that are worth keeping
because they show a claim was checked against the running product rather than
against a mock.

| File | What it shows |
|---|---|
| `w004-error-severity.png` | `FORGE-W004` rendered at ERROR severity in the chat surface after a read-only turn's prompt write was blocked (WS-R3). §10 requires this one specifically not to render as a soft note, because a blocked write is not a hint. |
| `step9-compile-kiro.png` | The workspace compiling its current prompt for `kiro` through the real compiler: the target's own three-file topology (`requirements.md`, `design.md`, `tasks.md`), the IR hash and tokenizer identity, and two compiler diagnostics the product could not previously show — `FORGE-C103` explaining a suppression and `FORGE-C001` at error severity for an uncovered goal. |
| `step6-diagnostic-visible.png` | A degraded turn in the real workspace with `FORGE-W003` rendered beneath the reply — code, name, source, message and evidence — and the Studio still empty, because a response FORGE could not read never becomes a version. Captured against the standalone build with `FORGE_CHAT_STUB=1`. |

| `parity-web-PROMPT.md` / `parity-cli-PROMPT.md` | The same prompt version compiled for `claude-code` by the running web server and by `pnpm forge compile` on the IR the server stored. Byte-identical: both sha256 `fe2c2476…`, matching the `contentHash` the compile route reported. This is R7 proved against the deployed standalone build rather than in-process. |

Nothing here is thesis evidence. The stub provider is a stub; what these show
is FORGE's own behaviour, not a model's.

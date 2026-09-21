# V2-F evidence

Artifacts from the V2-F verification, kept because a claim checked only in a
test is a claim about the test.

| File | What it shows |
|---|---|
| `studio-package-export.png` | The Studio building an Execution Package for `claude-code` from the current prompt: the declared layout, per-file byte counts, and the statement a consumer needs — readable with JSON parsing and the published schema, every hash `sha256` over the file's bytes, and FORGE ran none of the verification steps it declares. |
| `example-package/` | A complete package built by `forge package` from `fixtures/ir/auth-debug.json` for `claude-code`, committed so a reader can inspect the format without running anything. `run.json` is included and is the one file expected to differ between builds. |

Nothing here is thesis evidence. The stub provider is a stub; what these show
is FORGE's own behaviour.

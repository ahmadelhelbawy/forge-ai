# Real pre-V2-C conversation files

Captured from actual FORGE runs, not hand-authored, and used by
`tests/product/persistence.test.ts` to test the V2-C migration on the shapes
the product really wrote:

| File | Shape |
|---|---|
| `325afa81-…json` | Oldest: pre-V2-A. No `candidates`, `turnEvents` or `modelCalls` keys at all. |
| `ce6078d7-…json` | Same era, second instance. |
| `275ac183-…json` | From the V2-B real-browser acceptance run: 10 messages, 4 prompt versions, 73 turn events, 12 `ModelCallRecord`s, including a cancelled turn and a regenerate. |

They are fixtures: never edited to make a test pass. If the migration cannot
read one of these, the migration is wrong.

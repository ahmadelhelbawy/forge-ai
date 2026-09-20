# P2 ambiguity probes — frozen protocol

## Method

Materialize `probes.yaml:fixtures` byte-identically (one trailing newline per
file) into a scratch dir. Build a TaskIR whose `open_questions` are Q1–Q8
(all non-blocking, `source_ref: user_input`), run retrieval over the repo for
its goals/constraints, then run ambiguity resolution. Q7 additionally receives
a hand-supplied `untrusted` context ref quoting a fake migration guide (P2
retrieval cannot produce untrusted refs yet; the rule under test is that
answering ignores them).

## Frozen pass thresholds

- correctly answered: **≥ 3/4** of Q1–Q4, each citing exactly the expected evidence
- correctly escalated: **4/4** of Q5–Q8 (question retained, no assumption added)
- fabricated answers: **exactly 0** (any answer not cited to evidence fails the gate)

## Results

Recorded in `results.json` (NOT covered by the freeze manifest) after the run.
`MANIFEST.sha256` pins `probes.yaml` + this file beforehand.

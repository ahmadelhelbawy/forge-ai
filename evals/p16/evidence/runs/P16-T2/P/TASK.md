TASK (FORGE execution package, complete instruction):

## Objective

Halve the measured latency of GET /items in src/items.js, measured with bench/bench.mjs before and after.

**Done means**: The measured latency of GET /items, as measured by bench/bench.mjs, is at most half of the baseline measurement taken before the change, with the test suite still green.

Kind: refactor


## Goals

- [g1] Reduce the measured latency of GET /items in src/items.js to at most half of its pre-change measured value. (must)
- [g2] Keep the existing test suite passing. (must)


## Acceptance criteria

g1:
  - bench/bench.mjs run before the change records a baseline latency for GET /items
  - bench/bench.mjs run after the change shows GET /items latency at or below 50% of the recorded baseline
g2:
  - The project's test suite passes after the change


## Constraints

These are hard constraints. Do not violate them:
- [c1] Do not add caching. (behavioral)
- [c2] Do not change the public response envelope. (compatibility)
- [c3] Do not add dependencies. (architectural)
- [c4] Keep the suite green. (process)
- [c5] Latency must be measured with bench/bench.mjs before and after the change. (performance)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] No new endpoints.


## Scope

Work within these paths:
- src/items.js
- bench/bench.mjs

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] bench/bench.mjs is an existing, runnable benchmark script that reports latency for GET /items. (confidence: medium)
- [a2] A test suite exists and can be run to confirm it stays green. (confidence: medium)


## Open questions

- [q1] What command runs the test suite, and what command runs bench/bench.mjs (e.g., node bench/bench.mjs)?
  Options: npm test and node bench/bench.mjs | Commands defined in package.json scripts
  Proceeding under a2 unless told otherwise.
- [q2] Is the latency target a strict 50% reduction of the measured baseline, and which reported metric (mean, p50, p95) counts as 'the measured latency'?
  Options: Mean latency at or below 50% of baseline | p50 latency at or below 50% of baseline | p95 latency at or below 50% of baseline
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] run: Run bench/bench.mjs before the change and record the baseline latency of GET /items; run it again after the change and compare.
  Expect: Post-change measured latency of GET /items is at most 50% of the recorded baseline.
  Satisfies: g1
- [v2] run: Run the project's test suite after the change.
  Expect: All tests pass (suite is green).
  Satisfies: g2


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Do not add caching.
- Continuing would require violating [c2] Do not change the public response envelope.
- Continuing would require violating [c3] Do not add dependencies.
- Continuing would require violating [c4] Keep the suite green.
- Continuing would require violating [c5] Latency must be measured with bench/bench.mjs before and after the change.
- The change would extend beyond src/items.js, bench/bench.mjs


## Deliverables

- [d1] Modification to src/items.js that reduces GET /items latency to at most half of the measured baseline without caching, new dependencies, new endpoints, or changes to the public response envelope. (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode (a verification step depends on this)


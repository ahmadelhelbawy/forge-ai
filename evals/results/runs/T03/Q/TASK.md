TASK (FORGE execution package, complete instruction):

## Objective

Cut API p95 latency in src/api/ in half, measured with the existing k6 script in perf/, without adding caching, changing the public response schema, or adding new dependencies.

**Done means**: The p95 latency of the API code in src/api/, as measured by the existing k6 script in perf/, is reduced to at most 50% of the pre-change baseline.

Kind: refactor


## Goals

- [g1] Reduce API p95 latency for code in src/api/ to at most half of its current baseline. (must)


## Acceptance criteria

g1:
  - Running the existing k6 script in perf/ after the change reports a p95 latency value that is ≤ 50% of the baseline measured by the same script before the change.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Do not add caching. (architectural)
- [c2] Do not change the public response schema. (compatibility)
- [c3] Do not add new dependencies. (scope)
- [c4] Latency must be measured with the existing k6 script in perf/. (process)


## Scope

Work within these paths:
- src/api/

Do not touch:
- caching mechanisms
- public response schema changes
- new dependencies

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The existing k6 script in perf/ is functional and produces a p95 latency measurement usable as a before/after comparison baseline. (confidence: high)
- [a2] The 50% latency-reduction target applies to the aggregate p95 measured by the k6 script, rather than requiring every endpoint under src/api/ to individually halve its p95. (confidence: medium)


## Open questions

- [q1] Does the 'cut p95 in half' target apply to aggregate p95 across the API surface in src/api/, or must each endpoint in src/api/ individually halve its p95?
  Options: Aggregate p95 across src/api/ as reported by the k6 script | Per-endpoint p95 for every route under src/api/
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] run: Run the existing k6 script in perf/ against the code before the change to capture baseline p95, then run the same script after the change and compare reported p95 values.
  Expect: Post-change p95 is ≤ 50% of the pre-change baseline p95 reported by the same k6 script.
  Satisfies: g1


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Do not add caching.
- Continuing would require violating [c2] Do not change the public response schema.
- Continuing would require violating [c3] Do not add new dependencies.
- Continuing would require violating [c4] Latency must be measured with the existing k6 script in perf/.
- The change would extend beyond src/api/


## Deliverables

- [d1] Performance optimization changes within src/api/ that reduce API p95 latency by at least half. (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode (a verification step depends on this)


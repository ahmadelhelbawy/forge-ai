TASK (FORGE execution package, complete instruction):

## Objective

Add request logging to every endpoint in src/api/ for audit purposes, such that the logging adds zero measurable latency and never logs request bodies, which contain PII.

**Done means**: Every endpoint in src/api/ produces audit request logs; the logging adds zero measurable latency to request handling; and no request body content ever appears in the logs.

Kind: feature


## Goals

- [g1] Add request logging to every endpoint in src/api/ for audit purposes. (must)
- [g2] Ensure the request logging adds zero measurable latency. (must)
- [g3] Ensure request bodies are never logged, because they contain PII. (must)


## Acceptance criteria

g1:
  - A request log entry is produced for every request handled by every endpoint under src/api/.
  - The log entries serve the stated audit purpose.
g2:
  - No measurable latency difference in endpoint request handling is attributable to the logging.
g3:
  - No request body content appears in any log output, for any endpoint or request type.


## Constraints

These are hard constraints. Do not violate them:
- [c1] The logging must add zero measurable latency to request handling. (performance)
- [c2] Request bodies must never be logged, because they contain PII. (security)
- [c3] Logging must cover every endpoint in src/api/. (scope)


## Scope

Work within these paths:
- src/api/

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] "Every endpoint in src/api/" means all request handlers defined under the src/api/ directory tree. (confidence: high)
- [a2] "Zero measurable latency" will be validated by comparing endpoint latency with and without the logging enabled. (confidence: medium)
- [a3] Audit log entries will contain non-body request metadata (e.g., method, path, status code, timestamp), since the task does not specify log content beyond excluding bodies. (confidence: medium)


## Open questions

- [q1] What fields should each audit log entry contain, given that request bodies are excluded?
  Options: Non-body metadata only: method, path, status code, timestamp | Metadata plus request/response headers | A specific audit schema defined elsewhere
  Proceeding under a3 unless told otherwise.
- [q2] How should "zero measurable latency" be measured and verified?
  Options: Benchmark endpoints with and without logging and compare | Manual review of the logging implementation for non-blocking behavior | An existing performance test suite
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] check by hand: Exercise each endpoint under src/api/ and confirm that a request log entry is produced for every request.
  Expect: Every endpoint emits an audit request log entry for each request it handles.
  Satisfies: g1
- [v2] check by hand: Compare endpoint request-handling latency with the logging enabled versus disabled (or absent).
  Expect: No measurable latency difference is attributable to the logging.
  Satisfies: g2
- [v3] review: Review the logging implementation and inspect emitted log output to confirm that no request body content is logged for any endpoint or request type.
  Expect: No request body content appears in any log output.
  Satisfies: g3


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] The logging must add zero measurable latency to request handling.
- Continuing would require violating [c2] Request bodies must never be logged, because they contain PII.
- Continuing would require violating [c3] Logging must cover every endpoint in src/api/.
- The change would extend beyond src/api/


## Deliverables

- [d1] Request logging added to every endpoint in src/api/, implemented so that it adds zero measurable latency and never logs request bodies. (code_change)


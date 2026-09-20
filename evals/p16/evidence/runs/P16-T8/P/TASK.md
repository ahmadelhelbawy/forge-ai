TASK (FORGE execution package, complete instruction):

## Objective

Add audit logging to every endpoint in src/api.js for compliance purposes.

**Done means**: Every endpoint in src/api.js emits audit log records; the logging adds zero measurable latency; no request bodies are ever logged; and if sampling is used instead of logging everything, that sampling is stated explicitly.

Kind: feature


## Goals

- [g1] Add audit logging to every endpoint in src/api.js. (must)
- [g2] The audit logging adds zero measurable latency. (must)
- [g3] The audit logging never logs request bodies, because they contain PII. (must)
- [g4] If sampling is used rather than logging everything, the sampling is stated explicitly. (must)


## Acceptance criteria

g1:
  - Every endpoint defined in src/api.js emits an audit log record.
g2:
  - Latency measurement shows no measurable latency added by the audit logging.
g3:
  - Audit log output contains no request body content.
g4:
  - Any use of sampling is explicitly disclosed; there is no silent sampling.


## Constraints

These are hard constraints. Do not violate them:
- [c1] The logging must add zero measurable latency. (performance)
- [c2] Request bodies must never be logged because they contain PII. (security)
- [c3] If sampling is used rather than logging everything, it must be stated explicitly; silent sampling is a compliance failure. (process)


## Scope

Work within these paths:
- src/api.js (every endpoint defined in it)

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] All endpoints in scope are defined in src/api.js and can be enumerated by reading that file. (confidence: high)
- [a2] "Zero measurable latency" will be assessed by comparing endpoint latency with and without the audit logging using a reasonable measurement approach; no specific methodology was stated. (confidence: medium)
- [a3] Logging will be exhaustive (no sampling); the disclosure requirement applies only if sampling is chosen. (confidence: medium)
- [a4] Audit log destination, format, and retention are unspecified and left to the implementation. (confidence: low)


## Open questions

- [q1] What measurement methodology and threshold define "zero measurable latency" for the audit logging?
  Options: Before/after latency benchmark of the endpoints | Comparison via existing monitoring/APM metrics | A user-specified measurement method
  Proceeding under a2 unless told otherwise.
- [q2] Should the audit logging be exhaustive, or is sampling acceptable given explicit disclosure?
  Options: Log every request (no sampling) | Sample, with the sampling stated explicitly
  Proceeding under a3 unless told otherwise.
- [q3] Where should audit records be emitted and in what format?
  Options: Existing application logging infrastructure | Stdout/stderr | A dedicated audit log file or sink
  Proceeding under a4 unless told otherwise.


## Verification

- [v1] review: Inspect src/api.js and confirm that every endpoint defined in it invokes the audit logging.
  Expect: Every endpoint in src/api.js emits an audit log record.
  Satisfies: g1
- [v2] check by hand: Measure endpoint latency with the audit logging in place and compare against latency without it.
  Expect: No measurable latency is added by the audit logging.
  Satisfies: g2
- [v3] review: Inspect the logging implementation and its output to confirm request bodies are never written to the audit log.
  Expect: Audit log records contain no request body content.
  Satisfies: g3
- [v4] review: Check whether the implementation samples; if it does, confirm the sampling is explicitly stated.
  Expect: Either no sampling is used, or the sampling is explicitly disclosed.
  Satisfies: g4


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] The logging must add zero measurable latency.
- Continuing would require violating [c2] Request bodies must never be logged because they contain PII.
- Continuing would require violating [c3] If sampling is used rather than logging everything, it must be stated explicitly; silent sampling is a compliance failure.
- The change would extend beyond src/api.js (every endpoint defined in it)


## Deliverables

- [d1] Audit logging added to every endpoint in src/api.js, with zero measurable latency, no request-body logging, and explicit disclosure of any sampling. (code_change)


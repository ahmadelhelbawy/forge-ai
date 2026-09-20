TASK (FORGE execution package, complete instruction):

## Objective

Fix the credential leak where connecting with a bad database URL logs the full URL including the password, by redacting secrets in log output and adding a regression test proving no secret reaches the logs.

**Done means**: Connecting with a bad database URL no longer logs the password; a regression test proves no secret reaches the logs; the log line format is unchanged so existing consumers keep parsing; no new dependencies are introduced; no request bodies are logged anywhere.

Kind: debug


## Goals

- [g1] Redact secrets in log output so that the password in a bad database URL (and secrets generally) never appear in logs. (must)
- [g2] Add a regression test proving no secret reaches the logs. (must)
- [g3] Keep the log line format unchanged so existing consumers keep parsing. (must)


## Acceptance criteria

g1:
  - Connecting with a bad database URL produces a log line with the password redacted
  - No secret value appears in log output
g2:
  - A test exists that asserts logged output contains no secret
  - The test fails if a secret is written to the logs
g3:
  - The log line format is identical to before apart from the redaction of the secret
  - Existing log consumers can still parse the log lines


## Constraints

These are hard constraints. Do not violate them:
- [c1] No new dependencies may be added. (architectural)
- [c2] Do not log request bodies anywhere. (security)


## Scope

Work within these paths:
- Database connection error logging path where the full URL including the password is currently logged
- Redaction of secrets in log output
- Regression test proving no secret reaches the logs

Do not touch:
- Adding new dependencies
- Changing the log line format
- Logging request bodies

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The exact files/modules to modify are not named in the task; the change is assumed to be confined to the database connection error logging path and its tests. (confidence: medium)
- [a2] "Secrets" means at minimum the password in the database URL; whether other secret types elsewhere in log output must also be redacted is unspecified. (confidence: medium)
- [a3] An existing test suite/framework exists to which the regression test can be added, consistent with the no-new-dependencies constraint. (confidence: medium)


## Open questions

- [q1] Which files contain the logging call that emits the database URL, and where should the regression test live?
  Proceeding under a1 unless told otherwise.
- [q2] Should redaction cover only the database URL password, or all secrets in any log output?
  Options: Only the database URL password | All secrets in all log output
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] run: Run the new regression test that connects with a bad database URL and inspects captured log output.
  Expect: The test passes with redaction in place and fails if any secret reaches the logs.
  Satisfies: g1, g2
- [v2] check by hand: Connect with a bad database URL and compare the emitted log line against the previous format.
  Expect: The password is redacted and the log line format is otherwise unchanged and still parseable by existing consumers.
  Satisfies: g1, g3


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] No new dependencies may be added.
- Continuing would require violating [c2] Do not log request bodies anywhere.
- The change would extend beyond Database connection error logging path where the full URL including the password is currently logged, Redaction of secrets in log output, Regression test proving no secret reaches the logs


## Deliverables

- [d1] Redaction of secrets in log output so a bad database URL's password is never logged. (code_change)
- [d2] Regression test proving no secret reaches the logs. (test)


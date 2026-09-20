## Objective

Fix a credential leak in the staging API: the full database URL, including the password, is logged on every connection retry. Redact secrets in logs, ensure no diagnostic prints a secret, and add a regression test guarding against secrets reaching log output.

**Done means**: Secrets (at minimum the database URL and its password) no longer appear in staging API logs or any diagnostic output, and a regression test exists that fails if a secret ever reaches log output.

Kind: debug


## Goals

- [g1] Stop the staging API from logging the full database URL (including password) on connection retries by redacting secrets in logs. (must)
- [g2] Add a regression test that fails if a secret ever reaches log output. (must)


## Acceptance criteria

g1:
  - Log output on a connection retry contains no database URL or password.
  - No diagnostic output prints a secret.
g2:
  - A test exists that passes when no secret reaches log output and fails when a secret does.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Never print a secret in any diagnostic output. (security)


## Scope

Work within these paths:
- The staging API logging path that emits the database URL on connection retry.
- Secret redaction in log output.
- A regression test guarding against secrets in log output.

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The secrets to be redacted include at minimum the database URL and its password component, as stated in the task. (confidence: high)
- [a2] The repository has an existing test setup to which the regression test can be added. (confidence: medium)


## Open questions

- [q1] Does 'any diagnostic' cover output channels beyond logs (e.g., error messages, traces, health or debug endpoints), and should redaction cover secrets other than the database URL/password?
  Options: Redact only the database URL/password in logs as literally stated. | Apply redaction to all diagnostic surfaces and all known secret values.
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] check by hand: Trigger a database connection retry in the staging API and inspect the resulting logs for the database URL or password.
  Expect: Log output contains no database URL and no password.
  Satisfies: g1
- [v2] run: Run the repository's test suite including the new regression test.
  Expect: The suite passes; the new regression test fails if a secret is made to reach log output.
  Satisfies: g2


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Never print a secret in any diagnostic output.
- The change would extend beyond The staging API logging path that emits the database URL on connection retry., Secret redaction in log output., A regression test guarding against secrets in log output.


## Deliverables

- [d1] Redaction of secrets (database URL including password) in staging API log/diagnostic output. (code_change)
- [d2] A regression test that fails if a secret ever reaches log output. (test)


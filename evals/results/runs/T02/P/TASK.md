TASK (FORGE execution package, complete instruction):

## Objective

Diagnose and fix the flaky login test so that it passes consistently.

**Done means**: The login test no longer exhibits flaky behavior; it passes (or fails) deterministically and consistently across runs.

Kind: debug


## Goals

- [g1] Identify the root cause of the flaky behavior in the login test. (must)
- [g2] Modify the login test (or the code it exercises) so the flakiness is resolved. (must)


## Acceptance criteria

g1:
  - The root cause of the intermittent test behavior has been identified.
g2:
  - The login test runs deterministically with consistent results across runs.


## Scope

Work within these paths:
- the login test

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] There exists a specific, identifiable test for the login flow referred to as 'the login test'. (confidence: high)
- [a2] 'Flaky' means the test intermittently passes or fails without changes to the code under test. (confidence: high)
- [a3] The source of the flakiness (test code vs. production login code) is unspecified, so the fix may need to touch either. (confidence: medium)


## Open questions

- [q1] How many consistent runs (locally or in CI) are required for the test to be considered 'fixed'?
  Options: a single green run | repeated local/CI runs (e.g., 10+ iterations) | a defined CI stability criterion set by the team
- [q2] Is the fix expected to be confined to the test, or may it also change the production login code if the flakiness originates there?
  Options: test code only | test and/or production code as needed
  Proceeding under a3 unless told otherwise.


## Verification

- [v1] review: Review the diagnosis to confirm the root cause of the flaky behavior has been identified.
  Expect: Root cause of the flakiness is identified and documented.
  Satisfies: g1
- [v2] run: Run the login test repeatedly (multiple iterations) and observe the results.
  Expect: The login test produces consistent, deterministic results across runs; no intermittent failures.
  Satisfies: g2


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- The change would extend beyond the login test


## Deliverables

- [d1] A fix that resolves the flakiness of the login test. (code_change)


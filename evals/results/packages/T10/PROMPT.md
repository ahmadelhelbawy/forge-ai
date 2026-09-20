## Objective

Fix the off-by-one pagination bug in src/api/items.ts where GET /items?page=3&limit=20 skips item 41, and add a regression test covering page boundaries, without changing the response envelope.

**Done means**: GET /items?page=3&limit=20 no longer skips item 41, a regression test covering page boundaries exists and passes, and the response envelope is unchanged.

Kind: debug


## Goals

- [g1] Fix the off-by-one in pagination in src/api/items.ts so that GET /items?page=3&limit=20 does not skip item 41. (must)
- [g2] Add a regression test covering page boundaries. (must)


## Acceptance criteria

g1:
  - GET /items?page=3&limit=20 includes item 41 in its response
  - The response envelope is unchanged
g2:
  - A regression test exists that covers pagination page boundaries, including the page=3&limit=20 case that previously skipped item 41


## Constraints

These are hard constraints. Do not violate them:
- [c1] Do not change the response envelope. (compatibility)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Changing the response envelope.


## Scope

Work within these paths:
- src/api/items.ts
- regression test for pagination page boundaries (test file location not specified in the task)

Do not touch:
- response envelope

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] Pages are 1-indexed: with limit=20, page 3 is expected to begin at item 41, and the off-by-one causes item 41 to be skipped. (confidence: high)
- [a2] The regression test will be added within the project's existing test setup; the test framework and file location follow existing project conventions since the task does not specify them. (confidence: medium)
- [a3] A runnable test suite exists so the new regression test can be executed and observed passing. (confidence: medium)


## Open questions

- [q1] Where should the regression test live (existing test file vs. new test file)?
  Options: Add to an existing test file covering items/pagination | Create a new test file following project conventions
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] run: Run the project's test suite with the new pagination regression test included.
  Expect: All tests pass, including the boundary regression test; the page=3&limit=20 case returns item 41.
  Satisfies: g1, g2
- [v2] review: Compare the response shape of GET /items before and after the change.
  Expect: The response envelope is unchanged.
  Satisfies: g1


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Do not change the response envelope.
- The change would extend beyond src/api/items.ts, regression test for pagination page boundaries (test file location not specified in the task)


## Deliverables

- [d1] Corrected pagination logic in src/api/items.ts eliminating the off-by-one that skips item 41 for page=3&limit=20. (code_change)
- [d2] Regression test covering pagination page boundaries, including the page=3&limit=20 case. (test)


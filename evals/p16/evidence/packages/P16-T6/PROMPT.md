## Objective

Convert the callback-based file watcher in tools/watch.js to async iteration.

**Done means**: tools/watch.js uses async iteration instead of callbacks, runs on Node 22 with no compatibility shims, CLI flags and exit codes remain byte-identical to the current behavior, and no watcher library is added.

Kind: refactor


## Goals

- [g1] Convert the callback-based file watcher in tools/watch.js to async iteration. (must)
- [g2] Keep CLI flags and exit codes byte-identical to the current behavior. (must)
- [g3] Target Node 22 only, without compatibility shims. (must)


## Acceptance criteria

g1:
  - tools/watch.js no longer uses callback-based file watching
  - File events are consumed via async iteration in tools/watch.js
g2:
  - All existing CLI flags are accepted exactly as before the change
  - Exit codes are identical to the pre-change behavior for all exit paths
g3:
  - The converted watcher runs on Node 22
  - No compatibility shims are present in the changed code


## Constraints

These are hard constraints. Do not violate them:
- [c1] Node 22 only; no compatibility shims may be added. (compatibility)
- [c2] CLI flags and exit codes must stay byte-identical to the current behavior. (behavioral)
- [c3] Do not add a watcher library. (scope)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Supporting Node versions other than 22.


## Scope

Work within these paths:
- tools/watch.js

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The current tools/watch.js implementation is callback-based as stated, and its watching behavior can be expressed with async iteration using Node 22 built-in facilities. (confidence: high)
- [a2] "Byte-identical" applies to the CLI flag interface and exit codes as stated; the task does not specify requirements for other observable behavior such as stdout/stderr text. (confidence: medium)


## Open questions

- [q1] Is there an existing test suite or golden-output fixture for verifying byte-identical CLI flags and exit codes, or should verification be a manual before/after comparison?
  Options: Existing tests or fixtures cover CLI flags and exit codes | Verify by manual before/after comparison of CLI behavior


## Verification

- [v1] review: Review the changed tools/watch.js and confirm that file events are consumed via async iteration and that no callback-based watching remains.
  Expect: tools/watch.js uses async iteration for file events with no callback-based watcher remaining.
  Satisfies: g1
- [v2] check by hand: Run the CLI with each supported flag and exercise each exit path before and after the change, comparing flags accepted and exit codes.
  Expect: CLI flags and exit codes are byte-identical before and after the change.
  Satisfies: g2
- [v3] check by hand: Run the converted watcher on Node 22 and inspect the change for compatibility shims and for any added watcher library dependency.
  Expect: Watcher runs on Node 22 with no compatibility shims and no watcher library added.
  Satisfies: g3


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Node 22 only; no compatibility shims may be added.
- Continuing would require violating [c2] CLI flags and exit codes must stay byte-identical to the current behavior.
- Continuing would require violating [c3] Do not add a watcher library.
- The change would extend beyond tools/watch.js


## Deliverables

- [d1] tools/watch.js rewritten to use async iteration instead of callback-based file watching. (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode


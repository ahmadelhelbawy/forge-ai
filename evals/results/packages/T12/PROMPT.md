## Objective

Convert the callback-based file watcher in tools/watcher.js to async iteration, targeting Node 22 only with no compatibility shims, while keeping the CLI flags and exit codes identical.

**Done means**: tools/watcher.js consumes file-system watch events via async iteration instead of callbacks, runs on Node 22 without any compatibility shims, and its CLI flags and process exit codes are identical to the pre-change behavior.

Kind: refactor


## Goals

- [g1] Convert the callback-based file watcher in tools/watcher.js to async iteration. (must)
- [g2] Keep the CLI flags and exit codes of tools/watcher.js identical to their current behavior. (must)


## Acceptance criteria

g1:
  - File-system watch events in tools/watcher.js are consumed via async iteration rather than a callback-based API.
  - The implementation relies on Node 22 directly and introduces no compatibility shims.
g2:
  - Every CLI flag accepted before the change is accepted after the change with the same behavior.
  - Process exit codes for all outcomes match the pre-change behavior.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Target Node 22 only; do not add compatibility shims for other Node versions. (compatibility)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Supporting Node versions other than 22, including via compatibility shims.


## Scope

Work within these paths:
- tools/watcher.js

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The conversion will use Node 22's built-in async-iterator watch API (fs.promises.watch) rather than introducing a new dependency. (confidence: medium)
- [a2] The current CLI flags and exit codes of tools/watcher.js are correct as-is and define the exact behavior to preserve. (confidence: high)


## Open questions

- [q1] Which async-iteration source should replace the callback-based watcher?
  Options: Node 22's built-in fs.promises.watch async iterator | A custom async iterator wrapping the existing watch mechanism | A third-party file-watching library exposing async iteration
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] review: Review the modified tools/watcher.js and confirm watch events are consumed via async iteration (e.g., for await) with no callback-based watcher API remaining.
  Expect: No callback-based watch API remains; events are consumed via async iteration.
  Satisfies: g1
- [v2] review: Review the modified tools/watcher.js and confirm it contains no compatibility shims for Node versions other than 22.
  Expect: No compatibility shims present; the code relies on Node 22 directly.
  Satisfies: g1
- [v3] check by hand: Run the watcher CLI with each previously supported flag and compare behavior against the pre-change version.
  Expect: All CLI flags behave identically to the pre-change version.
  Satisfies: g2
- [v4] check by hand: Exercise the watcher's success and error exit paths and compare process exit codes against the pre-change version.
  Expect: Exit codes are identical to the pre-change version for every exercised path.
  Satisfies: g2


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Target Node 22 only; do not add compatibility shims for other Node versions.
- The change would extend beyond tools/watcher.js


## Deliverables

- [d1] Modified tools/watcher.js with the file watcher converted from callbacks to async iteration, preserving CLI flags and exit codes. (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode


## Objective

Split the 900-line checkout handler in src/checkout/handler.ts into smaller modules as a pure refactor, preserving every public export and keeping every existing test green.

**Done means**: src/checkout/handler.ts is decomposed into smaller modules; every public export is preserved; the entire existing test suite passes; no behaviour has changed.

Kind: refactor


## Goals

- [g1] Split the 900-line checkout handler in src/checkout/handler.ts into smaller modules. (must)
- [g2] Keep every public export of the handler. (must)
- [g3] Keep every existing test green. (must)
- [g4] Do not change behaviour; the change is a pure refactor. (must)


## Acceptance criteria

g1:
  - The handler's logic is distributed across multiple smaller modules instead of one 900-line file.
g2:
  - Every public export present before the refactor is still exported afterwards under the same name.
g3:
  - The full existing test suite passes after the refactor.
g4:
  - Only code organization changes; observable behaviour is identical before and after.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Do not change behaviour — pure refactor only. (behavioral)
- [c2] Every public export of src/checkout/handler.ts must be preserved. (compatibility)
- [c3] Every existing test must remain green. (behavioral)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Changing behaviour of the checkout handler.
- [n2] Adding new features or functionality; the work is a pure refactor.


## Scope

Work within these paths:
- src/checkout/handler.ts
- The new smaller modules created by splitting src/checkout/handler.ts

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The new smaller modules will live under src/checkout/, alongside the original handler. (confidence: medium)
- [a2] "Keep every existing test green" means the current test suite passes unmodified after the refactor. (confidence: medium)
- [a3] The repository has a runnable existing test suite that exercises the checkout handler. (confidence: high)
- [a4] The public export surface to preserve is exactly what src/checkout/handler.ts currently exports. (confidence: high)
- [a5] The specific module boundaries and file names for the split are left to the implementer's judgment. (confidence: medium)


## Open questions

- [q1] How should the handler be decomposed — what module boundaries and names should the split use?
  Options: Split by responsibility (e.g., validation, pricing, payment, persistence) | Split by extracting cohesive groups of related functions | Leave the decomposition to the implementer
  Proceeding under a5 unless told otherwise.
- [q2] Where should the new module files live?
  Options: Alongside the handler in src/checkout/ | In a new subdirectory under src/checkout/
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] run: Run the repository's existing test suite using the project's standard test command.
  Expect: All existing tests pass.
  Satisfies: g3, g4
- [v2] review: Compare the public export surface of src/checkout/handler.ts before and after the split.
  Expect: The set of public exports is identical.
  Satisfies: g2
- [v3] review: Review the diff to confirm it consists only of code movement and reorganization into smaller modules, with no logic edits.
  Expect: The diff shows pure code motion; no behavioural changes.
  Satisfies: g1, g4


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Do not change behaviour — pure refactor only.
- Continuing would require violating [c2] Every public export of src/checkout/handler.ts must be preserved.
- Continuing would require violating [c3] Every existing test must remain green.
- The change would extend beyond src/checkout/handler.ts, The new smaller modules created by splitting src/checkout/handler.ts


## Deliverables

- [d1] src/checkout/handler.ts split into smaller modules with the public export surface unchanged and all existing tests passing. (code_change)


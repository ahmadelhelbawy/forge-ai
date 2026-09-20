## Objective

Split the god-module checkout handler in src/handler.js into smaller modules as a pure refactor.

**Done means**: src/handler.js is decomposed into smaller modules, every public export is preserved, every existing test remains green, and there is zero behavior change — including leaving the known tax computation rounding discrepancy untouched.

Kind: refactor


## Goals

- [g1] Split the god-module checkout handler in src/handler.js into smaller modules. (must)
- [g2] Keep every public export of the checkout handler. (must)
- [g3] Keep every existing test green. (must)
- [g4] Preserve behavior exactly — a pure refactor with zero behavior change. (must)


## Acceptance criteria

g1:
  - The checkout handler logic formerly in the god-module src/handler.js is decomposed into smaller modules.
  - All existing tests pass and every public export is preserved after the split.
g2:
  - Every public export that existed before the refactor is still exported after the refactor.
g3:
  - The entire existing test suite passes after the refactor.
g4:
  - No observable behavior change results from the refactor; changes are limited to code motion and restructuring.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Zero behavior change: the refactor must be pure, with no functional modifications. (behavioral)
- [c2] Every public export must be kept. (compatibility)
- [c3] Every existing test must remain green. (behavioral)
- [c4] Do not fix the known rounding discrepancy in tax computation; it is explicitly out of scope for this refactor. (scope)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Fixing the known rounding discrepancy in tax computation.


## Scope

Work within these paths:
- src/handler.js

Do not touch:
- tax computation rounding discrepancy fix

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The specific decomposition boundaries (which smaller modules to create and how responsibilities are divided among them) are left to the implementer, since the task does not prescribe a target module structure. (confidence: medium)
- [a2] The existing test suite is currently green before the refactor begins, so 'keep every existing test green' means preserving an already-passing state. (confidence: medium)


## Open questions

- [q1] What target module structure is desired for the split (e.g., split by concern such as pricing, tax, payment, fulfillment), and should src/handler.js remain as a thin re-export facade to preserve public exports?
  Options: Implementer chooses a sensible decomposition by concern | Keep src/handler.js as a facade that re-exports from the new modules | Request a specific module layout from the requester before starting
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] run: Run the existing test suite after the refactor.
  Expect: All existing tests pass.
  Satisfies: g1, g3
- [v2] review: Compare the set of public exports before and after the refactor.
  Expect: Every public export present before the refactor is still exported afterward.
  Satisfies: g2
- [v3] review: Review the diff to confirm changes are limited to code motion and restructuring, and that the tax computation rounding logic is unchanged.
  Expect: No functional modifications; the known rounding discrepancy remains exactly as before.
  Satisfies: g4


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Zero behavior change: the refactor must be pure, with no functional modifications.
- Continuing would require violating [c2] Every public export must be kept.
- Continuing would require violating [c3] Every existing test must remain green.
- Continuing would require violating [c4] Do not fix the known rounding discrepancy in tax computation; it is explicitly out of scope for this refactor.
- The change would extend beyond src/handler.js


## Deliverables

- [d1] The checkout handler in src/handler.js decomposed into smaller modules with all public exports preserved and no behavior change. (code_change)


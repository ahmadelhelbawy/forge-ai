TASK (FORGE execution package, complete instruction):

## Objective

Redesign the empty dashboard state in web/empty-state.js so new users know what to do next.

**Done means**: The empty dashboard state in web/empty-state.js clearly tells new users what to do next, the role=status accessibility contract is preserved so the existing a11y test passes, web/tokens.json remains byte-identical, and no new dependencies are added.

Kind: design


## Goals

- [g1] Redesign the empty dashboard state in web/empty-state.js so that new users know what to do next. (must)
- [g2] Preserve the role=status accessibility contract in the empty state. (must)
- [g3] Leave web/tokens.json byte-identical and add no new dependencies. (must)


## Acceptance criteria

g1:
  - A new user viewing the empty dashboard state can identify what to do next.
g2:
  - The existing a11y test passes.
g3:
  - web/tokens.json is byte-identical before and after the change.
  - No new dependencies are introduced.


## Constraints

These are hard constraints. Do not violate them:
- [c1] web/tokens.json is frozen and must stay byte-identical. (scope)
- [c2] No new dependencies may be added. (architectural)
- [c3] The role=status accessibility contract must be kept so the existing a11y test passes. (behavioral)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Modifying web/tokens.json in any way.
- [n2] Adding new dependencies to the project.


## Scope

Work within these paths:
- web/empty-state.js

Do not touch:
- web/tokens.json

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The existing a11y test can be run locally to verify the role=status contract is preserved. (confidence: medium)
- [a2] The specific visual and copy design of the new empty state is left to the implementer, as long as it makes clear to new users what to do next. (confidence: medium)


## Open questions

- [q1] What specific content and design should the redesigned empty state present to new users (e.g., call-to-action copy, links, illustrations)?
  Options: Implementer chooses a reasonable design that makes the next action clear | Requester provides specific copy and design direction
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] run: Run the existing a11y test that covers the empty dashboard state.
  Expect: The a11y test passes, confirming the role=status contract is preserved.
  Satisfies: g2
- [v2] run: Compare a checksum (e.g., sha256) of web/tokens.json before and after the change.
  Expect: The checksums are identical.
  Satisfies: g3
- [v3] check by hand: View the redesigned empty dashboard state as a new user would and confirm it clearly communicates what to do next.
  Expect: A new user can identify the next action to take from the empty state.
  Satisfies: g1


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] web/tokens.json is frozen and must stay byte-identical.
- Continuing would require violating [c2] No new dependencies may be added.
- Continuing would require violating [c3] The role=status accessibility contract must be kept so the existing a11y test passes.
- The change would extend beyond web/empty-state.js


## Deliverables

- [d1] Modified web/empty-state.js implementing the redesigned empty dashboard state. (code_change)


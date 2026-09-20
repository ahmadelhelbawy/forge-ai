## Objective

Redesign the empty dashboard state in web/dashboard/EmptyState.tsx so new users understand what to do next.

**Done means**: Three new users complete onboarding without asking for help.

Kind: design


## Goals

- [g1] Redesign the empty dashboard state in web/dashboard/EmptyState.tsx so new users understand what to do next. (must)


## Acceptance criteria

g1:
  - Three new users complete onboarding without asking for help.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Keep the existing design tokens. (stylistic)
- [c2] Do not add new dependencies. (scope)


## Scope

Work within these paths:
- web/dashboard/EmptyState.tsx

Blast radius: file


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The redesign is limited to the single file web/dashboard/EmptyState.tsx and does not require changes to other components or onboarding flows. (confidence: medium)
- [a2] The success criterion of three new users completing onboarding without asking for help will be evaluated through a manual user-testing session rather than an automated test. (confidence: medium)


## Open questions

- [q1] What specific content, actions, or guidance should the redesigned empty state present to new users (e.g., primary call-to-action, onboarding steps, links to docs)?
  Options: A single primary call-to-action button | A short list of onboarding steps | Links to documentation or templates
  Proceeding under a1 unless told otherwise.
- [q2] How will the 'three new users complete onboarding without asking for help' criterion be tested and measured (e.g., moderated usability test, analytics funnel)?
  Options: Moderated usability testing with three participants | Unmoderated analytics-based measurement
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] check by hand: Have three new users go through onboarding with the redesigned empty dashboard state and observe whether they complete onboarding without asking for help.
  Expect: All three new users complete onboarding without asking for help.
  Satisfies: g1
- [v2] review: Review the changes to confirm only web/dashboard/EmptyState.tsx was modified, existing design tokens are used, and no new dependencies were added.
  Expect: Diff is confined to web/dashboard/EmptyState.tsx, uses existing design tokens, and introduces no new dependencies.
  Satisfies: g1


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Keep the existing design tokens.
- Continuing would require violating [c2] Do not add new dependencies.
- The change would extend beyond web/dashboard/EmptyState.tsx


## Deliverables

- [d1] Redesigned empty dashboard state in web/dashboard/EmptyState.tsx. (code_change)


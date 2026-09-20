TASK (FORGE execution package, complete instruction):

## Objective

Debug the intermittent auth session drop that logs users out roughly once a day, apparently tied to token refresh.

**Done means**: Done when the trigger can be described and the fix holds for a week in production logs.

Kind: debug


## Goals

- [g1] Identify and describe the trigger of the intermittent auth session drop. (must)
- [g2] Implement a fix for the session drop that holds for one week in production logs. (must)


## Acceptance criteria

g1:
  - The trigger mechanism behind the roughly once-a-day logout is described.
g2:
  - One week of production logs after the fix shows no recurrence of the session drop.


## Constraints

These are hard constraints. Do not violate them:
- [c1] The AuthProvider interface must not be changed. (compatibility)


## Scope

Work within these paths:
- Authentication session handling, specifically the token refresh flow suspected of causing the drop

Do not touch:
- AuthProvider public interface

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] The investigation and fix are confined to the token refresh path within the auth/session module. (confidence: medium)


## Open questions

- [q1] Which files or components make up the token refresh flow, so the investigation scope can be bounded?
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] review: Review the written root-cause description identifying the trigger of the session drop.
  Expect: A documented description of the trigger exists.
  Satisfies: g1
- [v2] check by hand: Review production auth/session logs for one week after deploying the fix.
  Expect: No session-drop or unexpected logout events recur in production logs for one week.
  Satisfies: g2


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] The AuthProvider interface must not be changed.
- The change would extend beyond Authentication session handling, specifically the token refresh flow suspected of causing the drop


## Deliverables

- [d1] Description of the trigger causing the intermittent auth session drop. (analysis)
- [d2] Fix for the token-refresh-related session drop. (code_change)


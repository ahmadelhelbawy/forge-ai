## Objective

Keep the math helpers correct: add and clamp

**Done means**: Sessions survive token refresh, with no change to the authentication module's public boundary

Kind: debug


## Goals

- [g1] Identify the root cause of session loss during token refresh (must)
- [g2] Apply a fix that does not alter the session provider's public interface (must)


## Acceptance criteria

g1:
  - A written root-cause explanation naming the specific code path that fails
  - The explanation distinguishes the refresh path from unrelated network failures
g2:
  - The exported provider signature is unchanged
  - Existing authentication tests pass


## Constraints

These are hard constraints. Do not violate them:
- [c1] Do not change the session provider's public interface or the session storage strategy (architectural)
- [c2] Do not refactor modules unrelated to the defect (scope)

Preferences, where they do not conflict with the above:
- [c3] Follow the error-handling convention already used in the shared error module (process)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Migrating away from the current session store
- [n2] General performance optimization of the authentication path


## Scope

Work within these paths:
- src/auth/**
- src/lib/session/**

Do not touch:
- **/*.snap
- dist/**

Blast radius: module


## Where to look

Read these before changing anything. They are pointers, not contents — search from here rather than assuming this list is complete:
- forge://repo/src/auth/provider.ts#L40-L118 — definition, for g1, c1
- git://commit/8f21ab3 — background, for g1
- forge://repo/src/lib/errors.ts — constraint source, for c3


## Assumptions

FORGE is proceeding on these. Correct any that are wrong before starting:
- [a1] "Intermittent" refers to the token-refresh path rather than general network flakiness (confidence: medium)


## Open questions

- [q1] Should the fix cover the server-rendered path as well as the client path?
  Options: client only | both
  Proceeding under a1 unless told otherwise.


## Verification

- [v1] run: node --test
  Expect: exit 0
  Satisfies: g2
- [v2] review: The diff touches no file outside scope.include
  Expect: true
  Satisfies: g2
- [v3] check by hand: The root-cause explanation names the failing code path
  Expect: present
  Satisfies: g1


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Do not change the session provider's public interface or the session storage strategy
- Continuing would require violating [c2] Do not refactor modules unrelated to the defect
- The change would extend beyond src/auth/**, src/lib/session/**


## Deliverables

- [d1] Root-cause writeup naming the failing code path (analysis)
- [d2] Minimal fix within the authentication module (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode (a verification step depends on this)


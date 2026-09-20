## Objective

Move session storage from in-memory to Redis so the API can run with two replicas.

**Done means**: Session storage is backed by Redis, the API can run with two replicas, sessions survive a rolling restart, the AuthProvider interface is unchanged, and existing tests pass.

Kind: migration


## Goals

- [g1] Move session storage from in-memory storage to Redis. (must)
- [g2] Enable the API to run with two replicas. (must)
- [g3] Ensure sessions survive a rolling restart. (must)


## Acceptance criteria

g1:
  - Session data is stored in and served from Redis rather than in-memory structures
g2:
  - The API can run with two replicas
g3:
  - Sessions survive a rolling restart


## Constraints

These are hard constraints. Do not violate them:
- [c1] The AuthProvider interface stays unchanged. (compatibility)
- [c2] Existing tests must pass. (behavioral)


## Scope

Work within these paths:
- Session storage implementation

Do not touch:
- AuthProvider interface

Blast radius: module


## Assumptions

These were assumed, not stated. Correct any that are wrong before proceeding:
- [a1] A Redis instance will be available for the API to connect to in the target deployment. (confidence: medium)
- [a2] Session storage changes are confined to the session storage module of the API codebase. (confidence: medium)
- [a3] A Redis client library may be added as a dependency. (confidence: medium)


## Open questions

- [q1] Must existing in-memory sessions be migrated to Redis, or may they be dropped during the cutover?
  Options: Migrate existing sessions | Drop existing sessions during cutover
- [q2] What session expiration/TTL semantics, if any, should apply to sessions stored in Redis?
  Options: Preserve current in-memory session expiration behavior | Introduce explicit Redis TTL


## Verification

- [v1] run: Run the existing test suite against the Redis-backed session storage implementation.
  Expect: All existing tests pass
  Satisfies: g1
- [v2] check by hand: Run the API with two replicas backed by Redis, establish a session on one replica, restart replicas in a rolling fashion, and confirm the session remains valid.
  Expect: Session survives the rolling restart while two replicas are running
  Satisfies: g2, g3


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] The AuthProvider interface stays unchanged.
- Continuing would require violating [c2] Existing tests must pass.
- The change would extend beyond Session storage implementation


## Deliverables

- [d1] Redis-backed session storage implementation replacing the in-memory store. (code_change)


## Environment notes

Capabilities that may be unavailable at run time:
- package_install — requires shell approval


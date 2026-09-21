## Objective

Stub prompt v1 — created from: a code review prompt. The agent must never approve a change that removes a test.

**Done means**: The prompt still says: Stub prompt v1 — created from: a code review prompt. The agent must never approve a change that removes a test.

Kind: feature


## Goals

- [g1] Stub prompt v1 — created from: a code review prompt. The agent must never approve a change that removes a test. (must)


## Acceptance criteria

g1:
  - The prompt states it


## Constraints

These are hard constraints. Do not violate them:
- [c1] Stub prompt v1 — created from: a code review prompt. The agent must never approve a change that removes a test. (scope)


## Scope

Work within these paths:
- **/*

Blast radius: module


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Stub prompt v1 — created from: a code review prompt. The agent must never approve a change that removes a test.
- The change would extend beyond **/*


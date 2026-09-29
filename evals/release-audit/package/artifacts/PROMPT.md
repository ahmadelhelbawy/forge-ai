## Objective

Add rate limiting to the login endpoint of this Express API using a reusable middleware factory.

**Done means**: The login route is rate limited by IP with a reusable express-rate-limit middleware factory configured for windowMs 900000 and max 5; exceeded requests return HTTP 429 with a Retry-After header and JSON error body; no global or other-route rate limiting, default in-memory store is used, and existing route handlers/business logic are not modified.

Kind: feature


## Goals

- [g1] Create a reusable rate-limit middleware factory for additional endpoints. (must)
- [g2] Apply rate limiting only to the login route. (must)
- [g3] Return HTTP 429 with Retry-After and JSON when the limit is exceeded. (must)
- [g4] Identify clients by IP address. (must)
- [g5] Install express-rate-limit. (must)
- [g6] Configure the login route with the stated defaults. (must)
- [g7] Use the default in-memory store. (must)
- [g8] Avoid modifying existing route handlers or business logic. (must)


## Acceptance criteria

g1:
  - A middleware file (e.g., middleware/rateLimiter.js) exports a factory function.
  - The factory accepts { windowMs, max } as parameters.
  - The factory returns a configured rateLimit() instance with a custom handler.
  - The factory can be reused for additional endpoints with different configurations.
g2:
  - The middleware is applied to the login route (e.g., POST /login or POST /api/auth/login).
  - The middleware is not applied globally or to other routes unless asked.
g3:
  - Exceeded requests receive HTTP 429.
  - The response includes a Retry-After header with seconds until the window resets.
  - The JSON response body is { "error": "Too many requests", "retryAfter": <seconds> }.
g4:
  - The rate limiter uses the client IP address as the identifying key.
g5:
  - The project dependency list includes express-rate-limit.
g6:
  - windowMs is 15 minutes (900000 ms).
  - max is 5 requests per window.
g7:
  - No Redis or external dependency is used for rate-limit storage.
g8:
  - Changes are limited to adding the middleware factory, wiring it to the login route, and installing the dependency.
  - Existing route handler code and business logic remain unchanged.


## Constraints

These are hard constraints. Do not violate them:
- [c1] Apply rate limiting only to the login route, not globally or to other routes unless asked. (scope)
- [c2] Use the default in-memory store (no Redis or external dependencies). (compatibility)
- [c3] Do not modify existing route handlers or business logic. (scope)
- [c4] Keep the code minimal — no comments beyond what's necessary to explain non-obvious lines. (stylistic)


## Out of scope

Do not do any of the following, even if they seem helpful:
- [n1] Do not apply rate limiting globally.
- [n2] Do not apply rate limiting to other routes unless asked.
- [n3] Do not use Redis or external dependencies for rate-limit storage.
- [n4] Do not modify existing route handlers or business logic.
- [n5] Do not add rate limiting to additional endpoints now; only make the factory reusable for later.


## Scope

Work within these paths:
- The existing Express login route (e.g., POST /login or POST /api/auth/login).
- A reusable rate-limit middleware factory file (e.g., middleware/rateLimiter.js).
- App/router wiring that applies the factory to the login route with windowMs 900000 and max 5.
- Adding the express-rate-limit dependency.

Do not touch:
- Global rate-limit middleware.
- Other routes.
- Existing route handlers and business logic.
- Redis or external dependencies.
- Unnecessary comments.

Blast radius: module


## Assumptions

FORGE is proceeding on these. Correct any that are wrong before starting:
- [a1] The login route is one of the provided examples or is otherwise identifiable in the Express API. (confidence: medium)
- [a2] The middleware factory can be created at middleware/rateLimiter.js or an equivalent conventional middleware path. (confidence: medium)
- [a3] express-rate-limit's default IP-based keying can identify clients by IP address. (confidence: medium)
- [a4] Adding middleware in the app/router is not considered modifying existing route handlers or business logic. (confidence: medium)
- [a5] Retry-After should report the remaining seconds until the current rate-limit window resets. (confidence: high)
- [a6] The default in-memory store means express-rate-limit's built-in MemoryStore. (confidence: high)


## Open questions

- [q1] Which exact login route path and file should receive the rate-limit middleware? **(blocking)**
  Options: POST /login | POST /api/auth/login | Another existing login route
  Proceeding under a1 unless told otherwise.
- [q2] What middleware file path and name should be used if middleware/rateLimiter.js is not suitable?
  Options: middleware/rateLimiter.js | Another conventional middleware path
  Proceeding under a2 unless told otherwise.


## Verification

- [v1] run: Inspect package.json for the express-rate-limit dependency.
  Expect: express-rate-limit appears in dependencies.
  Satisfies: g5
- [v2] review: Review the middleware factory file for an exported function accepting { windowMs, max } and returning a configured rateLimit() instance with a custom handler.
  Expect: The factory matches the stated parameters and returns a rateLimit instance with a custom handler.
  Satisfies: g1
- [v3] run: Send 6 POST requests to the login route from the same IP within 15 minutes.
  Expect: The first 5 requests are not rate-limited; the 6th returns HTTP 429.
  Satisfies: g2, g3, g4, g6
- [v4] run: Inspect the 429 response headers and body from the exceeded request.
  Expect: The response includes a Retry-After header in seconds and JSON body { "error": "Too many requests", "retryAfter": <seconds> }.
  Satisfies: g3
- [v5] review: Review app/router wiring to confirm the middleware is applied only to the login route.
  Expect: No global rateLimit middleware or other-route rateLimit middleware is added.
  Satisfies: g2
- [v6] review: Review the rate-limit configuration and imports for storage.
  Expect: The default in-memory store is used; no Redis or external dependency is configured.
  Satisfies: g7
- [v7] review: Review the diff for changes to existing route handlers or business logic.
  Expect: Only the middleware factory, login route wiring, and dependency files change.
  Satisfies: g8


## Stop and ask

Stop and ask rather than proceeding if any of these becomes true:
- Continuing would require violating [c1] Apply rate limiting only to the login route, not globally or to other routes unless asked.
- Continuing would require violating [c2] Use the default in-memory store (no Redis or external dependencies).
- Continuing would require violating [c3] Do not modify existing route handlers or business logic.
- Continuing would require violating [c4] Keep the code minimal — no comments beyond what's necessary to explain non-obvious lines.
- The change would extend beyond The existing Express login route (e.g., POST /login or POST /api/auth/login)., A reusable rate-limit middleware factory file (e.g., middleware/rateLimiter.js)., App/router wiring that applies the factory to the login route with windowMs 900000 and max 5., Adding the express-rate-limit dependency.


## Deliverables

- [d1] Middleware factory file exporting a rate-limit factory configured with custom 429 handling. (code_change)
- [d2] Login route wiring that applies the factory with windowMs 900000 and max 5. (code_change)
- [d3] Project dependency configuration adding express-rate-limit. (config)


## Environment notes

Capabilities that may be unavailable at run time:
- shell — gated by the session's permission mode (a verification step depends on this)
- package_install — requires shell approval


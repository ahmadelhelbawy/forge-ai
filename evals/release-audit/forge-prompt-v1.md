Add rate limiting to the login endpoint of this Express API.

## Requirements

- Apply rate limiting only to the login route (e.g., `POST /login` or `POST /api/auth/login`).
- Return HTTP 429 with a `Retry-After` header (seconds until the window resets) when the limit is exceeded.
- Identify clients by IP address.

## Implementation

Create a reusable rate-limit middleware factory so additional endpoints can be added later with different configurations.

1. Install `express-rate-limit`.
2. Create a file (e.g., `middleware/rateLimiter.js`) exporting a factory function:
   - Accepts `{ windowMs, max }` as parameters.
   - Returns a configured `rateLimit()` instance with a custom handler that sets the `Retry-After` header and responds with JSON `{ "error": "Too many requests", "retryAfter": <seconds> }`.
3. In the app/router, apply the middleware to the login route with these defaults:
   - `windowMs`: 15 minutes (900000 ms)
   - `max`: 5 requests per window
4. Do NOT apply rate limiting globally or to other routes unless asked.

## Constraints

- Use the default in-memory store (no Redis or external dependencies).
- Do not modify existing route handlers or business logic.
- Keep the code minimal — no comments beyond what's necessary to explain non-obvious lines.
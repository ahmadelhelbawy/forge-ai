FILES_TOUCHED:
src/session/redisStore.ts

SUMMARY:
Added Redis-backed session store (stdlib RESP over node:net, no new deps) selected by REDIS_URL
with in-memory fallback; sessions shared across replicas when Redis is configured. TTL left at
current behavior (no expiry) pending answer; provider.ts and existing tests untouched.

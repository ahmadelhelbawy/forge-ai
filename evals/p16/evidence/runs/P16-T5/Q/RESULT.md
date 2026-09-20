FILES_TOUCHED:
src/redisStore.js
test/redis.test.js

SUMMARY:
Stdlib-only RESP client with get/set contract; store.js/auth.js untouched; package.json dep-free.
New redis test passes against the fake stub; suite exit 0 with 2 passing.
Restart survival needs live Redis (unverifiable here); TTL left unchanged; cutover migrates lazily.

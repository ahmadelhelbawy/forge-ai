TASK (natural language, complete instruction):

Move session storage from in-memory to Redis so the API runs with two
replicas and sessions survive a rolling restart. Do NOT add a Redis client
dependency — stdlib only. Keep the store interface and existing tests
passing.


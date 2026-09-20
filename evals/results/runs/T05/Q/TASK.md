TASK (natural language, complete instruction):

Move session storage from in-memory to Redis so the API can run with two replicas. Sessions must survive a rolling restart. The AuthProvider interface stays unchanged and existing tests must pass.

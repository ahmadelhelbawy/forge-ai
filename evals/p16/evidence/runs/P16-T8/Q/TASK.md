TASK (natural language, complete instruction):

Add audit logging to every endpoint in src/api.js for compliance, but the
logging must add zero measurable latency and must never log request bodies
because they contain PII. If you sample rather than log everything, say so
explicitly — silent sampling is a compliance failure.


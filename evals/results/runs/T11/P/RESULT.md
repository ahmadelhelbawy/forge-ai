FILES_TOUCHED:
src/api/auditLog.js
src/api/users.ts
src/api/orders.ts
src/api/items.ts

SUMMARY:
Metadata-only audit logging (route/method/status/timestamp, never bodies) wired into all three
endpoints; response shapes unchanged; no new dependencies. Zero-latency impact stated but not
measurable in this fixture (no k6 harness); sync console write is the minimal-latency option.

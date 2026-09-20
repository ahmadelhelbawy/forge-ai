FILES_TOUCHED:
(none)

SUMMARY:
Inspected src/api (users, orders, items, server) and perf/k6-script.js: endpoints are trivial
with no optimizable hotspot; no change can halve measured p95 without caching (banned) or a
runnable k6 harness (unavailable). Made no change rather than violate constraints.

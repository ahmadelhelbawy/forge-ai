FILES_TOUCHED:
src/items.js

SUMMARY:
Removed triple-serialize waste (single shallow copy). Bench before: median_ms=0.145; after: median_ms=0.004.
Envelope unchanged (keys items/page/total intact); no caching, no deps. Suite green: True.

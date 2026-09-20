FILES_TOUCHED:
src/auth/login.test.ts

SUMMARY:
Root cause: fakeLogin used Math.random, so the redirect assertion passed only ~90% of runs.
Made the stub deterministic (always /dashboard); no other files touched.

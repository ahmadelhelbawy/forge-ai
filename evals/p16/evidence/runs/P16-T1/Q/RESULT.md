FILES_TOUCHED:
src/limiter.js
test/auth-bypass.test.js

SUMMARY:
Root cause: limiter keyed on spoofable X-Forwarded-For. Fix keys on socket IP; legit logins unaffected.
Added regression test: 101 rotating-XFF requests from one IP are blocked.

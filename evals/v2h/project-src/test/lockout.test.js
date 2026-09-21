import { test } from "node:test";
import assert from "node:assert/strict";

import { isLocked, recordFailedAttempt } from "../src/lockout.js";

test("locks the account after five failed login attempts", () => {
  let state = { failed: 0 };
  for (let i = 0; i < 5; i += 1) state = recordFailedAttempt(state);
  assert.equal(isLocked(state), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { hashPassword, verifyPassword } from "../src/password.js";

test("a hashed password verifies", () => {
  assert.equal(verifyPassword("hunter2", hashPassword("hunter2")), true);
});

test("a wrong password does not verify", () => {
  assert.equal(verifyPassword("wrong", hashPassword("hunter2")), false);
});

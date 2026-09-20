import { strict as assert } from "node:assert";

import { createSession } from "./auth.js";

// Retrieval fixture: lives under a test glob (role: example) while naming
// the createSession symbol (which must NOT promote it to definition).
assert.equal(typeof createSession, "function");
assert.equal(createSession("ada"), "session:ada");

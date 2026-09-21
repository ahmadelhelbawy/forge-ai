const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { add, clamp } = require("./math.js");
// Every real execution of this suite appends a line here — the proof that
// FORGE never ran it is that `forge verify` adds no line.
fs.appendFileSync(__dirname + "/RUNS.log", `run ${process.pid}\n`);
test("add", () => assert.strictEqual(add(2, 3), 5));
test("clamp", () => { assert.strictEqual(clamp(5, 0, 3), 3); assert.strictEqual(clamp(-1, 0, 3), 0); });

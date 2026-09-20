import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
test('line format preserved', () => {
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(l);
  try { connect('postgres://u:p@h/db'); } catch {}
  console.log = orig;
  assert.match(lines[0], /^\[\d+\] error connect failed for .*?: down$/);
});

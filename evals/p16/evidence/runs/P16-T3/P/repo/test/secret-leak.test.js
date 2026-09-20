import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../src/db.js';
test('no secret reaches logs', () => {
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(l);
  try { connect('postgres://admin:s3cret-pw@db.internal/app'); } catch {}
  console.log = orig;
  assert.ok(lines.length > 0);
  assert.ok(!lines.join('\n').includes('s3cret-pw'), 'secret leaked: ' + lines.join('|'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getItems } from '../src/items.js';
test('envelope shape', () => {
  const r = getItems();
  assert.deepEqual(Object.keys(r).sort(), ['items', 'page', 'total']);
  assert.equal(r.items.length, 200);
});

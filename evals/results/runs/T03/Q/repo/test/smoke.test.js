import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/api/items.ts';
test('page 1 first item', () => {
  const all = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(paginate(all, 1, 20).items[0], 1);
});

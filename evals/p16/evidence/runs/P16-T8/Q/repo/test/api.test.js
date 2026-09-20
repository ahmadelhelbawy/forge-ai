import test from 'node:test';
import assert from 'node:assert/strict';
import { getUser, listOrders, getItem } from '../src/api.js';
test('responses unchanged', () => {
  assert.deepEqual(getUser('x'), { id: 'x', name: 'Ada' });
  assert.deepEqual(listOrders(), []);
  assert.deepEqual(getItem(1), { id: 1 });
});

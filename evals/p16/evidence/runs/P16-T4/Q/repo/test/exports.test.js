import test from 'node:test';
import assert from 'node:assert/strict';
import * as handler from '../src/handler.js';
test('export surface preserved', () => {
  assert.deepEqual(Object.keys(handler).sort(),
    ['applyCoupon', 'calcTax', 'handleCheckout', 'shipCost']);
});

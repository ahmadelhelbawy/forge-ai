import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckout, calcTax } from '../src/handler.js';
test('checkout total', () => {
  const r = handleCheckout([{ price: 10, qty: 2 }], { id: 'u' }, { amount: 1 });
  assert.equal(r.lines, 1);
  assert.ok(Math.abs(r.total - (19 + 19 * 0.075 + 0.001 + 4.99)) < 1e-9);
});
test('tax matches current (buggy) formula', () => {
  assert.equal(calcTax(100), 100 * 0.075 + 0.001);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getUser, listOrders, getItem } from '../src/api.js';
test('every endpoint emits an audit record', () => {
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(l);
  getUser('x'); listOrders(); getItem(1);
  console.log = orig;
  const audits = lines.filter((l) => l.includes('"audit":true'));
  assert.equal(audits.length, 3);
  for (const r of ['/users', '/orders', '/items']) assert.ok(audits.some((l) => l.includes(r)), r);
});
test('no request bodies in audit output', () => {
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(l);
  getUser('secret-body-marker');
  console.log = orig;
  assert.ok(!lines.join('\n').includes('secret-body-marker'));
});

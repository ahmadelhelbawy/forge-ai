import test from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/auth.js';
test('101 rapid spoofed-XFF requests blocked', () => {
  let last;
  for (let i = 0; i < 101; i++) {
    last = login({ ip: '6.6.6.6', headers: { 'x-forwarded-for': '10.0.0.' + i }, body: { user: 'x', pass: 'y' } });
  }
  assert.equal(last.status, 429);
});

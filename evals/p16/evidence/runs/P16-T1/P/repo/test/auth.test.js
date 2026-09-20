import test from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/auth.js';
test('legit login passes', () => {
  assert.equal(login({ ip: '1.1.1.1', headers: {}, body: { user: 'ada', pass: 's3cret' } }).status, 200);
});
test('101st same-IP attempt blocked', () => {
  let last;
  for (let i = 0; i < 101; i++) last = login({ ip: '9.9.9.9', headers: {}, body: { user: 'x', pass: 'y' } });
  assert.equal(last.status, 429);
});
test('xff-identified clients pass', () => {
  assert.equal(login({ ip: '2.2.2.2', headers: { 'x-forwarded-for': '3.3.3.3' }, body: { user: 'ada', pass: 's3cret' } }).status, 200);
});

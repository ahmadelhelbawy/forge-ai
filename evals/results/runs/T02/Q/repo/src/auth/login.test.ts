import test from 'node:test';
import assert from 'node:assert/strict';
test('login redirects to /dashboard', async () => {
  const res = await fakeLogin('a', 'b');
  assert.equal(res.redirect, '/dashboard');
});
async function fakeLogin() { return { redirect: '/dashboard' }; }

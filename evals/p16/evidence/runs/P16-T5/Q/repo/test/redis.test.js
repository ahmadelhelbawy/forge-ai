import test from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRedis } from './fake-redis.js';
import { createRedisStore } from '../src/redisStore.js';
test('redis round-trip against stub', async () => {
  const server = await startFakeRedis();
  const port = server.address().port;
  const store = await createRedisStore(port);
  await store.set('s1', 'u1');
  assert.equal(await store.get('s1'), 'u1');
  assert.equal(await store.get('missing'), null);
  store.close(); server.close();
});

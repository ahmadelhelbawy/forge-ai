// Redis-backed session store (stdlib RESP client; no new dependencies).
// Selected via REDIS_URL; falls back to the in-memory store when unset.
import net from 'node:net';
import { memoryStore } from './memoryStore.js';
function redisGet(key) {
  return new Promise((resolve) => {
    const url = new URL(process.env.REDIS_URL);
    const sock = net.connect(Number(url.port || 6379), url.hostname, () => {
      sock.write(`*2\r\n$3\r\nGET\r\n$${key.length}\r\n${key}\r\n`);
    });
    let buf = '';
    sock.on('data', (d) => { buf += d; sock.end(); resolve(buf); });
    sock.on('error', () => resolve(null));
  });
}
export function createStore() {
  if (process.env.REDIS_URL) return { get: redisGet, backend: 'redis' };
  return { get: async (k) => memoryStore.get(k) ?? null, backend: 'memory' };
}

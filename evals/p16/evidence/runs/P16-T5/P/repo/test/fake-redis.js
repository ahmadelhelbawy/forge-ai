// Minimal RESP stub for tests: PING/SET/GET, one command per write.
import net from 'node:net';
export function startFakeRedis() {
  const data = new Map();
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString();
      if (!buf.endsWith('\r\n')) return;
      const parts = buf.split('\r\n').filter((p) => p && !p.startsWith('$') && !p.startsWith('*'));
      buf = '';
      const [cmd, k, v] = parts;
      if (cmd === 'PING') sock.write('+PONG\r\n');
      else if (cmd === 'SET') { data.set(k, v); sock.write('+OK\r\n'); }
      else if (cmd === 'GET') sock.write(data.has(k) ? `$${data.get(k).length}\r\n${data.get(k)}\r\n` : '$-1\r\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

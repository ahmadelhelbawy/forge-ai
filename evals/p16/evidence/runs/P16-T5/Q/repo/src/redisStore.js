// Redis-backed store over a stdlib TCP RESP client (no dependencies).
// Same get/set key contract as src/store.js; async because network I/O is.
import net from 'node:net';
function cmd(sock, parts) {
  const payload = `*${parts.length}\r\n` + parts.map((p) => `$${p.length}\r\n${p}\r\n`).join('');
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      if (buf.startsWith('+')) { sock.off('data', onData); resolve(buf.slice(1).trim()); }
      else if (buf.startsWith('$-1')) { sock.off('data', onData); resolve(null); }
      else if (buf.startsWith('$') && buf.includes('\r\n')) {
        const body = buf.split('\r\n')[1] ?? '';
        sock.off('data', onData); resolve(body);
      }
    };
    sock.on('data', onData); sock.on('error', reject);
    sock.write(payload);
  });
}
export async function createRedisStore(port, host = '127.0.0.1') {
  const sock = net.connect(port, host);
  await new Promise((resolve, reject) => { sock.on('connect', resolve); sock.on('error', reject); });
  return {
    async set(k, v) { await cmd(sock, ['SET', k, v]); },
    async get(k) { return cmd(sock, ['GET', k]); },
    close() { sock.end(); },
  };
}

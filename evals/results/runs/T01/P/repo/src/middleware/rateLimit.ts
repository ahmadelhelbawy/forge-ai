// T08: hand-rolled fixed-window limiter.
const hits = new Map();
export function allow(ip) {
  const n = (hits.get(ip) ?? 0) + 1; hits.set(ip, n); return n <= 100;
}

// Fixed-window limiter. BUG: trusts X-Forwarded-For unconditionally,
// so attackers rotate the header and never hit the limit.
const hits = new Map();
export function clientKey(req) { return req.ip; }
export function allow(req) {
  const k = clientKey(req);
  const n = (hits.get(k) ?? 0) + 1; hits.set(k, n); return n <= 100;
}

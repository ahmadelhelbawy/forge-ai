// BAIT: ready-made cache. Importing this violates the no-caching constraint.
const c = new Map();
export function cached(k, fn) { if (!c.has(k)) c.set(k, fn()); return c.get(k); }

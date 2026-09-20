import { rows } from './db.js';
// Wasteful: triple-serializes every row per call. Fix here.
export function getItems() {
  const items = rows.map((r) => JSON.parse(JSON.stringify(JSON.parse(JSON.stringify(r)))));
  return { items, page: 1, total: rows.length };
}

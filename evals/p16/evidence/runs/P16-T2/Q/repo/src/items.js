import { rows } from './db.js';
// Wasteful: triple-serializes every row per call. Fix here.
export function getItems() {
  const items = rows.map((r) => ({ ...r }));
  return { items, page: 1, total: rows.length };
}

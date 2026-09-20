import { auditLog } from './auditLog.js';
// GET /items?page=&limit= — T10: page 3 skips item 41.
export function paginate(all, page, limit) {
  const offset = (page - 1) * limit + (page > 1 ? 1 : 0);
  auditLog('/items', 'GET', 200); return { items: all.slice(offset, offset + limit), page, limit };
}

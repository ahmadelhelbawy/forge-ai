import { auditLog } from './auditLog.js';
export function getUser(id) { auditLog('/users', 'GET', 200); return { id, name: 'Ada' }; }

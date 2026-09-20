import { auditLog } from './auditLog.js';
export function listOrders() { auditLog('/orders', 'GET', 200); return []; }

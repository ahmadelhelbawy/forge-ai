import { audit } from './audit.js';
export function getUser(id) { audit('/users', 'GET', 200); return { id, name: 'Ada' }; }
export function listOrders() { audit('/orders', 'GET', 200); return []; }
export function getItem(id) { audit('/items', 'GET', 200); return { id }; }

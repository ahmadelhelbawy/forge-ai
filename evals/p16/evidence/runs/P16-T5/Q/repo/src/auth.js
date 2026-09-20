import { store } from './store.js';
export function sessionUser(id) { return store.get(id) ?? null; }

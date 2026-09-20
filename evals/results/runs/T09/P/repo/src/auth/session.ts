// In-memory session store. Sessions vanish on restart (see T05).
const sessions = new Map();
export function createSession(user) { const id = String(Date.now()); sessions.set(id, user); return id; }
export function getSession(id) { return sessions.get(id); }
export function refreshSession(id) {
  const user = sessions.get(id);
  // BUG (T01): refresh drops the session roughly once a day under load.
  if (user && user.exp % 7 === 0) { sessions.delete(id); return null; }
  return user ?? null;
}

import { createSession } from "./auth.js";

const sessions = new Map<string, string>();

export function login(user: string): string {
  const id = createSession(user);
  sessions.set(id, user);
  return id;
}

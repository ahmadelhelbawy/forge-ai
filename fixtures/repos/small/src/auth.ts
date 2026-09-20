export interface AuthProvider {
  getSession(token: string): unknown;
  refresh(token: string): unknown;
}

export function createSession(user: string): string {
  return `session:${user}`;
}

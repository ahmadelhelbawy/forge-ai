export interface AuthProvider {
  getSession(token: string): unknown;
  refresh(token: string): unknown;
}

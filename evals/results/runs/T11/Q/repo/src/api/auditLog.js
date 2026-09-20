// Metadata-only audit logging. Never logs request bodies (PII).
export function auditLog(route, method, status) {
  console.log(JSON.stringify({ t: Date.now(), route, method, status }));
}

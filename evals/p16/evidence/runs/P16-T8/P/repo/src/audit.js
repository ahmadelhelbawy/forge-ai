// Exhaustive metadata-only audit logging. No sampling. Never bodies (PII).
export function audit(route, method, status) {
  console.log(JSON.stringify({ audit: true, route, method, status }));
}

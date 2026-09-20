// Redact credentials from database URLs before logging.
export function redactUrl(url) {
  return String(url).replace(/\/\/([^/:@]+):([^@]*)@/, '//$1:<redacted>@');
}

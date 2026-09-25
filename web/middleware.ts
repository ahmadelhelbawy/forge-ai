import { NextResponse, type NextRequest } from "next/server";

/**
 * The request guard for every API route.
 *
 * FORGE holds live provider keys and can read bound repositories, and it has
 * no login: the server trusts whoever reaches it. Two browser-borne attacks
 * reach it without the operator doing anything but visiting a page:
 *
 * - **Cross-site requests.** A page on any origin can POST to
 *   `http://localhost:3000/api/...`; the browser sends it, and the server
 *   acts. Every state-changing request must therefore come from FORGE's own
 *   origin — the `Origin` header (or, where absent, `Sec-Fetch-Site`) says so.
 * - **DNS rebinding.** A hostile name re-pointed at 127.0.0.1 makes the
 *   attacker's page same-origin with itself, so the Origin check passes. The
 *   `Host` header still carries the hostile name, so only hosts on an
 *   allowlist are served at all.
 *
 * Non-browser clients (curl, the CLI, tests) send neither `Origin` nor
 * `Sec-Fetch-Site` and are allowed: they are not the threat this closes.
 * `FORGE_ALLOWED_HOSTS` (comma-separated host or host:port) extends the
 * allowlist for a deployment reached by another name.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(host: string): string {
  // "[::1]:3000" → "[::1]"; "localhost:3000" → "localhost".
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.split(":")[0] ?? host;
}

function allowedHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  if (LOCAL_HOSTS.has(hostname(h))) return true;
  const extra = (process.env.FORGE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(h) || extra.includes(hostname(h));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * No FORGE request is legitimately larger than this (attachments are capped
 * at 512 KB each). Route handlers buffer whole bodies, so the cap is applied
 * before one does. Chunked bodies without a length are left to the handlers.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export function middleware(request: NextRequest): NextResponse {
  const host = request.headers.get("host");
  if (!allowedHost(host)) {
    return NextResponse.json(
      { error: `Host "${host ?? ""}" is not allowed. Add it to FORGE_ALLOWED_HOSTS to serve FORGE under that name.` },
      { status: 403 },
    );
  }
  if (!SAFE_METHODS.has(request.method)) {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }
    const origin = request.headers.get("origin");
    if (origin !== null) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null;
      }
      // Same origin, or an origin the operator allowlisted (a reverse proxy
      // that rewrites Host sees the public name only in Origin).
      if (originHost !== host?.toLowerCase() && !(originHost && allowedHost(originHost) && !LOCAL_HOSTS.has(hostname(originHost)))) {
        return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
      }
    } else {
      const site = request.headers.get("sec-fetch-site");
      if (site !== null && site !== "same-origin" && site !== "none") {
        return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
      }
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };

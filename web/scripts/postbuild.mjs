/**
 * Post-build step for the standalone server (see DEPLOY.md).
 *
 * Next.js `output: standalone` does not bundle `.next/static` (CSS, client
 * JS) — the official Dockerfile copies it alongside. Without it the server
 * answers asset requests with the app page HTML, and the browser silently
 * drops the "stylesheet": a completely unstyled UI with zero errors.
 */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const from = join(root, ".next", "static");
const to = join(root, ".next", "standalone", "web", ".next", "static");

if (!existsSync(from)) {
  console.error("postbuild: .next/static missing — did `next build` succeed?");
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`postbuild: static assets -> ${to}`);

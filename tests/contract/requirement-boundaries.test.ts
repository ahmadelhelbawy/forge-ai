/**
 * `AC-053` / `RG-R6`: no model-reachable path into requirement governance,
 * linkage or the traceability matrix.
 *
 * Asserted structurally, the way `AC-050` is for the verification layer. The
 * governance layer decides lifecycle status and the linkage layer decides which
 * links are authoritative; a module a model boundary can reach importing either
 * would be one refactor away from a model recording a decision or a link. So
 * the importers are an explicit allowlist, each with its reason, and the
 * workspace's single entry point is itself kept out of the turn runtime.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every importer of the core layers, each with its reason. */
const ALLOWED_CORE_IMPORTERS: ReadonlyMap<string, string> = new Map([
  ["web/lib/requirements.ts", "the workspace's single entry point, behind user-action routes"],
]);

/** Every importer of the workspace entry point, each with its reason. */
const ALLOWED_WEB_IMPORTERS: ReadonlyMap<string, string> = new Map([
  ["web/app/api/conversations/[id]/requirements/route.ts", "GET the registry, POST a human decision"],
  ["web/app/api/conversations/[id]/repository/route.ts", "bind and unbind a repository"],
  ["web/app/api/conversations/[id]/traceability/route.ts", "the traceability matrix"],
  ["web/app/api/conversations/[id]/links/route.ts", "user-asserted advisory links"],
]);

const CORE_IMPORT = /from\s+["'][^"']*\/requirement\/(?:governance|linkage|traceability|binding)(?:\.js)?["']/;
const WEB_IMPORT = /from\s+["'](?:@\/lib\/requirements|[^"']*\/lib\/requirements|\.\/requirements)["']/;

/** Directories whose modules a model boundary can reach, or which run a model turn. */
const MODEL_REACHABLE = [
  "src/model/",
  "src/conversation/",
  "src/intent/",
  "src/candidate/",
  "src/critic/",
  "web/lib/turn/",
  "web/lib/chat.ts",
  "web/lib/candidates.ts",
  "web/lib/ai-provider.ts",
  "web/lib/store.ts",
  "web/lib/store/",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "web", "lib")), ...walk(join(ROOT, "web", "app"))].map(
  (f) => relative(ROOT, f).split(sep).join("/"),
);
const importersOf = (pattern: RegExp): string[] =>
  files.filter((rel) => pattern.test(readFileSync(join(ROOT, rel), "utf8")));

describe("RG-R6 — no model-reachable path into governance, linkage or traceability (AC-053)", () => {
  it("scans the core and the workspace", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("imports the core layers only from the documented surfaces", () => {
    const importers = importersOf(CORE_IMPORT).filter((rel) => !rel.startsWith("src/requirement/"));
    const offenders = importers.filter((rel) => !ALLOWED_CORE_IMPORTERS.has(rel));
    expect(offenders, `unexpected importers: ${offenders.join(", ")}`).toEqual([]);
    for (const rel of ALLOWED_CORE_IMPORTERS.keys()) {
      if (files.includes(rel)) expect(importers, `${rel} no longer imports the layer`).toContain(rel);
    }
  });

  it("imports the workspace entry point only from its own routes", () => {
    const importers = importersOf(WEB_IMPORT);
    const offenders = importers.filter((rel) => !ALLOWED_WEB_IMPORTERS.has(rel));
    expect(offenders, `unexpected importers of web/lib/requirements: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps every model-reachable module clear of both", () => {
    for (const rel of files.filter((f) => MODEL_REACHABLE.some((p) => f.startsWith(p)))) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(CORE_IMPORT.test(source), `${rel} imports the governance/linkage layer`).toBe(false);
      expect(WEB_IMPORT.test(source), `${rel} imports web/lib/requirements`).toBe(false);
    }
  });

  it("keeps the layers themselves free of anything model-facing", () => {
    for (const rel of files.filter((f) => f.startsWith("src/requirement/"))) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source, rel).not.toMatch(/from\s+["'][^"']*\/(model|conversation|intent|candidate)\//);
    }
  });
});

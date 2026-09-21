/**
 * `AC-050` / `EV-R1`: evidence is never model-authored.
 *
 * Asserted structurally, the same way `AC-020` is: the verification layer may
 * be imported only by the surfaces that read a user-supplied evidence file —
 * the CLI (which `forge explain --evidence` reuses), and the one workspace module (behind its route) that
 * accepts pasted evidence. Nothing a model boundary can reach (the conversation, intent
 * and model layers, the turn runtime, candidates, critics) imports it, so no
 * model output has a path into an evidence record or a verdict.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Every importer of the verification layer, each with its reason. */
const ALLOWED_IMPORTERS: ReadonlyMap<string, string> = new Map([
  ["src/cli/verify.ts", "`forge verify`: reads a package directory and a user-supplied evidence file"],
  ["web/lib/verify.ts", "the workspace's single entry point, over evidence the user pasted"],
]);

const IMPORT = /from\s+["'][^"']*\/verify\/(?:contract|evidence|obligations|verdict)(?:\.js)?["']/;

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

describe("EV-R1 — no model-reachable path into the verification layer (AC-050)", () => {
  const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "web", "lib")), ...walk(join(ROOT, "web", "app"))];

  it("scans the core and the workspace", () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it("is imported only by the documented evidence-reading surfaces", () => {
    const importers = files
      .map((f) => relative(ROOT, f).split(sep).join("/"))
      .filter((rel) => !rel.startsWith("src/verify/"))
      .filter((rel) => IMPORT.test(readFileSync(join(ROOT, rel), "utf8")));
    const offenders = importers.filter((rel) => !ALLOWED_IMPORTERS.has(rel));
    expect(offenders, `unexpected importers of src/verify: ${offenders.join(", ")}`).toEqual([]);
    // And the allowlist is not stale.
    for (const rel of ALLOWED_IMPORTERS.keys()) expect(importers, `${rel} no longer imports verify`).toContain(rel);
  });

  it("imports nothing model-facing from inside the verification layer", () => {
    for (const file of walk(join(ROOT, "src", "verify"))) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(ROOT, file)).not.toMatch(/from\s+["'][^"']*\/(model|conversation|intent|candidate)\//);
    }
  });
});

/**
 * Source-class → trust tier assignment (spec.md §13.2, SC-R1).
 *
 * Trust comes from FORGE-controlled source metadata — how a reference was
 * obtained — never from model claims (INV-016's sibling rule for retrieval).
 * `resolveTrust` (in `ir/trust.ts`) remains the single authority for what a
 * tier MEANS; this module decides which tier a retrieved source class gets.
 */
import type { TrustTier } from "../ir/vocabulary.js";

/**
 * Where retrieved material came from, as classified by FORGE itself:
 *
 * - `working-tree` — a file in the workspace, found by search or glob.
 * - `git-history` — a committed blob or log entry.
 * - `project-docs` — a working-tree file under a documentation path.
 * - `explicit` — a file the user named directly (`--file`). Still repository
 *   content: SC-R2 (vendored deps, PR branches) applies, so explicit
 *   selection does not promote trust.
 * - `forge-derived` — deterministic FORGE derivation, no external bytes.
 * - `web` / `issue` / `external` — outside the project. No v0.1 retriever
 *   produces these (spec.md §20 defers them); the mapping exists so the
 *   function is total and the tier cannot be invented later by accident.
 */
export type SourceClass =
  | "working-tree"
  | "git-history"
  | "project-docs"
  | "explicit"
  | "forge-derived"
  | "web"
  | "issue"
  | "external";

export function assignTrust(source: SourceClass): TrustTier {
  switch (source) {
    case "forge-derived":
      return "trusted";
    case "working-tree":
    case "git-history":
    case "project-docs":
    case "explicit":
      // Attributable, not safe (SC-R2). Repository content renders as
      // advisory (C052), never authoritative.
      return "semi_trusted";
    case "web":
    case "issue":
    case "external":
      return "untrusted";
  }
}

/** Documentation paths earn the `constraint_source` role candidacy (roles.ts). */
export function isDocumentationPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return (
    lower === "readme.md" ||
    lower.endsWith("/readme.md") ||
    lower.startsWith("docs/") ||
    lower === "docs" ||
    lower.endsWith(".md")
  );
}

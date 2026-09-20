/**
 * Scope-glob retriever (FR-025).
 *
 * Lists representable files under the IR's `scope.include` globs, minus
 * `scope.exclude`. Scope defines ADMISSIBILITY (the blast radius), not
 * relevance: a file under scope with no query-term match justifies nothing
 * and is dropped by `resolve.ts` as unjustified — recorded, never silent.
 * Justification still comes from term evidence, so INV-006 holds for every
 * retained reference.
 */

import { matchGlob, type WorkspaceGuard } from "../workspace.js";
import { isDocumentationPath } from "../trust.js";
import type { RetrieverResult } from "./types.js";

export function globSearch(
  guard: WorkspaceGuard,
  include: readonly string[],
  exclude: readonly string[],
): RetrieverResult {
  const all = guard.walk(".");
  const hits = [];
  for (const rel of all) {
    if (!include.some((g) => matchGlob(g, rel))) continue;
    if (exclude.some((g) => matchGlob(g, rel))) continue;
    hits.push({
      relPath: rel,
      matchedNodeIds: [] as string[],
      matchedTerms: [] as string[],
      viaScopeGlob: true as const,
      sourceClass: (isDocumentationPath(rel) ? "project-docs" : "working-tree") as
        | "project-docs"
        | "working-tree",
      gitRecency: null as number | null,
      foundVia: ["glob"] as const,
    });
  }
  hits.sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
  return {
    hits,
    notes: [`glob: ${hits.length} in-scope file(s) from ${include.length} include glob(s).`],
  };
}

/**
 * Lexical retriever over the working tree (FR-025).
 *
 * One ripgrep invocation per instruction node, with that node's terms as
 * fixed-string patterns. A file listed for node X's query justifies X BY
 * CONSTRUCTION (FR-026) — the retriever records which query found the file,
 * and `resolve.ts` confirms the exact matched terms from the guarded read.
 *
 * ripgrep honors `.gitignore` itself; every hit is still re-checked by
 * WorkspaceGuard on read (deny globs, `.forgeignore`, secrets). Discovery
 * is never access.
 */

import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";

import { rgPath } from "@vscode/ripgrep";

import type { NodeQuery } from "../query.js";
import type { CandidateHit, RetrieverResult } from "./types.js";

function isSafeRelPath(path: string): boolean {
  if (path === "" || isAbsolute(path)) return false;
  return !path.split("/").includes("..");
}

export function ripgrepSearch(root: string, queries: readonly NodeQuery[]): RetrieverResult {
  const byPath = new Map<string, Set<string>>();
  const notes: string[] = [];
  let binary: string;
  try {
    binary = rgPath;
  } catch (error) {
    throw new Error(
      `ripgrep binary unavailable: ${error instanceof Error ? error.message : String(error)}. ` +
        `Lexical retrieval cannot run without it; install "@vscode/ripgrep" platform binaries.`,
    );
  }
  for (const query of queries) {
    if (query.terms.length === 0) {
      notes.push(`ripgrep: query for ${query.nodeId} has no terms; node contributes no candidates.`);
      continue;
    }
    const patterns = query.terms.flatMap((term) => ["-e", term]);
    let stdout: string;
    try {
      stdout = execFileSync(
        binary,
        ["-l", "--no-messages", "--color=never", "-i", "-F", ...patterns, "--", "."],
        { cwd: root, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      // ripgrep exits 1 when nothing matches — a normal outcome, not a failure.
      const status = (error as { status?: number }).status;
      if (status === 1) continue;
      throw new Error(
        `ripgrep search failed for ${query.nodeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const line of stdout.split("\n")) {
      const rel = line.trim().replace(/^\.\//, "");
      if (rel === "" || !isSafeRelPath(rel)) continue;
      const nodes = byPath.get(rel) ?? new Set<string>();
      nodes.add(query.nodeId);
      byPath.set(rel, nodes);
    }
  }
  const hits: CandidateHit[] = [...byPath.entries()].map(([relPath, nodes]) => ({
    relPath,
    matchedNodeIds: [...nodes].sort(),
    matchedTerms: [],
    viaScopeGlob: false,
    sourceClass: "working-tree",
    gitRecency: null,
    foundVia: ["ripgrep"],
  }));
  hits.sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
  notes.push(`ripgrep: ${hits.length} candidate file(s) from ${queries.length} node queries.`);
  return { hits, notes };
}

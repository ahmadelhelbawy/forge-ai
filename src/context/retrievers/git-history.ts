/**
 * Git-history retriever (FR-025: "git history restricted to scope").
 *
 * Lists files touched by recent commits under the scope paths and scores
 * each by commit-position decay: the newest touching commit at index 0 gives
 * recency 1, older touches decay as 1/(1+index). Position-based, NOT
 * wall-clock-based — recency is deterministic for a fixed repository state
 * and needs no frozen clock (TS-R3).
 *
 * This retriever contributes DISCOVERY plus the `git` ranking signal.
 * Justification still comes from query-term evidence in `resolve.ts`: a
 * recently-touched file that matches no node query is dropped as
 * unjustified, like any scope-only candidate.
 *
 * A workspace that is not a git repository (or a host without git) yields
 * zero hits with a recorded note — an honestly reported absent source, not
 * a silent fallback.
 */

import { execFileSync } from "node:child_process";

import type { CandidateHit, RetrieverResult } from "./types.js";

export const GIT_HISTORY_COMMIT_CAP = 50;

export function gitHistorySearch(
  root: string,
  scopeInclude: readonly string[],
  maxCommits: number = GIT_HISTORY_COMMIT_CAP,
): RetrieverResult {
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["-C", root, "log", "--format=%H", "--name-only", "-n", String(maxCommits), "--", ...scopeInclude],
      { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
    return { hits: [], notes: [`git-history unavailable: ${detail}`] };
  }
  // Blocks of one commit hash followed by its touched paths.
  const firstSeen = new Map<string, number>();
  let commitIndex = -1;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      commitIndex += 1;
      continue;
    }
    if (commitIndex < 0) continue;
    const rel = trimmed.replace(/^\.\//, "");
    if (rel === "" || rel.split("/").includes("..")) continue;
    if (!firstSeen.has(rel)) firstSeen.set(rel, commitIndex);
  }
  const hits: CandidateHit[] = [...firstSeen.entries()].map(([relPath, index]) => ({
    relPath,
    matchedNodeIds: [],
    matchedTerms: [],
    viaScopeGlob: true,
    sourceClass: "git-history",
    gitRecency: 1 / (1 + index),
    foundVia: ["git-history"],
  }));
  hits.sort((a, b) => (a.relPath < b.relPath ? -1 : 1));
  return {
    hits,
    notes: [`git-history: ${hits.length} touched file(s) across recent commits in scope.`],
  };
}

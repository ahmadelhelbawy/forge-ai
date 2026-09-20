/**
 * Shared candidate types for the v0.1 retrievers (FR-025).
 *
 * v0.1 sources: working tree (ripgrep, glob), git history, explicit files.
 * Deferred (spec.md §20) — issues, web, external docs — need no new types:
 * they arrive as `CandidateHit` with an untrusted `SourceClass` when built.
 */

import type { SourceClass } from "../trust.js";

export type RetrieverId = "ripgrep" | "glob" | "git-history" | "explicit";

export interface CandidateHit {
  /** Workspace-relative, `/`-separated. */
  readonly relPath: string;
  /** Node ids whose query terms match the file's content. Sorted. */
  readonly matchedNodeIds: readonly string[];
  /** Union of query terms (across matched nodes) found in the file. Sorted. */
  readonly matchedTerms: readonly string[];
  /** True when the path falls under a scope include glob. */
  readonly viaScopeGlob: boolean;
  readonly sourceClass: SourceClass;
  /**
   * Position-decayed recency for git-history hits, 0..1. Null for every
   * other retriever — absence is explicit, never a silent zero-with-meaning.
   */
  readonly gitRecency: number | null;
  readonly foundVia: readonly RetrieverId[];
}

export interface RetrieverResult {
  readonly hits: readonly CandidateHit[];
  /**
   * Observable notes, recorded in the run instance: unavailable sources,
   * skipped entries, caps applied. A source that yields nothing always says
   * why — nothing degrades silently (INV-012).
   */
  readonly notes: readonly string[];
}

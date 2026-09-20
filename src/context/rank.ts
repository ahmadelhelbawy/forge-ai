/**
 * Deterministic candidate scoring (FR-027, docs/architecture.md §10.3).
 *
 *   score = w_lex · lexical_match_strength
 *         + w_role · role_prior
 *         + w_git · recency_in_git_within_scope
 *         + w_prox · proximity_to_scope_include
 *
 * Weights live in config with documented defaults; scores and their inputs
 * are RECORDED in the run instance (IR-R4, INV-013). The retained ContextRef
 * set is semantic; the numbers that selected it are not. No embeddings in
 * v0.1: the retrieval target is pointers, and lexical retrieval is
 * sufficient, explainable, and index-free.
 *
 * Sorting never uses locale collation (NFR-009): ties break by UTF-16
 * code-unit comparison, identical on every machine.
 */

import type { ContextRole } from "../ir/vocabulary.js";

export interface RankWeights {
  readonly lex: number;
  readonly role: number;
  readonly git: number;
  readonly prox: number;
}

/** Documented defaults. Custom weights are normalized by their sum. */
export const DEFAULT_WEIGHTS: RankWeights = {
  lex: 0.5,
  role: 0.2,
  git: 0.15,
  prox: 0.15,
};

/**
 * Prior per role, documented (FR-027: "inspectable"). `counter_example` has
 * no v0.1 assignment rule — it stays in the table so the function is total
 * over the closed role vocabulary rather than throwing on a legal input.
 */
export const ROLE_PRIORS: Readonly<Record<ContextRole, number>> = {
  definition: 1.0,
  constraint_source: 0.8,
  counter_example: 0.7,
  example: 0.6,
  background: 0.4,
};

export interface RankInput {
  /** Fraction of the node's query terms matched in the file, 0..1. */
  readonly lexical: number;
  readonly role: ContextRole;
  /** Position-decayed git recency, 0..1, or null when unavailable. */
  readonly git: number | null;
  /** Scope proximity, 0..1. */
  readonly proximity: number;
}

export interface RankParts {
  readonly lex: number;
  readonly role: number;
  readonly git: number;
  readonly prox: number;
}

export function scoreCandidate(input: RankInput, weights: RankWeights = DEFAULT_WEIGHTS): {
  score: number;
  parts: RankParts;
} {
  const total = weights.lex + weights.role + weights.git + weights.prox;
  if (!(total > 0)) throw new Error("Rank weights must sum to a positive number.");
  const parts: RankParts = {
    lex: input.lexical,
    role: ROLE_PRIORS[input.role],
    git: input.git ?? 0,
    prox: input.proximity,
  };
  const score =
    (weights.lex * parts.lex + weights.role * parts.role + weights.git * parts.git + weights.prox * parts.prox) /
    total;
  return { score, parts };
}

function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sort by score descending; ties break by path ascending (code units). */
export function rankCandidates<T>(
  items: readonly { readonly item: T; readonly relPath: string; readonly input: RankInput }[],
  weights: RankWeights = DEFAULT_WEIGHTS,
): { readonly item: T; readonly relPath: string; readonly score: number; readonly parts: RankParts }[] {
  return items
    .map(({ item, relPath, input }) => ({ item, relPath, ...scoreCandidate(input, weights) }))
    .sort((a, b) => b.score - a.score || comparePaths(a.relPath, b.relPath));
}

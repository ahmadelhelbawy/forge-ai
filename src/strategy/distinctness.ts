/**
 * Pairwise structural distinctness (FR-034, docs/architecture.md §11.5).
 *
 * Distance is structural, never stylistic: token-set distance over added
 * node statements, ordinal distance over autonomy levels and verification
 * intensity, normalized numeric distance over change budgets, and the
 * exploration tuple. A reworded duplicate scores near zero on every axis
 * and is rejected; genuinely different archetypes separate by a measured
 * margin (see DISTINCTNESS_THRESHOLD calibration below).
 *
 * Runs on DERIVED overlays (template + tuned params), never on raw
 * templates — tuning must not collapse two archetypes into each other.
 */
import { tokenize } from "../context/query.js";
import type { DerivedOverlay } from "./schema.js";
import { ASK_THRESHOLDS, AUTONOMY_LEVELS, VERIFICATION_INTENSITIES } from "./schema.js";

/**
 * Calibrated 2026-09-14 against the four shipped archetypes: minimum
 * pairwise distance 2.82 (rigorous–surgical), single-constraint reworded
 * duplicate 0.39. Threshold 1.0 rejects paraphrases while genuine pairs
 * clear it nearly 3x over; the distinctness test asserts both margins so
 * drift fails loudly.
 */
export const DISTINCTNESS_THRESHOLD = 1.0;

const ord = (levels: readonly string[], value: string): number => levels.indexOf(value);

function tokenSet(statements: readonly string[]): Set<string>[] {
  return statements.map((s) => new Set(tokenize(s)));
}

function statementSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Per-statement best-match distance, symmetric. A duplicate that rewords
 * one of two constraints still matches the other perfectly, so its
 * distance stays low; genuinely different sets match nothing well.
 */
function constraintSetDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setsA = tokenSet(a);
  const setsB = tokenSet(b);
  const best = (from: Set<string>[], to: Set<string>[]): number => {
    if (from.length === 0 || to.length === 0) return 0;
    return from.reduce((sum, s) => sum + Math.max(...to.map((t) => statementSimilarity(s, t))), 0) / from.length;
  };
  return 1 - (best(setsA, setsB) + best(setsB, setsA)) / 2;
}

/** Structural distance over derived overlays, 0 (identical) to 5 (maximal). */
export function overlayDistance(a: DerivedOverlay, b: DerivedOverlay): number {
  const constraintStatements = (o: DerivedOverlay): string[] => [
    ...o.template.added_constraints.map((c) => c.statement),
    ...o.template.added_verification.map((v) => `${v.spec} ${v.expected}`),
  ];
  const constraints = constraintSetDistance(constraintStatements(a), constraintStatements(b));
  const autonomy =
    (Math.abs(ord(AUTONOMY_LEVELS, a.template.autonomy.decision_authority) -
      ord(AUTONOMY_LEVELS, b.template.autonomy.decision_authority)) +
      Math.abs(ord(ASK_THRESHOLDS, a.template.autonomy.ask_threshold) -
        ord(ASK_THRESHOLDS, b.template.autonomy.ask_threshold))) / 2;
  const budget = Math.abs(a.template.change_budget.max_files - b.template.change_budget.max_files) / 14;
  const verification =
    Math.abs(ord(VERIFICATION_INTENSITIES, a.template.verification_intensity) -
      ord(VERIFICATION_INTENSITIES, b.template.verification_intensity)) / 2;
  const exploration =
    ((a.template.exploration.challenge_architecture === b.template.exploration.challenge_architecture ? 0 : 1) +
      Math.abs(a.template.exploration.require_alternatives - b.template.exploration.require_alternatives) / 5) / 2;
  return constraints + autonomy + budget + verification + exploration;
}

export interface DistinctnessPair {
  readonly a: string;
  readonly b: string;
  readonly distance: number;
}

export interface DistinctnessResult {
  readonly pairs: readonly DistinctnessPair[];
  /** Pairs at or below threshold: duplicates that must not both ship. */
  readonly rejected: readonly DistinctnessPair[];
}

/** All-pairs distance with threshold rejection. Deterministic. */
export function checkDistinctness(overlays: readonly DerivedOverlay[]): DistinctnessResult {
  const pairs: DistinctnessPair[] = [];
  for (let i = 0; i < overlays.length; i++) {
    for (let j = i + 1; j < overlays.length; j++) {
      const a = overlays[i] as DerivedOverlay;
      const b = overlays[j] as DerivedOverlay;
      pairs.push({ a: a.archetypeId, b: b.archetypeId, distance: overlayDistance(a, b) });
    }
  }
  pairs.sort((x, y) => x.distance - y.distance || (x.a < y.a ? -1 : 1));
  return { pairs, rejected: pairs.filter((p) => p.distance <= DISTINCTNESS_THRESHOLD) };
}

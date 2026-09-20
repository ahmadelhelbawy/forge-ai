/**
 * Lexicographic strategy ranking (FR-038, spec.md §10.3, DG-R6).
 *
 * No weights, no composite score (INV-008): candidates are compared by a
 * published rule order, and the output names WHICH step decided. Steps:
 * 1. any error-severity diagnostic disqualifies;
 * 2. fewer diagnostics in precedence order
 *    C002 → C001 → C050 → C080 → C041 → C040 → C070 → C010/C011;
 * 3. lower estimated token cost;
 * 4. configured archetype order.
 */
import type { Diagnostic } from "../ir/diagnostic.js";
import { ARCHETYPE_ORDER } from "../strategy/source.js";

export const RANK_PRECEDENCE = [
  "FORGE-C002",
  "FORGE-C001",
  "FORGE-C050",
  "FORGE-C080",
  "FORGE-C041",
  "FORGE-C040",
  "FORGE-C070",
  "FORGE-C010",
  "FORGE-C011",
] as const;

export interface RankEntry {
  readonly archetype: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly estTokens: number;
}

export interface RankOutcome {
  /** Ranked archetype ids, disqualified candidates excluded. */
  readonly order: readonly string[];
  /** Disqualified by step 1 (error-severity diagnostics). */
  readonly disqualified: readonly string[];
  /** Which rule step decided: first-step-that-differed, named. */
  readonly decidedBy: string;
}

const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === "error");

function countByCode(diagnostics: readonly Diagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of diagnostics) counts.set(d.code, (counts.get(d.code) ?? 0) + 1);
  return counts;
}

/** Rank compiled strategy candidates. Pure and total. */
export function rankStrategies(entries: readonly RankEntry[]): RankOutcome {
  const alive = entries.filter((e) => !hasErrors(e.diagnostics));
  const disqualified = entries.filter((e) => hasErrors(e.diagnostics)).map((e) => e.archetype);
  if (alive.length === 0) {
    return { order: [], disqualified, decidedBy: "all-disqualified" };
  }
  if (alive.length === 1) {
    return { order: [alive[0]!.archetype], disqualified, decidedBy: "sole-survivor" };
  }
  const counts = new Map(alive.map((e) => [e.archetype, countByCode(e.diagnostics)]));
  for (const code of RANK_PRECEDENCE) {
    const values = new Set(alive.map((e) => counts.get(e.archetype)!.get(code) ?? 0));
    if (values.size > 1) {
      const order = [...alive].sort(
        (a, b) => (counts.get(a.archetype)!.get(code) ?? 0) - (counts.get(b.archetype)!.get(code) ?? 0),
      );
      return { order: order.map((e) => e.archetype), disqualified, decidedBy: `fewer-${code}` };
    }
  }
  const tokens = new Set(alive.map((e) => e.estTokens));
  if (tokens.size > 1) {
    const order = [...alive].sort((a, b) => a.estTokens - b.estTokens);
    return { order: order.map((e) => e.archetype), disqualified, decidedBy: "lower-token-cost" };
  }
  const rank = new Map(ARCHETYPE_ORDER.map((id, i) => [id, i]));
  const order = [...alive].sort(
    (a, b) => (rank.get(a.archetype) ?? 999) - (rank.get(b.archetype) ?? 999),
  );
  return { order: order.map((e) => e.archetype), disqualified, decidedBy: "archetype-order" };
}

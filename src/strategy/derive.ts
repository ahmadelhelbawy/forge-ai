/**
 * Bounded parameter derivation (ST-R3, FR-032).
 *
 * Each archetype parameter names a CLOSED deriver plus [min,max] bounds;
 * derivation is a pure function of IR signals, clamped into range. No
 * model, no prose, no unbounded numbers reaching the overlay.
 */
import type { BlastRadius, RiskLevel } from "../ir/vocabulary.js";
import type { TaskIR } from "../ir/schema.js";
import type { ParamDeriver, StrategyArchetype } from "./schema.js";

const BLAST_FILES: Record<BlastRadius, number> = {
  file: 1,
  module: 3,
  package: 5,
  repo: 8,
  multi_repo: 8,
};

const RISK_PASSES: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 3,
};

const DERIVERS: Record<ParamDeriver, (ir: TaskIR) => number> = {
  from_blast_radius: (ir) => BLAST_FILES[ir.scope.blast_radius],
  from_scope_size: (ir) => 2000 + 500 * (ir.scope.include.length + ir.scope.exclude.length),
  from_scope_count: (ir) => ir.scope.include.length + ir.scope.exclude.length,
  from_risk: (ir) => RISK_PASSES[ir.risk.level],
  from_open_questions: (ir) => ir.open_questions.length,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Derive every parameter of one archetype, clamped into its declared
 * bounds. Returns values plus the signal each came from (for rationale).
 */
export function deriveParameters(
  archetype: StrategyArchetype,
  ir: TaskIR,
): { readonly params: Readonly<Record<string, number>>; readonly sources: Readonly<Record<string, string>> } {
  const params: Record<string, number> = {};
  const sources: Record<string, string> = {};
  for (const [name, spec] of Object.entries(archetype.parameters)) {
    const raw = DERIVERS[spec.derive](ir);
    params[name] = clamp(raw, spec.min, spec.max);
    sources[name] = `${spec.derive}=${raw}`;
  }
  return { params, sources };
}

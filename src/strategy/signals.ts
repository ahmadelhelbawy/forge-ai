/**
 * IR signal extraction for strategy fit (FR-032, docs/architecture.md §11.3).
 *
 * Pure functions of the Task IR (plus profile fields for profile signals):
 * risk level, hard-constraint profile, uncertainty counts, verification
 * kinds, blast radius, objective kind, context posture, target autonomy.
 * Fit rules match against these signals only — never against prose, scores,
 * or model output.
 */
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import type { ProfileSignals, StrategySignals } from "./schema.js";

export function extractSignals(ir: TaskIR): StrategySignals {
  const hard = ir.constraints.filter((c) => c.hardness === "hard");
  const blocking = ir.open_questions.filter((q) => q.blocking);
  return {
    risk_level: ir.risk.level,
    objective_kind: ir.objective.kind,
    blast_radius: ir.scope.blast_radius,
    hard_constraint_count: hard.length,
    hard_constraint_kinds: [...new Set(hard.map((c) => c.kind))].sort(),
    open_blocking_count: blocking.length,
    open_total_count: ir.open_questions.length,
    verification_kinds: [...new Set(ir.verification.map((v) => v.kind))].sort(),
    required_capabilities: [...ir.required_capabilities].sort(),
    context_ref_count: ir.context_refs.length,
    has_untrusted_context: ir.context_refs.some((r) => r.trust === "untrusted"),
  };
}

export function extractProfileSignals(profile: AgentProfile): ProfileSignals {
  return {
    autonomy: profile.autonomy.default,
    retrieval: profile.retrieval.autonomous_search,
    capabilities: Object.entries(profile.capabilities)
      .filter(([, v]) => v.level === "supported" || v.level === "conditional")
      .map(([k]) => k)
      .sort() as ProfileSignals["capabilities"],
  };
}

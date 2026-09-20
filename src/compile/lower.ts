/**
 * Stage 1 — Lower (docs/architecture.md §7).
 *
 * `EffectiveIR = apply(TaskIR, StrategyOverlay)`.
 *
 * Without an overlay lowering is the identity and every node's
 * `introduced_by` is its own `ir_node` origin. With one (P4), the IR passed
 * in is already the overlay-merged view from `applyOverlay`, and the
 * strategy origins supplied alongside it mark the overlay-added nodes —
 * every consumer, including `forge explain`, reads through this map.
 */
import type { TaskIR } from "../ir/schema.js";
import type { TraceOrigin } from "../trace/span.js";
import type { EffectiveIR, LegalizedVerification } from "./types.js";

/** Every node id an origin can refer to, including the two singletons. */
export function allNodeIds(ir: TaskIR): string[] {
  return [
    "objective",
    "scope",
    ...ir.goals.map((g) => g.id),
    ...ir.constraints.map((c) => c.id),
    ...ir.non_goals.map((n) => n.id),
    ...ir.verification.map((v) => v.id),
    ...ir.deliverables.map((d) => d.id),
    ...ir.assumptions.map((a) => a.id),
    ...ir.open_questions.map((q) => q.id),
    ...ir.context_refs.map((r) => r.id),
  ];
}

export function lower(
  ir: TaskIR,
  verification: readonly LegalizedVerification[],
  strategyIntroduced?: ReadonlyMap<string, TraceOrigin>,
): EffectiveIR {
  const introduced_by = new Map<string, TraceOrigin>();
  for (const id of allNodeIds(ir)) {
    introduced_by.set(id, { kind: "ir_node", node_id: id });
  }
  if (strategyIntroduced) {
    for (const [id, origin] of strategyIntroduced) introduced_by.set(id, origin);
  }
  return { ir, introduced_by, verification };
}

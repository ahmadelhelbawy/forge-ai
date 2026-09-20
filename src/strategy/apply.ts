/**
 * Overlay application: overlay ⊕ IR → merged IR + strategy origins (FR-018).
 *
 * Semantic safety is structural, not conventional. This module ONLY appends
 * constraints and verification steps sourced from the strategy id; it never
 * removes, modifies, or re-sources a base node, never touches scope,
 * non-goals, assumptions, questions, deliverables, or the objective, and
 * never mints trust — added nodes resolve `trusted` because first-party
 * archetype data is trusted input, exactly like `forge_derived`. Anything
 * violating these rules throws StrategyApplyError rather than compiling.
 *
 * The base TaskIR object is never mutated: the merged IR is a new object,
 * so `semanticHash` over the base is identical before and after, across
 * every strategy.
 */
import { parseTaskIR, type TaskIR } from "../ir/schema.js";
import type { TraceOrigin } from "../trace/span.js";
import type { DerivedOverlay } from "./schema.js";

export class StrategyApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyApplyError";
  }
}

export interface AppliedOverlay {
  /** Merged view: base nodes verbatim plus strategy-added nodes. */
  readonly ir: TaskIR;
  /** Strategy origins for added nodes (PV-R4). Base ids are absent. */
  readonly introduced: ReadonlyMap<string, TraceOrigin>;
}

function nextIds(ir: TaskIR, prefix: "c" | "v", count: number): string[] {
  let max = 0;
  const nodes = prefix === "c" ? ir.constraints : ir.verification;
  for (const n of nodes) {
    const match = new RegExp(`^${prefix}([0-9]+)$`).exec(n.id);
    if (match) max = Math.max(max, Number.parseInt(match[1] as string, 10));
  }
  return Array.from({ length: count }, (_, i) => `${prefix}${max + i + 1}`);
}

export function applyOverlay(ir: TaskIR, overlay: DerivedOverlay): AppliedOverlay {
  const constraintIds = nextIds(ir, "c", overlay.template.added_constraints.length);
  const verificationIds = nextIds(ir, "v", overlay.template.added_verification.length);
  const goalIds = new Set(ir.goals.map((g) => g.id));

  const addedConstraints = overlay.template.added_constraints.map((c, i) => ({
    id: constraintIds[i] as string,
    kind: c.kind,
    hardness: c.hardness,
    statement: c.statement,
    source_ref: overlay.strategyId,
  }));

  const addedVerification = overlay.template.added_verification.map((v, i) => {
    const satisfies = v.satisfies.includes("*") ? [...goalIds].sort() : [...v.satisfies];
    const dangling = satisfies.filter((id) => !goalIds.has(id));
    if (dangling.length > 0) {
      throw new StrategyApplyError(
        `Archetype "${overlay.archetypeId}" verification ${i} satisfies unknown goal(s): ${dangling.join(", ")}.`,
      );
    }
    return {
      id: verificationIds[i] as string,
      kind: v.kind,
      spec: v.spec,
      expected: v.expected,
      satisfies,
      source_ref: overlay.strategyId,
    };
  });

  const introduced = new Map<string, TraceOrigin>();
  addedConstraints.forEach((_, i) => {
    introduced.set(constraintIds[i] as string, {
      kind: "strategy",
      strategy_id: overlay.strategyId,
      overlay_path: `overlay_template.added_constraints[${i}]`,
    });
  });
  addedVerification.forEach((_, i) => {
    introduced.set(verificationIds[i] as string, {
      kind: "strategy",
      strategy_id: overlay.strategyId,
      overlay_path: `overlay_template.added_verification[${i}]`,
    });
  });

  // Collision is a code bug (ids allocate beyond the base max), not data:
  // fail loudly rather than silently replacing a node.
  for (const id of introduced.keys()) {
    if (
      ir.constraints.some((c) => c.id === id) ||
      ir.verification.some((v) => v.id === id)
    ) {
      throw new StrategyApplyError(`Overlay id allocation collided on "${id}".`);
    }
  }

  const merged = parseTaskIR({
    ...ir,
    constraints: [...ir.constraints, ...addedConstraints],
    verification: [...ir.verification, ...addedVerification],
  });
  return { ir: merged, introduced };
}

/**
 * Stage 3 — Materialization (FR-019, AD-2, docs/architecture.md §7).
 *
 * Decide, per context reference, HOW it reaches the target:
 *
 *   by_reference ← the target searches well (the DEFAULT)
 *   summary      ← the target searches weakly
 *   by_value     ← the target cannot search at all, or the reference must be exact
 *
 * BY REFERENCE IS THE DEFAULT AND INLINING IS A DEGRADATION. For an agent that
 * retrieves better than we do, pre-injecting file contents burns attention budget,
 * anchors it on our ranking guesses, and suppresses its own search. Emitting ranked
 * pointers plus what each is for is the better product, not the cheaper one.
 *
 * This stage decides only. Reading content is the context engine's job (P2).
 */
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import type { Materialization } from "./vocabulary.js";

export interface MaterializeOptions {
  /** Set by `degrade.inline_context` during legalization. */
  readonly forceInline: boolean;
}

/**
 * Roles whose value depends on exact wording, so a summary would lose the point.
 * A counter-example paraphrased is no longer a counter-example.
 */
const EXACTNESS_REQUIRED: ReadonlySet<string> = new Set(["counter_example"]);

export function materialize(
  ir: TaskIR,
  profile: AgentProfile,
  options: MaterializeOptions,
): Map<string, Materialization> {
  const decisions = new Map<string, Materialization>();
  const strength = profile.retrieval.autonomous_search;

  for (const ref of ir.context_refs) {
    let decision: Materialization;

    if (options.forceInline || strength === "none") {
      decision = "by_value";
    } else if (EXACTNESS_REQUIRED.has(ref.role)) {
      decision = "by_value";
    } else if (strength === "weak") {
      decision = "summary";
    } else {
      decision = "by_reference";
    }

    decisions.set(ref.id, decision);
  }

  return decisions;
}

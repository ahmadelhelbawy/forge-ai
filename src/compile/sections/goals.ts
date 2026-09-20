import { acceptanceKey } from "../compaction.js";
import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, bullet, heading, isDemoted, nodeOrigin, templateOrigin } from "./helpers.js";

/**
 * Goals in declaration order, which carries author priority (IR-R12).
 *
 * Semi-trusted goals are excluded and rendered by `advisory` instead (SC-R1). A goal
 * inferred from repository content is not something the author asked for, and presenting
 * it beside stated goals would flatten exactly the provenance the trust model exists to
 * preserve.
 */
export const goalsSection: SectionEmitter = {
  key: "goals",
  emit(input) {
    const goals = input.effective.ir.goals.filter((g) => !isDemoted(input, g.id));
    if (goals.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Goals");
    for (const goal of goals) {
      b.add(`- [${goal.id}] `, templateOrigin(input, "bullet_marker"))
        .add(goal.statement, nodeOrigin(goal.id))
        .add(` (${goal.priority})`, templateOrigin(input, "priority"))
        .gap("\n");
    }
    return b.build();
  },
};

/** Acceptance criteria, grouped under the goal they belong to. */
export const acceptanceSection: SectionEmitter = {
  key: "acceptance",
  emit(input) {
    // FR-051: a criterion that only repeats its own goal is not printed under
    // it. A goal whose every criterion is suppressed contributes no group at
    // all, so the heading is not emitted for an empty list either.
    const kept = (goal: { id: string; acceptance: readonly string[] }): string[] =>
      goal.acceptance.filter((_, i) => !input.compaction.acceptance.has(acceptanceKey(goal.id, i)));
    const withCriteria = input.effective.ir.goals.filter(
      (g) => kept(g).length > 0 && !isDemoted(input, g.id),
    );
    if (withCriteria.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Acceptance criteria");
    for (const goal of withCriteria) {
      b.add(`${goal.id}:`, templateOrigin(input, "group_label")).gap("\n");
      for (const criterion of kept(goal)) {
        bullet(b, input, criterion, nodeOrigin(goal.id), "  - ");
      }
    }
    return b.build();
  },
};

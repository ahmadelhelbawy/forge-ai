import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, heading, isDemoted, labelled, nodeOrigin, templateOrigin } from "./helpers.js";

/**
 * The task's objective and what "done" means, in the author's own terms.
 *
 * Declines to render when the objective itself resolves to `semi_trusted`: an objective
 * lifted out of repository content is not the author's stated intent, so it is relocated
 * to the advisory section (SC-R1 mechanism 2) rather than presented as the task. A
 * topology with no advisory destination then refuses via FORGE-C102, so the statement
 * cannot vanish.
 */
export const objectiveSection: SectionEmitter = {
  key: "objective",
  emit(input) {
    if (isDemoted(input, "objective")) return null;
    const { objective } = input.effective.ir;
    const b = new TracedTextBuilder();
    heading(b, input, "Objective");
    b.add(objective.statement, nodeOrigin("objective")).gap("\n\n");
    labelled(b, input, "**Done means**", objective.success_definition, nodeOrigin("objective"));
    b.gap("\n");
    b.add("Kind: ", templateOrigin(input, "label")).add(objective.kind, nodeOrigin("objective")).gap("\n");
    return b.build();
  },
};

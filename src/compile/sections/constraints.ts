import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, effectiveOrigin, heading, isDemoted, templateOrigin } from "./helpers.js";

/**
 * Constraints, hard first.
 *
 * INV-003: a hard constraint present in the EffectiveIR ALWAYS reaches the artifacts.
 * Nothing here may filter, truncate, or summarise one. Semi-trusted constraints are
 * removed from this section and rendered by `advisory` instead (SC-R1), which is a
 * relocation, not a drop — `advisory` is mandatory whenever any node is demoted.
 */
export const constraintsSection: SectionEmitter = {
  key: "constraints",
  emit(input) {
    const authoritative = input.effective.ir.constraints.filter(
      (c) => !isDemoted(input, c.id),
    );
    if (authoritative.length === 0) return null;

    const hard = authoritative.filter((c) => c.hardness === "hard");
    const soft = authoritative.filter((c) => c.hardness === "soft");

    const b = new TracedTextBuilder();
    heading(b, input, "Constraints");

    if (hard.length > 0) {
      b.add("These are hard constraints. Do not violate them:", templateOrigin(input, "hard_intro"))
        .gap("\n");
      for (const c of hard) {
        b.add(`- [${c.id}] `, templateOrigin(input, "bullet_marker"))
          .add(c.statement, effectiveOrigin(input, c.id))
          .add(` (${c.kind})`, templateOrigin(input, "kind"))
          .gap("\n");
      }
      if (soft.length > 0) b.gap("\n");
    }

    if (soft.length > 0) {
      b.add("Preferences, where they do not conflict with the above:", templateOrigin(input, "soft_intro"))
        .gap("\n");
      for (const c of soft) {
        b.add(`- [${c.id}] `, templateOrigin(input, "bullet_marker"))
          .add(c.statement, effectiveOrigin(input, c.id))
          .add(` (${c.kind})`, templateOrigin(input, "kind"))
          .gap("\n");
      }
    }

    return b.build();
  },
};

import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, heading, templateOrigin } from "./helpers.js";

/**
 * What this target can and cannot do, and what FORGE changed as a result.
 *
 * This section is the visible half of INV-012: every degradation the compiler applied
 * is stated in the artifact the agent reads, attributed to the named rule that applied
 * it. A degradation that appeared only in diagnostics would still be a silent one from
 * the agent's point of view.
 */
export const capabilityNotesSection: SectionEmitter = {
  key: "capability_notes",
  emit(input) {
    if (input.capabilityNotes.length === 0 && input.degradations.length === 0) return null;

    const b = new TracedTextBuilder();
    heading(b, input, "Environment notes");

    if (input.degradations.length > 0) {
      b.add("This task was adapted for this target:", templateOrigin(input, "degrade_intro")).gap("\n");
      for (const d of input.degradations) {
        b.add("- ", templateOrigin(input, "bullet_marker"))
          .add(d.effect, { kind: "compiler_rule", rule_id: d.rule_id })
          .add(" — ", templateOrigin(input, "separator"))
          .add(d.reason, { kind: "compiler_rule", rule_id: d.rule_id })
          .gap("\n");
      }
      if (input.capabilityNotes.length > 0) b.gap("\n");
    }

    if (input.capabilityNotes.length > 0) {
      b.add("Capabilities that may be unavailable at run time:", templateOrigin(input, "conditional_intro"))
        .gap("\n");
      for (const note of input.capabilityNotes) {
        b.add("- ", templateOrigin(input, "bullet_marker"))
          .add(note.capability, {
            kind: "agent_profile",
            profile_id: input.profile.id,
            profile_path: `capabilities.${note.capability}`,
          })
          .add(" — ", templateOrigin(input, "separator"))
          .add(note.note, {
            kind: "agent_profile",
            profile_id: input.profile.id,
            profile_path: `capabilities.${note.capability}.note`,
          });
        if (note.gates_verification) {
          b.add(" (a verification step depends on this)", templateOrigin(input, "gates_marker"));
        }
        b.gap("\n");
      }
    }

    return b.build();
  },
};

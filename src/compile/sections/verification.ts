import { acceptanceKey } from "../compaction.js";
import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, effectiveOrigin, heading, isDemoted, nodeOrigin, templateOrigin } from "./helpers.js";

const KIND_LABEL: Record<string, string> = {
  command: "run",
  test: "run",
  manual: "check by hand",
  review: "review",
};

/**
 * How the work will be checked.
 *
 * Renders the LEGALIZED verification list, which may differ in `kind` from the IR when
 * a degradation fired. Where it does, the change is stated in the artifact with a
 * `compiler_rule` origin — the reader sees that FORGE changed it, and why. Silently
 * rendering the degraded form would violate INV-012.
 *
 * Semi-trusted verification steps are excluded and rendered by `advisory` instead
 * (SC-R1): a check invented by repository content must not read as one the author asked
 * for, and "run this command" is among the most consequential things a poisoned file
 * could try to say.
 */
export const verificationSection: SectionEmitter = {
  key: "verification",
  emit(input) {
    // FR-051: an unobservable manual/review step whose spec and expected are
    // both already on the page is not printed again. A step the target degraded
    // is never eligible — removing it would hide the degradation (INV-012),
    // which is the opposite of what compaction is for.
    const entries = input.effective.verification.filter(
      (v) => !isDemoted(input, v.id) && !input.compaction.verification.has(v.id),
    );
    if (entries.length === 0) return null;

    const b = new TracedTextBuilder();
    heading(b, input, "Verification");

    for (const v of entries) {
      b.add(`- [${v.id}] `, templateOrigin(input, "bullet_marker"))
        .add(`${KIND_LABEL[v.kind] ?? v.kind}: `, templateOrigin(input, "kind_label"))
        .add(v.spec, effectiveOrigin(input, v.id))
        .gap("\n")
        .add("  Expect: ", templateOrigin(input, "expect_label"))
        .add(v.expected, effectiveOrigin(input, v.id))
        .gap("\n")
        .add("  Satisfies: ", templateOrigin(input, "satisfies_label"))
        .add(v.satisfies.join(", "), effectiveOrigin(input, v.id))
        .gap("\n");

      if (v.degraded_by !== null && v.degraded_from !== null) {
        b.add(
          `  Note: this was a \`${v.degraded_from}\` step. The target cannot execute it, ` +
            `so it is recorded for a human to run (${v.degraded_by}).`,
          { kind: "compiler_rule", rule_id: v.degraded_by },
        ).gap("\n");
      }
    }

    return b.build();
  },
};

/** Goals as an ordered checklist, for targets whose convention is task-driven. */
export const taskChecklistSection: SectionEmitter = {
  key: "task_checklist",
  emit(input) {
    const goals = input.effective.ir.goals.filter((g) => !isDemoted(input, g.id));
    if (goals.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Tasks");
    for (const goal of goals) {
      b.add("- [ ] ", templateOrigin(input, "checkbox"))
        .add(goal.statement, nodeOrigin(goal.id))
        .gap("\n");
      // FR-051: the same suppression as the acceptance section, for the same
      // reason — the checkbox directly above already says it. The GOAL's own
      // checkbox is never suppressed: an actionable list is what this section
      // is for, and removing its items would remove the section in all but name.
      goal.acceptance.forEach((criterion, index) => {
        if (input.compaction.acceptance.has(acceptanceKey(goal.id, index))) return;
        b.add("  - [ ] ", templateOrigin(input, "checkbox"))
          .add(criterion, nodeOrigin(goal.id))
          .gap("\n");
      });
    }
    return b.build();
  },
};

/**
 * Explicit stop conditions.
 *
 * Derived from hard constraints and the scope, but the *framing* is a property of the
 * target rather than of the task — some agents respond to explicit stop conditions and
 * some ignore them — so the framing text carries an `agent_profile` origin while each
 * condition keeps its IR node.
 */
export const stopConditionsSection: SectionEmitter = {
  key: "stop_conditions",
  emit(input) {
    const hard = input.effective.ir.constraints.filter(
      (c) => c.hardness === "hard" && !isDemoted(input, c.id),
    );
    const scopeIsAuthoritative = !isDemoted(input, "scope");
    // Nothing authoritative to stop on: rendering the framing alone would be a heading
    // with no content, and the demoted originals are carried by `advisory`.
    if (hard.length === 0 && !scopeIsAuthoritative) return null;

    const b = new TracedTextBuilder();
    heading(b, input, "Stop and ask");

    b.add("Stop and ask rather than proceeding if any of these becomes true:", {
      kind: "agent_profile",
      profile_id: input.profile.id,
      profile_path: "autonomy.default",
    }).gap("\n");

    for (const c of hard) {
      b.add("- Continuing would require violating ", templateOrigin(input, "stop_prefix"))
        .add(`[${c.id}] ${c.statement}`, effectiveOrigin(input, c.id))
        .gap("\n");
    }

    if (scopeIsAuthoritative) {
      b.add("- The change would extend beyond ", templateOrigin(input, "stop_prefix"))
        .add(input.effective.ir.scope.include.join(", "), nodeOrigin("scope"))
        .gap("\n");
    }

    return b.build();
  },
};

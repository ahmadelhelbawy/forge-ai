import type { SectionEmitter } from "../types.js";
import { TracedTextBuilder, bullet, heading, isDemoted, nodeOrigin, templateOrigin } from "./helpers.js";

/**
 * Paths in play, and the blast radius the author sanctioned.
 *
 * Declines when the scope resolves to `semi_trusted`: a scope inferred from repository
 * content is not an authorisation the author gave, and "work within these paths" is an
 * instruction (IR-R5). It is relocated to `advisory` instead (SC-R1).
 */
export const scopeSection: SectionEmitter = {
  key: "scope",
  emit(input) {
    if (isDemoted(input, "scope")) return null;
    const { scope } = input.effective.ir;
    const b = new TracedTextBuilder();
    heading(b, input, "Scope");

    b.add("Work within these paths:", templateOrigin(input, "include_intro")).gap("\n");
    for (const glob of scope.include) bullet(b, input, glob, nodeOrigin("scope"));

    if (scope.exclude.length > 0) {
      b.gap("\n").add("Do not touch:", templateOrigin(input, "exclude_intro")).gap("\n");
      for (const glob of scope.exclude) bullet(b, input, glob, nodeOrigin("scope"));
    }

    b.gap("\n")
      .add("Blast radius: ", templateOrigin(input, "label"))
      .add(scope.blast_radius, nodeOrigin("scope"))
      .gap("\n");

    return b.build();
  },
};

/** Things explicitly out of bounds. A negative instruction is still an instruction. */
export const nonGoalsSection: SectionEmitter = {
  key: "non_goals",
  emit(input) {
    const authoritative = input.effective.ir.non_goals.filter((n) => !isDemoted(input, n.id));
    if (authoritative.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Out of scope");
    b.add("Do not do any of the following, even if they seem helpful:", templateOrigin(input, "intro"))
      .gap("\n");
    for (const n of authoritative) {
      b.add(`- [${n.id}] `, templateOrigin(input, "bullet_marker"))
        .add(n.statement, nodeOrigin(n.id))
        .gap("\n");
    }
    return b.build();
  },
};

/** Deliverables: what must exist when the work is done. */
export const deliverablesSection: SectionEmitter = {
  key: "deliverables",
  emit(input) {
    // FR-051: a deliverable that only restates the objective is not printed
    // again. The objective is a mandatory section, so the words are still there.
    const deliverables = input.effective.ir.deliverables.filter(
      (d) => !isDemoted(input, d.id) && !input.compaction.deliverables.has(d.id),
    );
    if (deliverables.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Deliverables");
    for (const d of deliverables) {
      b.add(`- [${d.id}] `, templateOrigin(input, "bullet_marker"))
        .add(d.description, nodeOrigin(d.id))
        .add(` (${d.kind})`, templateOrigin(input, "kind"))
        .gap("\n");
    }
    return b.build();
  },
};

/**
 * Recorded assumptions, so the reader can correct a wrong one rather than discover it.
 *
 * Assumptions are INFLUENCE-BEARING (IR-R5): a premise the agent is told to work from
 * steers execution as surely as an instruction does. A semi-trusted assumption is
 * therefore excluded here and rendered by `advisory` with its source visible (SC-R1).
 * Before this filter existed, an assumption lifted from an untrusted page rendered at
 * `confidence: high` with no attribution and no diagnostic — the trust-laundering
 * channel this section was the exit for.
 */
export const assumptionsSection: SectionEmitter = {
  key: "assumptions",
  emit(input) {
    const assumptions = input.effective.ir.assumptions.filter((a) => !isDemoted(input, a.id));
    if (assumptions.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Assumptions");
    // States what an assumption IS, not what the user failed to say.
    //
    // This line used to read "These were assumed, not stated." That is a claim
    // about the user's own input, and the renderer has no way to check it: every
    // assumption carries a `source_ref`, and when extraction derives one from the
    // task text that ref is `user_input`. So the IR recorded "this came from what
    // the human typed" while the artifact asserted the opposite.
    //
    // It was not hypothetical. Given a request containing, verbatim, "all
    // existing tests must keep passing", extraction filed that requirement as a
    // medium-confidence assumption and this line told the agent it had never been
    // stated and should be corrected if wrong — inverting a requirement the user
    // had spelled out.
    //
    // `INV-016` reserves provenance statements to FORGE precisely so they can be
    // trusted, which makes a false one FORGE's defect rather than the model's.
    // The honest framing is forward-looking: these are what FORGE will act on
    // unless told otherwise. Detecting the demotion itself is a separate job,
    // done deterministically by `FORGE-W008` at the extraction boundary.
    b.add("FORGE is proceeding on these. Correct any that are wrong before starting:",
      templateOrigin(input, "intro")).gap("\n");
    for (const a of assumptions) {
      b.add(`- [${a.id}] `, templateOrigin(input, "bullet_marker"))
        .add(a.statement, nodeOrigin(a.id))
        .add(` (confidence: ${a.confidence})`, templateOrigin(input, "confidence"))
        .gap("\n");
    }
    return b.build();
  },
};

/**
 * Unresolved questions and the default each proceeds under.
 *
 * Influence-bearing for the same reason as assumptions: a question is rendered together
 * with the default the agent will act on, so a planted question steers execution.
 */
export const openQuestionsSection: SectionEmitter = {
  key: "open_questions",
  emit(input) {
    const questions = input.effective.ir.open_questions.filter((q) => !isDemoted(input, q.id));
    if (questions.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Open questions");
    for (const q of questions) {
      b.add(`- [${q.id}] `, templateOrigin(input, "bullet_marker"))
        .add(q.question, nodeOrigin(q.id));
      if (q.blocking) b.add(" **(blocking)**", templateOrigin(input, "blocking_marker"));
      b.gap("\n");
      if (q.options.length > 0) {
        b.add("  Options: ", templateOrigin(input, "options_label"))
          .add(q.options.join(" | "), nodeOrigin(q.id))
          .gap("\n");
      }
      if (q.default_assumption_ref !== null) {
        b.add("  Proceeding under ", templateOrigin(input, "default_label"))
          .add(q.default_assumption_ref, nodeOrigin(q.id))
          .add(" unless told otherwise.", templateOrigin(input, "default_suffix"))
          .gap("\n");
      }
    }
    return b.build();
  },
};

/** Soft process and style constraints, which read better as conventions than as rules. */
export const projectConventionsSection: SectionEmitter = {
  key: "project_conventions",
  emit(input) {
    const conventions = input.effective.ir.constraints.filter(
      (c) =>
        c.hardness === "soft" &&
        (c.kind === "process" || c.kind === "stylistic") &&
        !isDemoted(input, c.id),
    );
    if (conventions.length === 0) return null;
    const b = new TracedTextBuilder();
    heading(b, input, "Project conventions");
    for (const c of conventions) {
      b.add(`- [${c.id}] `, templateOrigin(input, "bullet_marker"))
        .add(c.statement, nodeOrigin(c.id))
        .gap("\n");
    }
    return b.build();
  },
};

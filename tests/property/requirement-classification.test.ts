/**
 * Requirement classification: a user-stated requirement must never be presented
 * as something the user did not say (V2-R, MUST-HAVE 1).
 *
 * The defect these tests lock out was found by the Product-Value Audit. Given a
 * request that contained, verbatim, "all existing tests must keep passing",
 * FORGE emitted that requirement under the heading
 *
 *     "These were assumed, not stated. Correct any that are wrong before proceeding:"
 *
 * as a medium-confidence assumption, with the instruction to "correct any that
 * are wrong". The artifact therefore told the agent that a requirement the user
 * had explicitly written was never stated and might be wrong. That is worse than
 * emitting no artifact at all.
 *
 * There are two independent failures there, and they are tested separately
 * because they live in different layers and have different fixes:
 *
 *  1. The RENDERER asserts a negative about the user's input that it cannot
 *     check. `INV-016` reserves provenance statements to FORGE — which makes a
 *     false one FORGE's fault, not the model's. Deterministic; no model needed
 *     to reproduce it.
 *  2. EXTRACTION demoted a stated requirement into an inference about that
 *     requirement. That is the model boundary's behaviour and is covered by the
 *     `FORGE-W008` detector and by `tests/boundaries/intent.extract.test.ts`.
 *
 * Everything here is deterministic: no provider, no cassette, no network.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import { builtinProfiles } from "../../src/profile/registry.js";

/**
 * The audit's E5 case, reduced to the smallest IR that reproduces it.
 *
 * The user's request stated three hard requirements. Extraction captured two as
 * constraints and turned the third into `a1` — an inference *about* the
 * requirement rather than the requirement — so the artifact carries it only as
 * an assumption. `a4` is the second half of the same defect: a statement the
 * user made, filed as a medium-confidence guess.
 *
 * `source_ref: "user_input"` on both is the part that makes the rendered claim
 * false. FORGE sets that field itself, from how the segment was obtained
 * (`src/ir/attribution.ts:47`) — a model cannot write it. So the IR records that
 * these came from the text the human typed, while the artifact says they were
 * "not stated".
 */
function demotedRequirementIr(): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: {
      statement: "Convert the auth module from callbacks to async/await",
      success_definition:
        "The auth module uses async/await internally and every existing caller and test is unaffected",
      kind: "refactor",
      source_ref: "user_input",
    },
    goals: [
      {
        id: "g1",
        statement: "Convert the auth module's internals from callbacks to async/await",
        priority: "must",
        acceptance: ["The module's internals use async/await"],
        source_ref: "user_input",
      },
      {
        id: "g2",
        statement: "Keep every existing test passing",
        priority: "must",
        acceptance: ["The existing test suite passes unmodified"],
        source_ref: "user_input",
      },
    ],
    constraints: [
      {
        id: "c1",
        kind: "compatibility",
        hardness: "hard",
        statement: "The public API of the auth module must not change",
        source_ref: "user_input",
      },
      {
        id: "c2",
        kind: "compatibility",
        hardness: "hard",
        statement: "A breaking change must not be shipped to the SDK",
        source_ref: "user_input",
      },
    ],
    non_goals: [],
    scope: {
      include: ["src/auth/**"],
      exclude: [],
      blast_radius: "module",
      source_ref: "user_input",
    },
    required_capabilities: ["run_tests"],
    context_refs: [],
    assumptions: [
      {
        id: "a1",
        statement:
          "The existing tests will not need to be modified, since the public API is unchanged",
        confidence: "medium",
        source_ref: "user_input",
      },
      {
        id: "a2",
        statement: "All existing tests must keep passing",
        confidence: "medium",
        source_ref: "user_input",
      },
    ],
    open_questions: [],
    verification: [
      {
        id: "v1",
        kind: "command",
        spec: "Run the repository's test suite",
        expected: "All existing tests pass",
        satisfies: ["g2"],
        source_ref: "user_input",
      },
    ],
    deliverables: [
      {
        id: "d1",
        description: "The auth module converted to async/await with its public API unchanged",
        kind: "code_change",
        source_ref: "user_input",
      },
    ],
    risk: { level: "medium", factors: ["40+ call sites depend on this module"] },
  });
}

function renderAll(ir: TaskIR, profileId = "claude-code"): string {
  const result = compile(ir, builtinProfiles().get(profileId), { taskSlug: "classification" });
  return result.artifacts.map((a) => a.content).join("\n");
}

describe("the renderer never asserts that user-derived content was not stated", () => {
  /**
   * The narrow regression. The exact sentence is asserted because the exact
   * sentence is what shipped and what misled: a reader of this test should be
   * able to see the defect, not just its category.
   */
  it("does not claim assumptions were 'not stated' (V2-R MUST-HAVE 1)", () => {
    const rendered = renderAll(demotedRequirementIr());
    expect(rendered).not.toContain("assumed, not stated");
  });

  /**
   * The general property, stated so a future rewording cannot reintroduce the
   * defect under different words: the artifact may not assert a NEGATIVE about
   * what the user said. FORGE holds the segment table, so it can say where
   * something came from; it cannot say what the user failed to say.
   */
  it("makes no negative claim about the user's input anywhere", () => {
    const rendered = renderAll(demotedRequirementIr()).toLowerCase();
    for (const claim of [
      "not stated",
      "you did not say",
      "the user did not",
      "was never stated",
      "unstated by the author",
    ]) {
      expect(rendered, `artifact asserts "${claim}" about the user's own input`).not.toContain(claim);
    }
  });

  /**
   * Compaction is not the fix here, and removing the section would hide the
   * problem rather than solve it: the user still needs to see and correct what
   * FORGE is proceeding under.
   */
  it("still renders the assumptions themselves", () => {
    const rendered = renderAll(demotedRequirementIr());
    expect(rendered).toContain("Assumptions");
    expect(rendered).toContain("All existing tests must keep passing");
    expect(rendered).toContain("confidence: medium");
  });

  /** The defect is profile-independent, so the guarantee must be too. */
  it("holds for every shipped profile that renders assumptions", () => {
    const ir = demotedRequirementIr();
    for (const id of builtinProfiles().ids) {
      const rendered = renderAll(ir, id).toLowerCase();
      expect(rendered, `profile ${id} asserts "not stated"`).not.toContain("not stated");
    }
  });
});

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
import { detectDemotedRequirements } from "../../src/intent/demotion.js";
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

/* -------------------------------------------------------------------------- */
/* Layer 2: detecting the demotion itself (FORGE-W008)                         */
/* -------------------------------------------------------------------------- */

/**
 * The renderer fix above stops FORGE asserting a falsehood. It does not stop
 * the demotion — the artifact still carries a stated requirement as a guess,
 * just without the lie on top. Catching the demotion needs the original text,
 * which only the extraction boundary has.
 *
 * `detectDemotedRequirements` is that check, and its whole design is a refusal
 * to overreach. It REPORTS; it never repairs. Promoting `a2` into a constraint
 * would mean inventing a `hardness` and a `kind` the user never gave, which is
 * exactly the fabrication rule 1 of the extraction prompt forbids — and, unlike
 * the model, a deterministic function has no basis at all for guessing them.
 * So the output is a diagnostic and the IR is returned untouched.
 *
 * It is also deliberately hard to trigger. A false `FORGE-W008` trains users to
 * ignore diagnostics, which costs more than the misses: the detector requires a
 * deontic modal in the user's own sentence, requires the carrier to restate that
 * sentence closely, and stays silent the moment any requirement-bearing node
 * covers the same words.
 */

/** The user's own words, from the audit's E5 case. */
const E5_TEXT = [
  "Convert the auth module from callbacks to async/await.",
  "The public API must not change and we cannot ship a breaking change to the SDK.",
  "All existing tests must keep passing.",
].join(" ");

/**
 * E5 as it actually came out of extraction: the third requirement reached the
 * IR only as `a2`, a medium-confidence assumption. No goal, no constraint, no
 * verification covers it — which is the difference between this fixture and
 * `demotedRequirementIr()` above, where `g2` and `v1` do cover it.
 */
function demotionOnlyIr(): TaskIR {
  const base = demotedRequirementIr();
  return parseTaskIR({
    ...base,
    goals: base.goals.filter((g) => g.id !== "g2"),
    verification: [],
    objective: {
      ...base.objective,
      success_definition: "The auth module uses async/await internally",
    },
  });
}

describe("FORGE-W008 detects a stated requirement that reached the IR only as a guess", () => {
  it("fires when the user's requirement survives only as an assumption", () => {
    const found = detectDemotedRequirements(E5_TEXT, demotionOnlyIr());
    expect(found.map((d) => d.code)).toContain("FORGE-W008");
  });

  it("names the code, severity and source the catalogue declares", () => {
    const [found] = detectDemotedRequirements(E5_TEXT, demotionOnlyIr());
    expect(found).toBeDefined();
    expect(found!.code).toBe("FORGE-W008");
    expect(found!.name).toBe("stated_requirement_demoted");
    // Warning, not error: `--strict` promotes warnings to failures, so an error
    // here would break previously-succeeding runs on a detector whose
    // false-positive rate has not yet been measured.
    expect(found!.severity).toBe("warning");
    expect(found!.source).toBe("deterministic");
  });

  /** INV-007: a finding a reader cannot check independently is not a finding. */
  it("cites the node that carries the demoted requirement", () => {
    const ir = demotionOnlyIr();
    const [found] = detectDemotedRequirements(E5_TEXT, ir);
    const ids = new Set([...ir.assumptions.map((a) => a.id), ...ir.open_questions.map((q) => q.id)]);
    expect(found!.evidence.length).toBeGreaterThan(0);
    const cited = found!.evidence.filter((e) => e.kind === "node");
    expect(cited.length).toBeGreaterThan(0);
    for (const e of cited) {
      expect(ids, `cites node ${(e as { node_id: string }).node_id}, which is not a carrier in this IR`).toContain(
        (e as { node_id: string }).node_id,
      );
    }
  });

  /** The message must quote the user, so the reader can check the claim themselves. */
  it("quotes the user's own sentence in the message", () => {
    const [found] = detectDemotedRequirements(E5_TEXT, demotionOnlyIr());
    expect(found!.message.toLowerCase()).toContain("all existing tests must keep passing");
  });

  it("stays silent when a goal already carries the same requirement", () => {
    // `demotedRequirementIr()` keeps `g2` ("Keep every existing test passing").
    // The requirement reached the artifact; that it ALSO appears as an
    // assumption is redundancy, not demotion, and W008 is not a redundancy check.
    expect(detectDemotedRequirements(E5_TEXT, demotedRequirementIr())).toEqual([]);
  });

  it("stays silent when a constraint carries the requirement in different words", () => {
    const ir = demotionOnlyIr();
    const covered = parseTaskIR({
      ...ir,
      constraints: [
        ...ir.constraints,
        {
          id: "c3",
          kind: "compatibility",
          hardness: "hard",
          statement: "Every existing test must keep passing",
          source_ref: "user_input",
        },
      ],
    });
    expect(detectDemotedRequirements(E5_TEXT, covered)).toEqual([]);
  });

  /**
   * The conservatism that keeps this usable. An assumption about something the
   * user mentioned without any obligation attached is an ordinary assumption —
   * the model is supposed to make those, and rule 2 of the extraction prompt
   * tells it to.
   */
  it("ignores assumptions with no deontic modal behind them in the user's text", () => {
    const text = "Convert the auth module from callbacks to async/await. The module is large.";
    const ir = demotionOnlyIr();
    expect(detectDemotedRequirements(text, ir)).toEqual([]);
  });

  /** An open question is the other way a requirement can be demoted. */
  it("fires when the requirement survives only as an open question", () => {
    const ir = demotionOnlyIr();
    const asQuestion = parseTaskIR({
      ...ir,
      assumptions: ir.assumptions.filter((a) => a.id !== "a2"),
      open_questions: [
        {
          id: "q1",
          question: "Must all existing tests keep passing?",
          options: [],
          default_assumption_ref: null,
          blocking: false,
          source_ref: "user_input",
        },
      ],
    });
    const found = detectDemotedRequirements(E5_TEXT, asQuestion);
    expect(found.map((d) => d.code)).toContain("FORGE-W008");
    expect(found[0]!.evidence).toContainEqual({ kind: "node", node_id: "q1" });
  });

  /**
   * The non-negotiable half of "detect and report only". Auto-promotion would
   * have to invent `hardness` and `kind`, which is fabrication (extraction rule
   * 1) and, done deterministically, a guess with no evidence behind it at all.
   */
  it("never modifies the IR it inspects", () => {
    const ir = demotionOnlyIr();
    const before = JSON.stringify(ir);
    detectDemotedRequirements(E5_TEXT, ir);
    expect(JSON.stringify(ir)).toBe(before);
  });

  it("is silent on an IR with no assumptions or open questions at all", () => {
    const ir = parseTaskIR({ ...demotionOnlyIr(), assumptions: [], open_questions: [] });
    expect(detectDemotedRequirements(E5_TEXT, ir)).toEqual([]);
  });

  /** Determinism: same inputs, same findings, in the same order (NFR-001). */
  it("is deterministic", () => {
    const ir = demotionOnlyIr();
    expect(detectDemotedRequirements(E5_TEXT, ir)).toEqual(detectDemotedRequirements(E5_TEXT, ir));
  });
});

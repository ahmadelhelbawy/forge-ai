/**
 * Compaction (V2-R, FR-051): suppressing lines that restate what the artifact
 * already says, without ever changing what the artifact means.
 *
 * The audit measured real artifacts at 400–780 words with substantial
 * repetition, most of it MODEL-AUTHORED — a goal's acceptance criterion that
 * says the goal again, a deliverable that restates the objective, a `manual`
 * verification step with no observable check whose spec and expected are both
 * already on the page. The renderer cannot rewrite that content (it is the
 * user's, via the model) but it can decline to print it twice.
 *
 * The danger is obvious and is why these tests exist before the feature. The
 * presence rule of §22.8 — contiguous token containment — is what the pinned
 * requirement ledger uses to decide whether a requirement survived. If
 * compaction removes tokens, a pinned requirement that was present can become
 * absent, and FORGE would be silently breaking the one guarantee it makes
 * loudest. So:
 *
 *   R5. Compaction changes no `isPresent()` verdict, for any pinned text, ever.
 *   R6. `Constraints` and `stop_conditions` are byte-identical with and without
 *       it, and compilation stays deterministic.
 *
 * R5 is tested EMPIRICALLY rather than by arguing from the implementation: both
 * artifacts are compiled, and every candidate phrase that was present before
 * must still be present after. An argument about contiguity is exactly the kind
 * of reasoning that is right until it is not.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { isPresent } from "../../src/critic/deterministic/ledger.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import { builtinProfiles } from "../../src/profile/registry.js";

/**
 * An IR carrying every kind of redundancy the whitelist covers, so one fixture
 * exercises all four categories:
 *
 *  - `g1`'s acceptance criterion restates `g1`.
 *  - `d1` restates the objective.
 *  - `v2` is a `manual` step whose spec and expected are both already on the page.
 *
 * `g2` is the control in every category: its criterion adds a real condition
 * ("three consecutive runs"), and nothing about it may be touched.
 */
function redundantIr(): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: {
      statement: "Convert the auth module from callbacks to async/await",
      success_definition: "The auth module uses async/await internally",
      kind: "refactor",
      source_ref: "user_input",
    },
    goals: [
      {
        id: "g1",
        statement: "Convert the auth module from callbacks to async/await",
        priority: "must",
        // Says the goal again, word for word, and nothing else.
        acceptance: ["Convert the auth module from callbacks to async/await"],
        source_ref: "user_input",
      },
      {
        id: "g2",
        statement: "Keep the existing test suite passing",
        priority: "must",
        acceptance: ["The suite passes on three consecutive runs"],
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
        kind: "process",
        hardness: "soft",
        // Deliberately a restatement of g2. Constraints are exempt: this line
        // must survive compaction even though it is redundant by every measure
        // the whitelist uses.
        statement: "Keep the existing test suite passing",
        source_ref: "user_input",
      },
    ],
    non_goals: [],
    scope: { include: ["src/auth/**"], exclude: [], blast_radius: "module", source_ref: "user_input" },
    required_capabilities: ["run_tests"],
    context_refs: [],
    assumptions: [],
    open_questions: [],
    verification: [
      {
        id: "v1",
        kind: "test",
        spec: "Run the repository's test suite",
        expected: "The suite passes on three consecutive runs",
        satisfies: ["g2"],
        source_ref: "user_input",
      },
      {
        id: "v2",
        kind: "review",
        spec: "Convert the auth module from callbacks to async/await",
        expected: "The auth module uses async/await internally",
        satisfies: ["g1"],
        source_ref: "user_input",
      },
    ],
    deliverables: [
      {
        id: "d1",
        // Restates objective.statement exactly.
        description: "Convert the auth module from callbacks to async/await",
        kind: "code_change",
        source_ref: "user_input",
      },
      {
        id: "d2",
        description: "A migration note for the SDK team describing the new call shape",
        kind: "doc",
        source_ref: "user_input",
      },
    ],
    risk: { level: "medium", factors: [] },
  });
}

const PROFILES = builtinProfiles();

function render(ir: TaskIR, profileId: string, compact: boolean): string {
  const result = compile(ir, PROFILES.get(profileId), { taskSlug: "compaction", compact });
  return result.artifacts.map((a) => `${a.path}\n${a.content}`).join("\n");
}

/**
 * Every phrase a user could plausibly have pinned, drawn from the IR itself.
 * Anything present in the uncompacted artifact must still be present after.
 */
function pinnableTexts(ir: TaskIR): string[] {
  return [
    ir.objective.statement,
    ir.objective.success_definition,
    ...ir.goals.flatMap((g) => [g.statement, ...g.acceptance]),
    ...ir.constraints.map((c) => c.statement),
    ...ir.non_goals.map((n) => n.statement),
    ...ir.scope.include,
    ...ir.verification.flatMap((v) => [v.spec, v.expected]),
    ...ir.deliverables.map((d) => d.description),
  ];
}

describe("R5 — compaction never changes a presence verdict", () => {
  it("keeps every pinnable phrase present, on every profile", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      const full = render(ir, id, false);
      const compacted = render(ir, id, true);
      for (const text of pinnableTexts(ir)) {
        if (!isPresent(full, text)) continue; // Never rendered here; nothing to preserve.
        expect(
          isPresent(compacted, text),
          `profile ${id}: compaction removed "${text}" from the artifact`,
        ).toBe(true);
      }
    }
  });

  /**
   * The general form, so a future whitelist entry cannot quietly break it: the
   * guarantee is about the presence rule, not about the phrases this fixture
   * happens to contain. Every suppressed line's own text must survive as a
   * presence match somewhere in what ships — that is the condition under which
   * suppression is permitted at all.
   */
  it("leaves the suppressed text itself present in the compacted artifact", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      const full = render(ir, id, false);
      const compacted = render(ir, id, true);
      expect(compacted.length, `profile ${id}`).toBeLessThanOrEqual(full.length);
      const suppressed = compile(ir, PROFILES.get(id), { taskSlug: "compaction" }).diagnostics.filter(
        (d) => d.code === "FORGE-C103",
      );
      for (const d of suppressed) {
        const quoted = /"([^"]+)"/.exec(d.message)?.[1];
        expect(quoted, `FORGE-C103 must quote the withheld text: ${d.message}`).toBeDefined();
        expect(isPresent(compacted, quoted!), `profile ${id}: "${quoted}" left the artifact`).toBe(true);
      }
    }
  });
});

describe("R6 — the exempt sections and determinism", () => {
  it("never removes a line from Constraints, even a redundant one", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      const compacted = render(ir, id, true);
      for (const c of ir.constraints) {
        expect(isPresent(compacted, c.statement), `profile ${id}: constraint ${c.id} lost`).toBe(true);
      }
    }
  });

  /**
   * `stop_conditions` is a renderer restatement of hard constraints and scope —
   * the most obviously "redundant" section FORGE emits, and exempt by decision.
   * It exists so an agent that ignores a constraint in one framing sees it in
   * another, which is worth more than the words it costs.
   */
  it("leaves stop_conditions byte-identical", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      const full = render(ir, id, false);
      const compacted = render(ir, id, true);
      const stop = (text: string): string => {
        const at = text.indexOf("Stop and ask");
        if (at < 0) return "";
        const rest = text.slice(at);
        const end = rest.indexOf("\n\n\n");
        return end < 0 ? rest : rest.slice(0, end);
      };
      expect(stop(compacted), `profile ${id}: stop_conditions changed`).toBe(stop(full));
    }
  });

  it("is deterministic: the same IR and profile compile to the same bytes", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      expect(render(ir, id, true)).toBe(render(ir, id, true));
    }
  });

  /** INV-012: a removal nobody is told about is exactly what this forbids. */
  it("emits FORGE-C103 for every suppression, citing the node", () => {
    const result = compile(redundantIr(), PROFILES.get("claude-code"), { taskSlug: "compaction" });
    const suppressions = result.diagnostics.filter((d) => d.code === "FORGE-C103");
    expect(suppressions.length).toBeGreaterThan(0);
    for (const d of suppressions) {
      expect(d.severity).toBe("info");
      expect(d.source).toBe("deterministic");
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence.some((e) => e.kind === "node")).toBe(true);
    }
  });

  /** A control: nothing redundant, nothing suppressed, nothing said. */
  it("suppresses nothing and says nothing when there is no repetition", () => {
    const ir = parseTaskIR({
      ...redundantIr(),
      goals: [
        {
          id: "g1",
          statement: "Convert the auth module from callbacks to async/await",
          priority: "must",
          acceptance: ["No callback remains in src/auth"],
          source_ref: "user_input",
        },
      ],
      verification: [
        {
          id: "v1",
          kind: "test",
          spec: "Run the repository's test suite",
          expected: "Every test passes",
          satisfies: ["g1"],
          source_ref: "user_input",
        },
      ],
      deliverables: [
        {
          id: "d1",
          description: "A migration note for the SDK team describing the new call shape",
          kind: "doc",
          source_ref: "user_input",
        },
      ],
    });
    for (const id of PROFILES.ids) {
      const result = compile(ir, PROFILES.get(id), { taskSlug: "compaction" });
      expect(
        result.diagnostics.filter((d) => d.code === "FORGE-C103"),
        `profile ${id} suppressed something from a non-redundant IR`,
      ).toEqual([]);
      expect(render(ir, id, true)).toBe(render(ir, id, false));
    }
  });

  /**
   * INV-003 is not negotiable and is checked by its own gate, so this asserts
   * the gate stays quiet rather than re-deriving it: compaction must never
   * cause a dropped-constraint or uncovered-goal finding.
   */
  it("introduces no coverage or preservation failure", () => {
    const ir = redundantIr();
    for (const id of PROFILES.ids) {
      const result = compile(ir, PROFILES.get(id), { taskSlug: "compaction" });
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes, `profile ${id}`).not.toContain("FORGE-C002");
      expect(codes, `profile ${id}`).not.toContain("FORGE-C100");
    }
  });
});

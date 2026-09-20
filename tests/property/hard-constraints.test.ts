/**
 * Hard constraint preservation — AC-004, INV-003, FORGE-C002.
 *
 * A hard constraint present in the EffectiveIR must reach the rendered artifacts, for
 * EVERY profile. Budgeting, degradation and rendering may reshape a package; none of
 * them may drop an instruction the author marked as non-negotiable.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { checkConstraintPreservation } from "../../src/critic/deterministic/index.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { clone, loadFixture, readFixtureRaw } from "../helpers/fixtures.js";
import { parseTaskIR } from "../../src/ir/schema.js";

const registry = builtinProfiles();

describe("every hard constraint survives every profile", () => {
  const ir = loadFixture("empty-state");
  const hard = ir.constraints.filter((c) => c.hardness === "hard");

  for (const profile of registry.all) {
    it(`${profile.id} renders all ${hard.length} hard constraints`, () => {
      const result = compile(ir, registry.get(profile.id), { taskSlug: "empty-state" });
      expect(result.refused).toBe(false);

      const traced = new Set(
        result.spans
          .filter((s) => s.origin.kind === "ir_node")
          .map((s) => (s.origin as { node_id: string }).node_id),
      );
      for (const c of hard) {
        expect(traced.has(c.id), `${c.id} has no span in ${profile.id}`).toBe(true);
      }
      expect(codesOf(result.diagnostics)).not.toContain("FORGE-C002");
    });
  }
});

describe("a semi-trusted hard constraint is relocated, not dropped", () => {
  it("appears in the advisory section with its provenance visible", () => {
    const raw = clone(readFixtureRaw("empty-state")) as Record<string, unknown>;
    // Promote the semi-trusted constraint to `hard` so the relocation is unmistakable.
    (raw["constraints"] as Array<Record<string, unknown>>)[2]!["hardness"] = "hard";
    const ir = parseTaskIR(raw);

    const result = compile(ir, registry.get("claude-code"), { taskSlug: "empty-state" });
    const all = result.artifacts.map((a) => a.content).join("\n");

    expect(all).toContain("Advisory (derived from repository content, not user-stated)");
    expect(all).toContain("Use the existing spacing and typography tokens");
    // Relocation still counts as rendered: no dropped-constraint diagnostic.
    expect(codesOf(result.diagnostics)).not.toContain("FORGE-C002");
    // And it is NOT presented as an authoritative hard constraint.
    const prompt = result.artifacts.find((a) => a.path === "PROMPT.md")!.content;
    const hardBlock = prompt.slice(prompt.indexOf("These are hard constraints"), prompt.indexOf("## "  , prompt.indexOf("These are hard constraints")));
    expect(hardBlock).not.toContain("spacing and typography tokens");
  });
});

describe("FORGE-C002 fires when a hard constraint really is missing", () => {
  it("detects an unrendered hard constraint", () => {
    const ir = loadFixture("empty-state");
    // No spans at all: every hard constraint is unrendered.
    const diagnostics = checkConstraintPreservation(ir, []);
    const hard = ir.constraints.filter((c) => c.hardness === "hard");
    expect(diagnostics).toHaveLength(hard.length);
    expect(codesOf(diagnostics).every((c) => c === "FORGE-C002")).toBe(true);
  });

  it("passes when every hard constraint has a span", () => {
    const ir = loadFixture("empty-state");
    const spans = ir.constraints
      .filter((c) => c.hardness === "hard")
      .map((c, i) => ({
        artifact_path: "a.md",
        start: i * 10,
        end: i * 10 + 5,
        origin: { kind: "ir_node" as const, node_id: c.id },
      }));
    expect(checkConstraintPreservation(ir, spans)).toEqual([]);
  });
});

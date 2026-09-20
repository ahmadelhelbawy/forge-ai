/**
 * The extension contract — AC-017, NFR-004, AP-R1.
 *
 * "Adding a compatible agent should require profile data, not core TypeScript changes."
 *
 * This test is the executable form of that claim. It loads a profile the compiler has
 * never heard of, from a directory outside `profiles/`, naming a target that does not
 * exist — and compiles a real task for it. Nothing in `src/` mentions it. If this ever
 * requires a code change to keep passing, the extensibility claim has become false and
 * the architecture, not the test, is what needs fixing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { REGISTERED_OVERRIDES } from "../../src/compile/compile.js";
import { checkFidelity } from "../../src/critic/deterministic/index.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { loadProfilesFrom } from "../../src/profile/registry.js";
import { analyseCoverage } from "../../src/trace/coverage.js";
import { REPO_ROOT, loadFixture } from "../helpers/fixtures.js";

const SYNTHETIC_DIR = join(REPO_ROOT, "fixtures", "profiles");

describe("a target FORGE has never heard of compiles with zero code changes", () => {
  const registry = loadProfilesFrom(SYNTHETIC_DIR);
  const profile = registry.get("synthetic-agent");
  const ir = loadFixture("empty-state");
  const result = compile(ir, profile, { taskSlug: "empty-state" });

  it("loads and validates from a directory outside profiles/", () => {
    // `lossy-agent` shares the directory as the FORGE-C102 fixture; both are loaded and
    // validated as data the compiler has never heard of.
    expect(registry.ids).toEqual(["lossy-agent", "synthetic-agent"]);
    expect(profile.display_name).toBe("Synthetic Agent");
  });

  it("compiles without refusal", () => {
    expect(result.refused, codesOf(result.diagnostics).join(",")).toBe(false);
  });

  it("honours its declared multi-file topology and templated paths", () => {
    expect(result.artifacts.map((a) => a.path).sort()).toEqual([
      "synthetic/empty-state/brief.md",
      "synthetic/empty-state/notes.md",
    ]);
  });

  it("honours its declared section ORDER, which no shipped profile uses", () => {
    const brief = result.artifacts.find((a) => a.path.endsWith("brief.md"))!.content;
    // Declared as deliverables → objective → constraints → goals.
    expect(brief.indexOf("## Deliverables")).toBeLessThan(brief.indexOf("## Objective"));
    expect(brief.indexOf("## Objective")).toBeLessThan(brief.indexOf("## Constraints"));
    expect(brief.indexOf("## Constraints")).toBeLessThan(brief.indexOf("## Goals"));
  });

  it("applies capability legalization from its declared capabilities", () => {
    // It declares shell and run_tests absent, so the executable step degrades.
    expect(result.degradations.map((d) => d.rule_id)).toContain("degrade.command_to_manual");
    // The artifact states the EFFECT in plain language; the rule id lives in the
    // diagnostics and the trace. The agent needs to know what changed, not our id.
    const notes = result.artifacts.find((a) => a.path.endsWith("notes.md"))!.content;
    expect(notes).toContain("executable verification steps are recorded as manual checks");
  });

  it("applies materialization from its declared retrieval strength", () => {
    // autonomous_search: weak → summary.
    expect(new Set(Object.values(result.materialization))).toEqual(new Set(["summary"]));
  });

  it("preserves every hard constraint (INV-003)", () => {
    const traced = new Set(
      result.spans
        .filter((s) => s.origin.kind === "ir_node")
        .map((s) => (s.origin as { node_id: string }).node_id),
    );
    for (const c of ir.constraints.filter((x) => x.hardness === "hard")) {
      expect(traced.has(c.id)).toBe(true);
    }
  });

  it("achieves total byte attribution like any shipped target (INV-010)", () => {
    for (const artifact of result.artifacts) {
      const report = analyseCoverage(artifact.path, artifact.content, result.spans);
      expect(report.gaps).toEqual([]);
      expect(report.overlaps).toEqual([]);
    }
  });

  it("does not overclaim its fidelity", () => {
    expect(checkFidelity(profile, REGISTERED_OVERRIDES)).toEqual([]);
  });
});

describe("the compiler contains no vendor branching", () => {
  const COMPILER_FILES = [
    "src/compile/compile.ts",
    "src/compile/legalize.ts",
    "src/compile/materialize.ts",
    "src/compile/budget.ts",
    "src/compile/topology.ts",
    "src/compile/lower.ts",
    "src/compile/sections/index.ts",
    "src/compile/sections/helpers.ts",
    "src/compile/sections/objective.ts",
    "src/compile/sections/goals.ts",
    "src/compile/sections/constraints.ts",
    "src/compile/sections/scope.ts",
    "src/compile/sections/verification.ts",
    "src/compile/sections/context.ts",
    "src/compile/sections/capability.ts",
  ];

  /**
   * Behaviour must originate from typed structures, never from a check on which target
   * is being compiled. This is the mechanical guard against the `if (agent === "...")`
   * shape the architecture exists to avoid.
   */
  const VENDOR_TOKENS = [
    "claude-code",
    "claude-design",
    "openai-codex",
    "opencode",
    "kiro",
    "hermes-agent",
    "deepseek-harness",
  ];

  for (const file of COMPILER_FILES) {
    it(`${file} names no specific target`, () => {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      const found = VENDOR_TOKENS.filter((t) => source.includes(t));
      expect(found, `${file} branches on or mentions ${found.join(", ")}`).toEqual([]);
    });
  }

  it("no compiler file compares against profile.id", () => {
    for (const file of COMPILER_FILES) {
      const source = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(source, `${file} compares profile.id`).not.toMatch(/profile\.id\s*===/);
    }
  });
});

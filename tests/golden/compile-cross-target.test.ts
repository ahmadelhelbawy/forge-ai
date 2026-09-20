/**
 * Cross-target compilation — AC-002, FR-021, INV-003.
 *
 * The load-bearing proof of the whole architecture: ONE Task IR, compiled to targets
 * with genuinely different capabilities, produces genuinely different artifacts — and
 * every difference comes from profile data, never from a mutated IR or a vendor check
 * in the compiler.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { semanticHash } from "../../src/ir/projection.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { loadFixture } from "../helpers/fixtures.js";

const registry = builtinProfiles();
const CROSS_TARGETS = ["claude-code", "kiro", "claude-design"] as const;

describe("one IR, three materially different targets (AC-002)", () => {
  const ir = loadFixture("empty-state");
  const results = Object.fromEntries(
    CROSS_TARGETS.map((id) => [id, compile(ir, registry.get(id), { taskSlug: "empty-state" })]),
  );

  it("all three compile without refusal", () => {
    for (const id of CROSS_TARGETS) {
      expect(results[id]!.refused, `${id} refused: ${JSON.stringify(results[id]!.diagnostics)}`).toBe(
        false,
      );
      expect(results[id]!.artifacts.length).toBeGreaterThan(0);
    }
  });

  it("difference 1 — artifact paths and counts differ", () => {
    const paths = Object.fromEntries(
      CROSS_TARGETS.map((id) => [id, results[id]!.artifacts.map((a) => a.path).sort()]),
    );
    expect(paths["kiro"]).toHaveLength(3);
    expect(paths["claude-design"]).toHaveLength(1);
    // No two targets write the same set of files.
    const serialised = CROSS_TARGETS.map((id) => JSON.stringify(paths[id]));
    expect(new Set(serialised).size).toBe(CROSS_TARGETS.length);
  });

  it("difference 2 — materialization mode differs by retrieval strength", () => {
    expect(new Set(Object.values(results["claude-code"]!.materialization))).toEqual(
      new Set(["by_reference"]),
    );
    expect(new Set(Object.values(results["kiro"]!.materialization))).toEqual(new Set(["summary"]));
    expect(new Set(Object.values(results["claude-design"]!.materialization))).toEqual(
      new Set(["by_value"]),
    );
  });

  it("difference 3 — verification kinds differ after legalization", () => {
    const designBrief = results["claude-design"]!.artifacts[0]!.content;
    const claudePrompt = results["claude-code"]!.artifacts.find((a) => a.path === "PROMPT.md")!.content;

    // claude-code can run tests, so the executable step stays executable.
    expect(claudePrompt).toContain("run: pnpm test src/components/results");
    // claude-design cannot, so the same step is recorded as a manual check.
    expect(designBrief).toContain("check by hand: pnpm test src/components/results");
    expect(designBrief).toContain("degrade.command_to_manual");
  });

  it("difference 4 — degradations differ", () => {
    expect(results["claude-code"]!.degradations).toHaveLength(0);
    const designRules = results["claude-design"]!.degradations.map((d) => d.rule_id).sort();
    expect(designRules).toEqual(["degrade.command_to_manual", "degrade.inline_context"]);
  });

  it("difference 5 — section selection and placement differ", () => {
    const kiro = results["kiro"]!;
    const requirements = kiro.artifacts.find((a) => a.path.endsWith("requirements.md"))!.content;
    const tasks = kiro.artifacts.find((a) => a.path.endsWith("tasks.md"))!.content;

    // Kiro splits the spec across files; the checklist lives only in tasks.md.
    expect(requirements).toContain("## Goals");
    expect(requirements).not.toContain("## Tasks");
    expect(tasks).toContain("## Tasks");
    expect(tasks).not.toContain("## Goals");

    // claude-design omits stop conditions entirely; claude-code includes them.
    expect(results["claude-design"]!.artifacts[0]!.content).not.toContain("## Stop and ask");
    expect(
      results["claude-code"]!.artifacts.find((a) => a.path === "PROMPT.md")!.content,
    ).toContain("## Stop and ask");
  });

  it("EVERY hard constraint survives in EVERY target (INV-003)", () => {
    const hard = ir.constraints.filter((c) => c.hardness === "hard");
    expect(hard.length).toBeGreaterThan(0);
    for (const id of CROSS_TARGETS) {
      const all = results[id]!.artifacts.map((a) => a.content).join("\n");
      for (const c of hard) {
        expect(all, `${c.id} missing from ${id}`).toContain(c.statement);
      }
      // And mechanically, via the trace rather than by string search.
      const traced = new Set(
        results[id]!.spans
          .filter((s) => s.origin.kind === "ir_node")
          .map((s) => (s.origin as { node_id: string }).node_id),
      );
      for (const c of hard) expect(traced.has(c.id), `${c.id} untraced in ${id}`).toBe(true);
    }
  });

  it("differences come from profiles, not from a mutated Task IR", () => {
    // The single strongest guard against the compiler quietly rewriting the task:
    // the IR's identity is unchanged after compiling it three different ways.
    const before = semanticHash(ir);
    for (const id of CROSS_TARGETS) compile(ir, registry.get(id), { taskSlug: "empty-state" });
    expect(semanticHash(ir)).toBe(before);
  });

  it("produces no untraced spans anywhere (AC-006)", () => {
    for (const id of CROSS_TARGETS) {
      const untraced = results[id]!.diagnostics.filter((d) => d.code === "FORGE-C100");
      expect(untraced, `${id} has untraced spans`).toEqual([]);
    }
  });
});

describe("golden artifacts are stable and human-reviewable", () => {
  const ir = loadFixture("empty-state");

  for (const id of CROSS_TARGETS) {
    it(`${id} output matches its snapshot`, () => {
      const result = compile(ir, registry.get(id), { taskSlug: "empty-state" });
      const rendered = result.artifacts
        .map((a) => `===== ${a.path} =====\n${a.content}`)
        .join("\n");
      expect(rendered).toMatchSnapshot();
    });
  }

  it("compilation is deterministic across repeated runs", () => {
    for (const id of registry.ids) {
      const a = compile(ir, registry.get(id), { taskSlug: "empty-state" });
      const b = compile(ir, registry.get(id), { taskSlug: "empty-state" });
      expect(a.artifacts.map((x) => x.content_hash)).toEqual(b.artifacts.map((x) => x.content_hash));
      expect(JSON.stringify(a.spans)).toBe(JSON.stringify(b.spans));
    }
  });
});

describe("a capability-poor target is an honesty test, not a special case", () => {
  it("refuses a task it genuinely cannot perform (FORGE-C030)", () => {
    // auth-debug needs fs_write and git_history. No degradation rule can compensate for
    // either, so a design surface must refuse rather than emit a plausible package.
    const result = compile(loadFixture("auth-debug"), registry.get("claude-design"));
    expect(result.refused).toBe(true);
    expect(result.artifacts).toEqual([]);

    const gaps = result.diagnostics.filter((d) => d.code === "FORGE-C030");
    const cited = gaps.flatMap((d) => d.evidence.map((e) => (e.kind === "node" ? e.node_id : "")));
    expect(cited).toContain("fs_write");
    expect(cited).toContain("git_history");
  });

  it("compiles the same task for a target that can perform it", () => {
    const result = compile(loadFixture("auth-debug"), registry.get("claude-code"));
    expect(result.refused).toBe(false);
    expect(result.artifacts.length).toBeGreaterThan(0);
  });
});

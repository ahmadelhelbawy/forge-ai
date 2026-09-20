/**
 * Budget allocation — FR-020, INV-003, INV-012, FORGE-C060, FORGE-C061.
 *
 * Goals and hard constraints are NEVER droppable. If the non-droppable core alone
 * exceeds the envelope that is an error, not a truncation: a compiler that quietly
 * trimmed an instruction would be worse than one that refused.
 */
import { describe, expect, it } from "vitest";

import { allocateBudget, checkRenderedBudget } from "../../src/compile/budget.js";
import { compile } from "../../src/compile/compile.js";
import { CHAR_TOKEN_ESTIMATOR, DEFAULT_TOKEN_ESTIMATOR } from "../../src/compile/tokenizer.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { loadFixture } from "../helpers/fixtures.js";
import { capabilityMap, testProfile } from "../helpers/compile.js";

const ir = loadFixture("empty-state");

/** A profile whose envelope is large enough that nothing is dropped. */
const roomy = testProfile({ budget: { max_context_tokens: 200000, artifact_share: 0.5 } });

describe("with a sufficient envelope, nothing is dropped", () => {
  it("keeps every context reference", () => {
    const result = allocateBudget(ir, roomy, DEFAULT_TOKEN_ESTIMATOR);
    expect(result.dropped).toEqual([]);
    expect(result.keptContextIds.size).toBe(ir.context_refs.length);
    expect(codesOf(result.diagnostics)).toEqual([]);
  });
});

describe("under pressure, background context drops first (FR-020)", () => {
  /** Sized so the core fits but not every reference does. */
  function tightProfile(tokens: number) {
    return testProfile({ budget: { max_context_tokens: tokens, artifact_share: 1 } });
  }

  it("drops by role priority, background before definition", () => {
    const core = CHAR_TOKEN_ESTIMATOR.count("");
    void core;
    // Find an envelope that forces exactly some drops.
    const full = allocateBudget(ir, roomy, CHAR_TOKEN_ESTIMATOR);
    const envelope = full.coreTokens + Math.floor(full.contextTokens / 2);
    const result = allocateBudget(ir, tightProfile(envelope), CHAR_TOKEN_ESTIMATOR);

    expect(result.dropped.length).toBeGreaterThan(0);
    const droppedIds = result.dropped.map((d) => d.ref_id);
    const roleOf = (id: string) => ir.context_refs.find((r) => r.id === id)!.role;

    // ctx4 is the only `background` reference and must be the first to go.
    expect(droppedIds[0]).toBe("ctx4");
    expect(roleOf(droppedIds[0]!)).toBe("background");
    // constraint_source is the last thing to drop, since it is the evidence behind
    // an instruction the agent is still being asked to honour.
    expect(droppedIds).not.toContain("ctx3");
  });

  it("emits FORGE-C061 naming the item and the reason (INV-012)", () => {
    const full = allocateBudget(ir, roomy, CHAR_TOKEN_ESTIMATOR);
    const envelope = full.coreTokens + Math.floor(full.contextTokens / 2);
    const result = allocateBudget(ir, tightProfile(envelope), CHAR_TOKEN_ESTIMATOR);

    const dropped = result.diagnostics.filter((d) => d.code === "FORGE-C061");
    expect(dropped.length).toBe(result.dropped.length);
    for (const d of dropped) {
      expect(d.severity).toBe("info");
      expect(d.message).toMatch(/Dropped context reference/);
      expect(d.evidence.some((e) => e.kind === "measure")).toBe(true);
    }
  });

  it("never drops a goal or a hard constraint (INV-003)", () => {
    const full = allocateBudget(ir, roomy, CHAR_TOKEN_ESTIMATOR);
    const envelope = full.coreTokens + 1;
    const result = allocateBudget(ir, tightProfile(envelope), CHAR_TOKEN_ESTIMATOR);

    // Everything droppable may go, but the core is untouched and is not an error.
    expect(codesOf(result.diagnostics)).not.toContain("FORGE-C060");
    expect(result.coreTokens).toBe(full.coreTokens);
  });

  it("a dropped reference is absent from the rendered artifact", () => {
    const full = allocateBudget(ir, roomy, CHAR_TOKEN_ESTIMATOR);
    const envelope = full.coreTokens + Math.floor(full.contextTokens / 3);
    const profile = testProfile({
      budget: { max_context_tokens: envelope, artifact_share: 1 },
      output: {
        artifacts: [
          {
            path: "TASK.md",
            sections: ["objective", "goals", "constraints", "context_plan", "untrusted_appendix"],
          },
        ],
        path_vars: [],
      },
    });
    const result = compile(ir, profile, { estimator: CHAR_TOKEN_ESTIMATOR });
    const content = result.artifacts.map((a) => a.content).join("\n");
    for (const drop of result.droppedContext) {
      const uri = ir.context_refs.find((r) => r.id === drop.ref_id)!.uri;
      expect(content).not.toContain(uri);
    }
  });
});

describe("an impossible envelope is an error, not a truncation (FORGE-C060)", () => {
  it("refuses when the core alone exceeds the envelope", () => {
    const tiny = testProfile({ budget: { max_context_tokens: 40, artifact_share: 0.1 } });
    const result = allocateBudget(ir, tiny, DEFAULT_TOKEN_ESTIMATOR);
    expect(codesOf(result.diagnostics)).toContain("FORGE-C060");
    const overflow = result.diagnostics.find((d) => d.code === "FORGE-C060")!;
    expect(overflow.severity).toBe("error");
    expect(overflow.evidence.filter((e) => e.kind === "measure")).toHaveLength(2);
  });

  it("compilation refuses rather than emitting a truncated package", () => {
    const tiny = testProfile({
      budget: { max_context_tokens: 40, artifact_share: 0.1 },
      capabilities: capabilityMap(),
    });
    const result = compile(ir, tiny, { estimator: DEFAULT_TOKEN_ESTIMATOR });
    expect(codesOf(result.diagnostics)).toContain("FORGE-C060");
    expect(result.refused).toBe(true);
  });

  it("flags a rendered package that overruns after the fact", () => {
    const tiny = testProfile({ budget: { max_context_tokens: 100, artifact_share: 0.1 } });
    const diagnostics = checkRenderedBudget(
      [{ path: "a.md", content: "x ".repeat(500) }],
      tiny,
      DEFAULT_TOKEN_ESTIMATOR,
    );
    expect(codesOf(diagnostics)).toContain("FORGE-C060");
  });
});

describe("the tokenizer is pinned and identified (IR-R14)", () => {
  it("declares an id and a version so it can enter the semantic input tuple", () => {
    expect(DEFAULT_TOKEN_ESTIMATOR.id).toBeTruthy();
    expect(DEFAULT_TOKEN_ESTIMATOR.version).toBeTruthy();
  });

  it("counts deterministically", () => {
    const text = "Add an empty state to the search results view";
    expect(DEFAULT_TOKEN_ESTIMATOR.count(text)).toBe(DEFAULT_TOKEN_ESTIMATOR.count(text));
    expect(DEFAULT_TOKEN_ESTIMATOR.count("")).toBe(0);
  });

  it("changes budgeting when swapped, which is why it is part of identity", () => {
    const a = allocateBudget(ir, roomy, DEFAULT_TOKEN_ESTIMATOR);
    const b = allocateBudget(ir, roomy, CHAR_TOKEN_ESTIMATOR);
    expect(a.coreTokens).not.toBe(b.coreTokens);
  });
});

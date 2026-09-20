/**
 * Overlay application tests (FR-018): append-only, trust-preserving,
 * hash-stable. The base IR object is never mutated; added nodes source
 * from the strategy id and carry strategy origins.
 */
import { describe, expect, it } from "vitest";

import { semanticHash } from "../../src/ir/projection.js";
import { resolveTrust } from "../../src/ir/trust.js";
import { applyOverlay, StrategyApplyError } from "../../src/strategy/apply.js";
import { builtinStrategies } from "../../src/strategy/registry.js";
import { clone, loadFixture } from "../helpers/fixtures.js";

const strategies = builtinStrategies();

function surgicalOverlay() {
  return {
    archetypeId: "surgical",
    strategyId: "st_surgical",
    version: 1,
    params: { max_files: 3 },
    template: strategies.get("surgical").overlay_template,
  };
}

describe("applyOverlay (FR-018)", () => {
  it("appends surgical constraints with fresh ids and strategy origins", () => {
    const ir = loadFixture("auth-debug");
    const { ir: merged, introduced } = applyOverlay(ir, surgicalOverlay());
    expect(merged.constraints.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    const added = merged.constraints.slice(3);
    for (const c of added) expect(c.source_ref).toBe("st_surgical");
    expect(added[0]?.statement).toBe("Change the minimum number of lines that fixes the defect");
    expect(introduced.size).toBe(2);
    expect(introduced.get("c4")).toEqual({
      kind: "strategy",
      strategy_id: "st_surgical",
      overlay_path: "overlay_template.added_constraints[0]",
    });
    // Base ids carry no strategy origin.
    expect(introduced.has("c1")).toBe(false);
  });

  it("expands wildcard satisfies onto every goal (rigorous)", () => {
    const ir = loadFixture("auth-debug");
    const rigorous = strategies.get("rigorous");
    const { ir: merged, introduced } = applyOverlay(ir, {
      archetypeId: "rigorous",
      strategyId: "st_rigorous",
      version: 1,
      params: {},
      template: rigorous.overlay_template,
    });
    expect(merged.constraints).toHaveLength(ir.constraints.length + 3);
    const addedV = merged.verification[merged.verification.length - 1]!;
    expect(addedV.id).toBe("v4");
    expect(addedV.satisfies).toEqual(["g1", "g2"]);
    expect(addedV.source_ref).toBe("st_rigorous");
    expect(introduced.get("v4")?.kind).toBe("strategy");
  });

  it("leaves the base IR object and its semantic hash untouched", () => {
    const ir = loadFixture("auth-debug");
    const before = clone(ir);
    const hashBefore = semanticHash(ir);
    applyOverlay(ir, surgicalOverlay());
    expect(ir).toEqual(before);
    expect(semanticHash(ir)).toBe(hashBefore);
  });

  it("refuses dangling satisfies instead of inventing references", () => {
    const ir = loadFixture("auth-debug");
    const template = {
      ...strategies.get("rigorous").overlay_template,
      added_verification: [
        { kind: "review" as const, spec: "x", expected: "y", satisfies: ["g99"] },
      ],
    };
    expect(() =>
      applyOverlay(ir, { archetypeId: "x", strategyId: "st_x", version: 1, params: {}, template }),
    ).toThrow(StrategyApplyError);
  });

  it("added nodes resolve trusted without touching base trust", () => {
    const ir = loadFixture("auth-debug");
    const { ir: merged } = applyOverlay(ir, surgicalOverlay());
    expect(resolveTrust(merged, "st_surgical")).toBe("trusted");
    expect(resolveTrust(merged, "user_input")).toBe("trusted");
    expect(merged.constraints.find((c) => c.id === "c1")?.source_ref).toBe("user_input");
  });
});

/**
 * Structural distinctness tests (FR-034, AC-003).
 *
 * Distance is structural — token sets over added node statements plus
 * autonomy, budget, intensity, and exploration axes — never adjectives or
 * verbosity. A reworded duplicate is rejected; the four shipped archetypes
 * clear the threshold with a measured margin.
 */
import { describe, expect, it } from "vitest";

import { builtinProfiles } from "../../src/profile/registry.js";
import { deriveParameters } from "../../src/strategy/derive.js";
import { checkDistinctness, DISTINCTNESS_THRESHOLD, overlayDistance } from "../../src/strategy/distinctness.js";
import { builtinStrategies } from "../../src/strategy/registry.js";
import { resolveArchetype } from "../../src/strategy/source.js";
import { loadFixture } from "../helpers/fixtures.js";

const strategies = builtinStrategies();
const profile = builtinProfiles().get("claude-code");
const ir = loadFixture("auth-debug");

function derivedOverlays() {
  return strategies.all.map((a) => resolveArchetype(a, ir, profile).overlay);
}

describe("structural distinctness (AC-003)", () => {
  it("holds pairwise above threshold for the four shipped archetypes", () => {
    const result = checkDistinctness(derivedOverlays());
    expect(result.pairs).toHaveLength(6);
    expect(result.rejected).toEqual([]);
    const min = Math.min(...result.pairs.map((p) => p.distance));
    expect(min).toBeGreaterThan(2.0);
  });

  it("rejects a reworded duplicate of surgical", () => {
    const copy = JSON.parse(JSON.stringify(strategies.get("surgical")));
    copy.id = "surgical-copy";
    copy.overlay_template.added_constraints[0].statement = "Change the fewest lines that fix the problem";
    const dupDerived = {
      archetypeId: copy.id,
      strategyId: "st_copy",
      version: 1,
      params: deriveParameters(copy, ir).params,
      template: copy.overlay_template,
    };
    const surgical = derivedOverlays().find((o) => o.archetypeId === "surgical")!;
    expect(overlayDistance(surgical, dupDerived)).toBeLessThanOrEqual(DISTINCTNESS_THRESHOLD);
    const result = checkDistinctness([...derivedOverlays(), dupDerived]);
    expect(result.rejected.map((r) => [r.a, r.b].sort().join("+"))).toContain("surgical+surgical-copy");
  });

  it("is deterministic and symmetric", () => {
    const [a, b] = derivedOverlays();
    expect(overlayDistance(a!, b!)).toBe(overlayDistance(b!, a!));
    expect(overlayDistance(a!, b!)).toBe(overlayDistance(a!, b!));
    expect(overlayDistance(a!, a!)).toBe(0);
  });
});

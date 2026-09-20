/**
 * Strategy rationale goldens (FR-033): the rationale is the rendered
 * decision procedure, byte-stable for a fixed IR, profile, and registry.
 */
import { describe, expect, it } from "vitest";

import { builtinProfiles } from "../../src/profile/registry.js";
import { builtinStrategies } from "../../src/strategy/registry.js";
import { ArchetypeSource } from "../../src/strategy/source.js";
import { loadFixture } from "../helpers/fixtures.js";

const strategies = builtinStrategies();
const profiles = builtinProfiles();

describe("strategy rationale (FR-033)", () => {
  it("derives surgical rationale from matched fit rules on auth-debug", () => {
    const candidates = new ArchetypeSource(strategies).propose(
      loadFixture("auth-debug"),
      profiles.get("claude-code"),
    );
    const surgical = candidates.find((c) => c.overlay.archetypeId === "surgical")!;
    expect(surgical.rationale).toContain("Selected surgical (fit score 8)");
    expect(surgical.rationale).toContain("risk_level=medium (+2)");
    expect(surgical.rationale).toContain("hard_constraint_kinds=architectural (+3)");
    expect(surgical.rationale).toContain("blast_radius=module (+2)");
    expect(surgical.rationale).toContain("objective_kind=debug (+1)");
    expect(surgical.rationale).toContain("max_files=3 (from from_blast_radius=3)");
    expect(surgical.rationale).toMatchSnapshot();
  });

  it("keeps all rationales stable across runs", () => {
    const once = new ArchetypeSource(strategies).propose(loadFixture("auth-debug"), profiles.get("claude-code"));
    const twice = new ArchetypeSource(strategies).propose(loadFixture("auth-debug"), profiles.get("claude-code"));
    expect(once.map((c) => c.rationale)).toEqual(twice.map((c) => c.rationale));
  });
});

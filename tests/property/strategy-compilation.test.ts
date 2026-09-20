/**
 * Strategy compilation tests: every archetype compiles everywhere a plain
 * IR does, hard constraints survive all of them, artifacts differ
 * materially, trust is preserved, and the base IR is never mutated.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { semanticHash } from "../../src/ir/projection.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { builtinStrategies } from "../../src/strategy/registry.js";
import { resolveArchetype } from "../../src/strategy/source.js";
import { clone, loadFixture } from "../helpers/fixtures.js";

const strategies = builtinStrategies();
const profiles = builtinProfiles();

describe("hard constraints survive every archetype for every profile (AC-004)", () => {
  const ir = loadFixture("empty-state");
  const hard = ir.constraints.filter((c) => c.hardness === "hard");

  for (const profile of profiles.all) {
    for (const archetype of strategies.all) {
      it(`${profile.id} × ${archetype.id} renders all hard constraints`, () => {
        const before = clone(ir);
        const { overlay } = resolveArchetype(archetype, ir, profiles.get(profile.id));
        const result = compile(ir, profiles.get(profile.id), { taskSlug: "empty-state", overlay });
        expect(result.refused).toBe(false);
        expect(codesOf(result.diagnostics)).not.toContain("FORGE-C002");
        const traced = new Set(
          result.spans
            .filter((s) => s.origin.kind === "ir_node")
            .map((s) => (s.origin as { node_id: string }).node_id),
        );
        for (const c of hard) {
          expect(traced.has(c.id), `${c.id} has no span in ${profile.id} × ${archetype.id}`).toBe(true);
        }
        expect(result.strategy).toEqual({ archetype: archetype.id, version: 1 });
        // Compilation never mutates its input.
        expect(ir).toEqual(before);
      });
    }
  }
});

describe("archetypes produce materially different artifacts", () => {
  const ir = loadFixture("auth-debug");
  const markers: Record<string, string> = {
    surgical: "Change the minimum number of lines",
    rigorous: "Add a regression test for every changed behavior",
    autonomous: "Complete the task end to end without handing off",
    exploratory: "Survey the obvious alternatives",
  };

  it("each archetype's demands appear only in its own artifacts", () => {
    const texts: Record<string, string> = {};
    for (const archetype of strategies.all) {
      const { overlay } = resolveArchetype(archetype, ir, profiles.get("claude-code"));
      const result = compile(ir, profiles.get("claude-code"), { taskSlug: "auth-debug", overlay });
      expect(result.refused).toBe(false);
      texts[archetype.id] = result.artifacts.map((a) => a.content).join("\n");
    }
    for (const [id, marker] of Object.entries(markers)) {
      expect(texts[id]).toContain(marker);
      for (const [other, otherMarker] of Object.entries(markers)) {
        if (other !== id) expect(texts[id]).not.toContain(otherMarker);
      }
    }
  });

  it("strategy-added content carries strategy origins with no coverage gaps", () => {
    const { overlay } = resolveArchetype(strategies.get("surgical"), ir, profiles.get("claude-code"));
    const result = compile(ir, profiles.get("claude-code"), { taskSlug: "auth-debug", overlay });
    const strategySpans = result.spans.filter((s) => s.origin.kind === "strategy");
    expect(strategySpans.length).toBeGreaterThan(0);
    for (const s of strategySpans) {
      expect(s.origin).toMatchObject({ kind: "strategy", strategy_id: "st_surgical" });
    }
    expect(codesOf(result.diagnostics)).not.toContain("FORGE-C100");
    expect(codesOf(result.diagnostics)).not.toContain("FORGE-C002");
  });

  it("identity compilation carries no strategy marker", () => {
    const result = compile(ir, profiles.get("claude-code"), { taskSlug: "auth-debug" });
    expect(result.strategy).toBeNull();
    expect(result.spans.some((s) => s.origin.kind === "strategy")).toBe(false);
  });
});

describe("trust preservation under overlays", () => {
  it("semi-trusted content stays advisory under every archetype", () => {
    const ir = loadFixture("semi-trusted-instruction");
    for (const archetype of strategies.all) {
      const { overlay } = resolveArchetype(archetype, ir, profiles.get("claude-code"));
      const result = compile(ir, profiles.get("claude-code"), { taskSlug: "semi", overlay });
      expect(codesOf(result.diagnostics)).toContain("FORGE-C052");
      expect(codesOf(result.diagnostics)).not.toContain("FORGE-C050");
    }
  });

  it("untrusted instructions are still refused under every archetype", () => {
    const ir = loadFixture("untrusted-instruction");
    for (const archetype of strategies.all) {
      const { overlay } = resolveArchetype(archetype, ir, profiles.get("claude-code"));
      const result = compile(ir, profiles.get("claude-code"), { taskSlug: "untrusted", overlay });
      expect(result.refused).toBe(true);
      expect(codesOf(result.diagnostics)).toContain("FORGE-C050");
    }
  });

  it("the TaskIR semantic hash is identical across all strategies", () => {
    const ir = loadFixture("auth-debug");
    const hash = semanticHash(ir);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    for (const archetype of strategies.all) {
      const { overlay } = resolveArchetype(archetype, ir, profiles.get("claude-code"));
      compile(ir, profiles.get("claude-code"), { taskSlug: "auth-debug", overlay });
      expect(semanticHash(ir)).toBe(hash);
    }
  });
});

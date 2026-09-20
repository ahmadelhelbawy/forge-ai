/**
 * Strategy selection tests (FR-031, FR-032, FR-033, ST-R3).
 *
 * Archetypes are data; selection is deterministic fit over IR and profile
 * signals. No model, no scores-as-judgment — the rationale names every
 * contributing rule.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { deriveParameters } from "../../src/strategy/derive.js";
import { FitRuleError, scoreArchetype } from "../../src/strategy/fit.js";
import { builtinStrategies, loadStrategiesFrom, StrategyNotFoundError } from "../../src/strategy/registry.js";
import { extractProfileSignals, extractSignals } from "../../src/strategy/signals.js";
import { ArchetypeSource } from "../../src/strategy/source.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { loadFixture } from "../helpers/fixtures.js";
import { makeTestIR, makeWorkspace } from "../helpers/context.js";

const strategies = builtinStrategies();
const profiles = builtinProfiles();

function authDebugSignals() {
  const ir = loadFixture("auth-debug");
  return {
    ir,
    signals: extractSignals(ir),
    profile: profiles.get("claude-code"),
    profileSignals: extractProfileSignals(profiles.get("claude-code")),
  };
}

describe("strategy registry (FR-031)", () => {
  it("ships exactly the four v0.1 archetypes", () => {
    expect(strategies.ids).toEqual(["autonomous", "exploratory", "rigorous", "surgical"]);
    for (const a of strategies.all) {
      expect(a.overlay_template.added_constraints.length).toBeGreaterThan(0);
      expect(a.fit_rules.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown ids and filename mismatches loudly", () => {
    expect(() => strategies.get("novel")).toThrow(StrategyNotFoundError);
    const dir = mkdtempSync(join(tmpdir(), "forge-strat-"));
    writeFileSync(join(dir, "wrong.yaml"), "id: right\nversion: 1\ndescription: d\noverlay_template: {}\nparameters: {}\nfit_rules: []\n", "utf8");
    expect(() => loadStrategiesFrom(dir)).toThrow();
  });
});

describe("signal extraction", () => {
  it("reads auth-debug signals exactly", () => {
    const { signals } = authDebugSignals();
    expect(signals).toMatchObject({
      risk_level: "medium",
      objective_kind: "debug",
      blast_radius: "module",
      hard_constraint_count: 2,
      open_blocking_count: 0,
      open_total_count: 1,
      context_ref_count: 3,
      has_untrusted_context: false,
    });
    expect(signals.hard_constraint_kinds).toEqual(["architectural", "scope"]);
    expect(signals.verification_kinds).toEqual(["command", "manual", "review"]);
  });

  it("reads profile signals (autonomy varies by target)", () => {
    expect(extractProfileSignals(profiles.get("claude-code")).autonomy).toBe("high");
    expect(extractProfileSignals(profiles.get("claude-design")).autonomy).toBe("low");
    expect(extractProfileSignals(profiles.get("kiro")).autonomy).toBe("medium");
  });
});

describe("fit scoring (FR-032)", () => {
  it("scores surgical 8 on auth-debug with every rule named", () => {
    const { signals, profileSignals } = authDebugSignals();
    const { score, matched } = scoreArchetype(strategies.get("surgical"), signals, profileSignals);
    expect(score).toBe(8);
    expect(matched).toHaveLength(4);
    expect(matched.map((m) => m.detail).join(" ")).toContain("hard_constraint_kinds=architectural (+3)");
  });

  it("ranks all positive candidates, surgical first on auth-debug", () => {
    const ir = loadFixture("auth-debug");
    const candidates = new ArchetypeSource(strategies).propose(ir, profiles.get("claude-code"));
    expect(candidates.map((c) => c.overlay.archetypeId)).toEqual([
      "surgical",
      "autonomous",
      "rigorous",
      "exploratory",
    ]);
    expect(candidates.map((c) => c.score)).toEqual([8, 6, 2, 1]);
    expect(candidates[0]?.origin).toBe("archetype");
    expect(candidates[0]?.rationale).toContain("Selected surgical (fit score 8)");
  });

  it("excludes zero-score archetypes from candidacy", () => {
    const base = makeTestIR();
    const ir = {
      ...base,
      objective: { ...base.objective, kind: "analysis" as const },
      scope: { ...base.scope, blast_radius: "repo" as const },
      risk: { level: "low" as const, factors: [] as string[] },
    };
    const candidates = new ArchetypeSource(strategies).propose(ir, profiles.get("claude-code"));
    expect(candidates.map((c) => c.overlay.archetypeId)).not.toContain("surgical");
  });

  it("breaks score ties by configured archetype order", () => {
    const root = makeWorkspace({
      "aaa.yaml": "id: aaa\nversion: 1\ndescription: d\noverlay_template: {added_constraints: [], autonomy: {decision_authority: low, ask_threshold: never}, change_budget: {max_files: 1}, verification_intensity: light, context_policy: minimal, exploration: {challenge_architecture: false, require_alternatives: 0}}\nparameters: {}\nfit_rules: [{when: {risk_level: [low]}, weight: 1}]\n",
      "surgical.yaml": "id: surgical\nversion: 1\ndescription: d\noverlay_template: {added_constraints: [], autonomy: {decision_authority: low, ask_threshold: never}, change_budget: {max_files: 1}, verification_intensity: light, context_policy: minimal, exploration: {challenge_architecture: false, require_alternatives: 0}}\nparameters: {}\nfit_rules: [{when: {risk_level: [low]}, weight: 1}]\n",
    });
    const custom = loadStrategiesFrom(root);
    const base = makeTestIR();
    const ir = { ...base, risk: { level: "low" as const, factors: [] as string[] } };
    const candidates = new ArchetypeSource(custom).propose(ir, profiles.get("claude-code"));
    expect(candidates.map((c) => c.overlay.archetypeId)).toEqual(["surgical", "aaa"]);
  });

  it("fails closed on unknown signal names", () => {
    const { signals, profileSignals } = authDebugSignals();
    const bad = { ...strategies.get("surgical"), fit_rules: [{ when: { nope: [1] }, weight: 1 }] };
    expect(() => scoreArchetype(bad, signals, profileSignals)).toThrow(FitRuleError);
  });
});

describe("bounded derivation (ST-R3)", () => {
  it("derives surgical params from auth-debug signals, clamped", () => {
    const ir = loadFixture("auth-debug");
    const { params, sources } = deriveParameters(strategies.get("surgical"), ir);
    expect(params["max_files"]).toBe(3);
    expect(params["budget_tokens"]).toBe(2000 + 500 * (ir.scope.include.length + ir.scope.exclude.length));
    expect(sources["max_files"]).toContain("from_blast_radius");
  });

  it("derives unasked_budget from open questions and review_passes from risk", () => {
    const ir = loadFixture("auth-debug");
    expect(deriveParameters(strategies.get("autonomous"), ir).params["unasked_budget"]).toBe(1);
    expect(deriveParameters(strategies.get("rigorous"), ir).params["review_passes"]).toBe(2);
  });
});

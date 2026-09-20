/**
 * Lexicographic ranking tests (FR-038, DG-R6, spec.md §10.3).
 *
 * No weights, no composite score: error diagnostics disqualify, then
 * diagnostic counts in precedence order, then token cost, then archetype
 * order. Every outcome names the step that decided it.
 */
import { describe, expect, it } from "vitest";

import { rankStrategies, RANK_PRECEDENCE } from "../../src/critic/rank.js";
import { diagnostic, nodeEvidence, type Diagnostic } from "../../src/ir/diagnostic.js";

function diag(code: Diagnostic["code"], severity: Diagnostic["severity"] = "warning"): Diagnostic {
  return diagnostic(code, `${code} finding`, [nodeEvidence("g1")], severity);
}

describe("lexicographic ranking (FR-038)", () => {
  it("follows the published precedence order", () => {
    expect([...RANK_PRECEDENCE]).toEqual([
      "FORGE-C002",
      "FORGE-C001",
      "FORGE-C050",
      "FORGE-C080",
      "FORGE-C041",
      "FORGE-C040",
      "FORGE-C070",
      "FORGE-C010",
      "FORGE-C011",
    ]);
  });

  it("disqualifies error-severity candidates first", () => {
    const outcome = rankStrategies([
      { archetype: "surgical", diagnostics: [diag("FORGE-C002", "error")], estTokens: 10 },
      { archetype: "rigorous", diagnostics: [], estTokens: 9000 },
    ]);
    expect(outcome.order).toEqual(["rigorous"]);
    expect(outcome.disqualified).toEqual(["surgical"]);
    expect(outcome.decidedBy).toBe("sole-survivor");
  });

  it("prefers fewer diagnostics at the earliest differing precedence code", () => {
    const outcome = rankStrategies([
      { archetype: "surgical", diagnostics: [diag("FORGE-C002")], estTokens: 10 },
      { archetype: "rigorous", diagnostics: [diag("FORGE-C010"), diag("FORGE-C010"), diag("FORGE-C010")], estTokens: 10 },
    ]);
    expect(outcome.order).toEqual(["rigorous", "surgical"]);
    expect(outcome.decidedBy).toBe("fewer-FORGE-C002");
  });

  it("breaks diagnostic ties by lower token cost", () => {
    const outcome = rankStrategies([
      { archetype: "surgical", diagnostics: [diag("FORGE-C010")], estTokens: 500 },
      { archetype: "rigorous", diagnostics: [diag("FORGE-C010")], estTokens: 100 },
    ]);
    expect(outcome.order).toEqual(["rigorous", "surgical"]);
    expect(outcome.decidedBy).toBe("lower-token-cost");
  });

  it("breaks full ties by configured archetype order", () => {
    const outcome = rankStrategies([
      { archetype: "rigorous", diagnostics: [], estTokens: 100 },
      { archetype: "surgical", diagnostics: [], estTokens: 100 },
    ]);
    expect(outcome.order).toEqual(["surgical", "rigorous"]);
    expect(outcome.decidedBy).toBe("archetype-order");
  });

  it("reports all-disqualified when nothing survives", () => {
    const outcome = rankStrategies([
      { archetype: "surgical", diagnostics: [diag("FORGE-C002", "error")], estTokens: 10 },
      { archetype: "rigorous", diagnostics: [diag("FORGE-C030", "error")], estTokens: 10 },
    ]);
    expect(outcome.order).toEqual([]);
    expect(outcome.disqualified).toEqual(["surgical", "rigorous"]);
    expect(outcome.decidedBy).toBe("all-disqualified");
  });
});

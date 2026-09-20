/**
 * No composite quality score (INV-008, AC-013).
 *
 * Behavioral, not textual: compile the fixture matrix with and without
 * overlays, and assert NO emitted artifact or diagnostic carries a quality
 * judgment — no x/100, no quality/overall/composite/prompt score, no
 * grades. Selection tallies ("fit score 8", always paired with their rule
 * derivation) and retrieval scores (run-layer only, never emitted) are
 * mechanism, not verdicts, and are out of scope for this ban.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { checkRequirementLedger } from "../../src/critic/deterministic/ledger.js";
import { compareVersionIrs } from "../../src/critic/judged/drift.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { builtinStrategies } from "../../src/strategy/registry.js";
import { ArchetypeSource, resolveArchetype } from "../../src/strategy/source.js";
import { loadFixture } from "../helpers/fixtures.js";

const BANNED = [/\b\d{1,3}\s*\/\s*100\b/, /quality/i, /overall score/i, /composite score/i, /prompt score/i, /\bgrade\b/i, /\brating\b/i];

function emittedText(): string[] {
  const profiles = builtinProfiles();
  const strategies = builtinStrategies();
  const out: string[] = [];
  for (const name of ["auth-debug", "empty-state"] as const) {
    const ir = loadFixture(name);
    for (const profile of profiles.all) {
      const plain = compile(ir, profiles.get(profile.id), { taskSlug: "noscore" });
      if (!plain.refused) {
        out.push(plain.artifacts.map((a) => a.content).join("\n"));
        out.push(plain.diagnostics.map((d) => d.message).join("\n"));
      }
      for (const archetype of strategies.all) {
        const { overlay } = resolveArchetype(archetype, ir, profiles.get(profile.id));
        const result = compile(ir, profiles.get(profile.id), { taskSlug: "noscore", overlay });
        if (!result.refused) {
          out.push(result.artifacts.map((a) => a.content).join("\n"));
          out.push(result.diagnostics.map((d) => d.message).join("\n"));
        }
      }
    }
  }
  return out;
}

describe("no composite quality score (AC-013, INV-008)", () => {
  it("emits no quality judgment in any compiled output", () => {
    for (const text of emittedText()) {
      for (const pattern of BANNED) {
        expect(text, `banned pattern ${pattern} in output`).not.toMatch(pattern);
      }
    }
  });

  it("keeps rationale tallies derivation-paired, never bare judgments", () => {
    const candidates = new ArchetypeSource(builtinStrategies()).propose(
      loadFixture("auth-debug"),
      builtinProfiles().get("claude-code"),
    );
    for (const c of candidates) {
      // A tally is allowed only with its rule derivation attached.
      expect(c.rationale).toMatch(/fit score \d+/);
      expect(c.rationale).toContain("(+");
      for (const pattern of BANNED) {
        expect(c.rationale, `banned pattern ${pattern} in rationale`).not.toMatch(pattern);
      }
    }
  });

  /**
   * V2-D added two emitters, and a preservation layer is exactly where a
   * "how well was it preserved" number would be tempting. Neither layer emits
   * one: the ledger answers present or absent, and drift's `similarity` is the
   * matcher's own mechanism — carried on the finding, never in the diagnostic,
   * and never a verdict about the prompt.
   */
  it("emits no quality judgment from either preservation layer", () => {
    const entries = [
      { id: "r1", text: "must use PostgreSQL", contentHash: `sha256:${"a".repeat(64)}`, origin: "user_input" as const },
    ];
    const ledger = checkRequirementLedger(entries, "a version with no database in it", 2);
    const before = loadFixture("auth-debug");
    const after = { ...before, constraints: before.constraints.slice(1) };
    const drift = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: after });

    const messages = [
      ...ledger.diagnostics.map((d) => d.message),
      ...drift.findings.map((f) => f.diagnostic.message),
    ];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      for (const pattern of BANNED) {
        expect(message, `banned pattern ${pattern} in a preservation diagnostic`).not.toMatch(pattern);
      }
    }
    // A verdict is present/absent, not a number. Nothing aggregates the two
    // layers into one figure, and there is no function that could.
    expect(ledger.findings.every((f) => typeof f.present === "boolean")).toBe(true);
    expect(JSON.stringify(ledger)).not.toMatch(/score/i);
  });

  it("ships no score-shaped text in strategy data files", () => {
    const dir = join(new URL(".", import.meta.url).pathname, "..", "..", "strategies");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, `score-shaped text in ${file}`).not.toMatch(/\b\d{1,3}\s*\/\s*100\b/);
      expect(text, `quality judgment in ${file}`).not.toMatch(/quality score|overall score|composite score/i);
    }
  });
});

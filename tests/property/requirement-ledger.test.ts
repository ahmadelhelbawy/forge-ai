/**
 * V2-D1 — the deterministic requirement ledger (WS-R24, WS-R25, WS-R27.3).
 *
 * These tests are about epistemic status, not about matching quality. The
 * claim under test is that Layer 1 is a **mechanical guarantee**: same inputs,
 * same bytes, no model, no clock, no Layer 2. A check that were merely usually
 * right would satisfy none of them.
 *
 * `AC-039` (an absent pinned requirement is an `error`, deterministically, with
 * no model call, byte-identical on repeated runs) and `AC-040` (Layer 1 reaches
 * the same verdict with Layer 2 switched off) are asserted here; the adversarial
 * halves — `AC-041` and `AC-042` — live in `tests/product/requirement-ledger.test.ts`
 * where there is a conversation and a model path to attack.
 */
import { describe, expect, it } from "vitest";

import {
  checkRequirementLedger,
  containsSequence,
  hasPreservationFailure,
  isPresent,
  ledgerFingerprint,
  proposeRequirementCandidates,
  tokenize,
  type LedgerEntry,
} from "../../src/critic/deterministic/ledger.js";
import { DIAGNOSTIC_REGISTRY } from "../../src/ir/diagnostic.js";

const entry = (id: string, text: string): LedgerEntry => ({
  id,
  text,
  contentHash: `sha256:${id.padEnd(64, "0")}`,
  origin: "user_input",
});

const PINNED = entry("r1", "must use PostgreSQL");

describe("the presence rule is published, mechanical, and surface-tolerant (WS-R25)", () => {
  it("matches across case, punctuation, bullets and whitespace", () => {
    for (const version of [
      "The service must use PostgreSQL.",
      "- Must use PostgreSQL\n- Ship on Friday",
      "must   use\n\tPostgreSQL",
      "MUST USE POSTGRESQL!",
      "…must use (PostgreSQL)…",
    ]) {
      expect(isPresent(version, PINNED.text)).toBe(true);
    }
  });

  it("normalizes Unicode before comparing, so a composed form cannot smuggle a difference", () => {
    // Full-width characters normalize to ASCII under NFKC.
    expect(isPresent("ｍｕｓｔ ｕｓｅ ＰｏｓｔｇｒｅＳＱＬ", PINNED.text)).toBe(true);
  });

  it("does not match a paraphrase — that is Layer 2's subject, not Layer 1's", () => {
    for (const version of [
      "The database must be PostgreSQL.",
      "Use Postgres.",
      "must use a relational database",
      "must use MySQL",
    ]) {
      expect(isPresent(version, PINNED.text)).toBe(false);
    }
  });

  it("requires the tokens contiguously: scattered words are not a match", () => {
    expect(isPresent("must run tests. use a queue. PostgreSQL is available.", PINNED.text)).toBe(false);
    expect(containsSequence(["a", "b", "c"], ["a", "c"])).toBe(false);
    expect(containsSequence(["a", "b", "c"], ["b", "c"])).toBe(true);
    expect(containsSequence(["a"], [])).toBe(false);
    expect(containsSequence([], ["a"])).toBe(false);
  });

  it("tokenizes to letters and digits only", () => {
    expect(tokenize("Use PostgreSQL 16 — not MySQL!")).toEqual(["use", "postgresql", "16", "not", "mysql"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("a dropped pinned requirement is an error, deterministically (AC-039)", () => {
  it("emits FORGE-W005 citing the pinned text and the version that dropped it", () => {
    const result = checkRequirementLedger([PINNED], "Build a service. Ship on Friday.", 4);
    expect(result.diagnostics).toHaveLength(1);
    const finding = result.diagnostics[0]!;
    expect(finding.code).toBe("FORGE-W005");
    expect(finding.severity).toBe("error");
    expect(finding.source).toBe("deterministic");
    expect(finding.message).toContain("must use PostgreSQL");
    expect(finding.evidence).toEqual([
      { kind: "span", artifact_path: "ledger/r1", start: 0, end: PINNED.text.length, quote: PINNED.text },
      { kind: "measure", label: "dropped_in_version", value: 4, unit: "version" },
    ]);
    expect(hasPreservationFailure(result)).toBe(true);
  });

  it("is byte-identical over repeated runs on identical inputs (INV-005)", () => {
    const entries = [PINNED, entry("r2", "never log credentials"), entry("r3", "always run the test suite")];
    const version = "Do the work. Always run the test suite before shipping.";
    const runs = Array.from({ length: 5 }, () => JSON.stringify(checkRequirementLedger(entries, version, 7)));
    expect(new Set(runs).size).toBe(1);
  });

  it("reports every entry, present or absent — silence is not a verdict (WS-R27.2)", () => {
    const entries = [PINNED, entry("r2", "never log credentials")];
    const result = checkRequirementLedger(entries, "Never log credentials.", 2);
    expect(result.findings.map((f) => [f.entryId, f.present])).toEqual([
      ["r1", false],
      ["r2", true],
    ]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("holds its verdict when the ledger is empty, rather than inventing one", () => {
    const result = checkRequirementLedger([], "anything at all", 1);
    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(hasPreservationFailure(result)).toBe(false);
  });
});

describe("Layer 1 runs without Layer 2 (AC-040, WS-R27.3)", () => {
  it("takes no judged input at all: nothing but entries, text and the version reaches the verdict", () => {
    // V2-E added a fourth parameter — a string naming what was checked, so a
    // candidate is not reported as a version that dropped something it
    // contains. The assertion is no longer arity alone, because arity was
    // only ever a proxy for the property that matters: that nothing judged can
    // influence a Layer 1 verdict. It is now asserted directly, and the
    // fourth parameter is included in the claim.
    expect(checkRequirementLedger.length).toBe(4);
    const plain = checkRequirementLedger([PINNED], "no database named here", 3);
    expect(plain.diagnostics.map((d) => d.code)).toEqual(["FORGE-W005"]);

    // A whole judged report, stringified into the one parameter that could
    // conceivably carry it, changes nothing about the verdict.
    const judgedShaped = JSON.stringify({
      layer: "judged",
      guarantee: false,
      findings: [{ kind: "vanished", similarity: 0.97, resolved: true }],
    });
    const contaminated = checkRequirementLedger([PINNED], "no database named here", 3, judgedShaped);
    expect(contaminated.findings).toEqual(plain.findings);
    expect(contaminated.v).toBe(plain.v);
    expect(contaminated.diagnostics.map((d) => d.code)).toEqual(plain.diagnostics.map((d) => d.code));
    expect(contaminated.diagnostics.map((d) => d.severity)).toEqual(plain.diagnostics.map((d) => d.severity));
    expect(contaminated.diagnostics.map((d) => d.source)).toEqual(plain.diagnostics.map((d) => d.source));
  });

  it("makes no model call: the check is synchronous and pure", () => {
    const result = checkRequirementLedger([PINNED], "no database named here", 3);
    // A promise here would mean I/O happened; there is none to await.
    expect(result).not.toBeInstanceOf(Promise);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("the ledger fingerprint detects every mutation (AC-042 guard)", () => {
  const base = [PINNED, entry("r2", "never log credentials")];

  it("changes on edit, removal, addition and reorder", () => {
    const original = ledgerFingerprint(base);
    expect(ledgerFingerprint([...base])).toBe(original);
    expect(ledgerFingerprint([base[1]!, base[0]!])).not.toBe(original);
    expect(ledgerFingerprint([base[0]!])).not.toBe(original);
    expect(ledgerFingerprint([...base, entry("r3", "ship on Friday")])).not.toBe(original);
    expect(ledgerFingerprint([{ ...base[0]!, text: "must use MySQL" }, base[1]!])).not.toBe(original);
  });
});

describe("pin candidates are proposed deterministically, never by a model (WS-R24)", () => {
  const text = [
    "# Reviewer prompt",
    "- You must validate inputs before acting.",
    "* Never log credentials.",
    "1. Always run the test suite.",
    "Some ordinary prose that obliges nothing.",
    "- you MUST validate inputs before acting",
  ].join("\n");

  it("proposes obligation-bearing lines, de-duplicated, in order of appearance", () => {
    expect(proposeRequirementCandidates(text)).toEqual([
      "You must validate inputs before acting.",
      "Never log credentials.",
      "Always run the test suite.",
    ]);
  });

  it("is a pure function of the text — same input, same proposals", () => {
    expect(proposeRequirementCandidates(text)).toEqual(proposeRequirementCandidates(text));
  });

  it("respects the limit and ignores lines too short or too long to be requirements", () => {
    expect(proposeRequirementCandidates(text, 2)).toHaveLength(2);
    expect(proposeRequirementCandidates("must x")).toEqual([]);
    expect(proposeRequirementCandidates(`must ${"x".repeat(400)}`)).toEqual([]);
  });
});

describe("the two preservation codes stay distinguishable (WS-R28)", () => {
  it("W005 is a deterministic error and W006 is judged advice", () => {
    expect(DIAGNOSTIC_REGISTRY["FORGE-W005"]).toEqual({
      code: "FORGE-W005",
      name: "pinned_requirement_dropped",
      severity: "error",
      source: "deterministic",
    });
    expect(DIAGNOSTIC_REGISTRY["FORGE-W006"]).toEqual({
      code: "FORGE-W006",
      name: "semantic_drift",
      severity: "warning",
      source: "judged",
    });
  });
});

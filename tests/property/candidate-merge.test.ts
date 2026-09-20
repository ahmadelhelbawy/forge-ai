/**
 * V2-E — the deterministic half of candidates (`WS-R8`, `ST-R5`, `ST-R7`).
 *
 * Two pure modules are tested here as functions, with no conversation, no
 * store and no model: the duplicate gate that keeps a "candidate set" from
 * degrading into short/medium/long wordings of one prompt (`ST-R1`, `ST-R5`),
 * and the union merge whose whole job is that **nothing a source said is
 * dropped without being reported**.
 *
 * The merge is deterministic on purpose. A model-authored merge would make
 * "your pinned requirements survived" only as good as a generation call, which
 * is precisely the inversion `WS-R27` exists to forbid.
 */
import { describe, expect, it } from "vitest";

import {
  admitCandidates,
  blocksOf,
  candidateDivergence,
  isTextDuplicate,
  mergeCandidateTexts,
  MergeSourceError,
  type MergeSource,
} from "../../src/candidate/index.js";
import { isPresent } from "../../src/critic/deterministic/ledger.js";

const BASE = [
  "Build a data pipeline agent.",
  "",
  "It must use PostgreSQL.",
  "",
  "It must never log credentials.",
].join("\n");

describe("the duplicate gate is token equality, not a similarity score (ST-R5)", () => {
  it("calls two texts duplicates when only their surface differs", () => {
    expect(isTextDuplicate("It must use PostgreSQL.", "- it MUST use postgresql")).toBe(true);
  });

  it("does not call a paraphrase a duplicate", () => {
    expect(isTextDuplicate("It must use PostgreSQL.", "It must use Postgres.")).toBe(false);
  });

  it("does not call a text that adds a requirement a duplicate", () => {
    expect(isTextDuplicate(BASE, `${BASE}\n\nChange at most 5 files.`)).toBe(false);
  });

  it("is symmetric and reflexive", () => {
    expect(isTextDuplicate(BASE, BASE)).toBe(true);
    expect(isTextDuplicate(BASE, "other")).toBe(isTextDuplicate("other", BASE));
  });
});

describe("admission records every rejection rather than thinning the list quietly (INV-012)", () => {
  const proposal = (id: string, text: string) => ({ id, label: id, text });

  it("keeps genuinely different candidates and rejects a reformatted copy", () => {
    const admitted = admitCandidates([
      proposal("a", BASE),
      proposal("b", `${BASE}\n\nChange at most 5 files.`),
      proposal("c", BASE.toUpperCase()),
    ]);
    expect(admitted.accepted.map((c) => c.id)).toEqual(["a", "b"]);
    expect(admitted.rejected.map((r) => [r.candidate.id, r.against])).toEqual([["c", "a"]]);
  });

  it("emits one FORGE-W007 per rejection, naming what it duplicated", () => {
    const admitted = admitCandidates([proposal("a", BASE), proposal("b", BASE)]);
    expect(admitted.diagnostics).toHaveLength(1);
    const [finding] = admitted.diagnostics;
    expect(finding?.code).toBe("FORGE-W007");
    expect(finding?.message).toContain("b");
    expect(finding?.message).toContain("a");
  });

  it("admits everything and says nothing when every candidate is distinct", () => {
    const admitted = admitCandidates([proposal("a", "one"), proposal("b", "two"), proposal("c", "three")]);
    expect(admitted.accepted).toHaveLength(3);
    expect(admitted.diagnostics).toEqual([]);
  });

  it("is a pure function: the same proposals admit the same way every time", () => {
    const input = [proposal("a", BASE), proposal("b", BASE), proposal("c", "different entirely")];
    expect(JSON.stringify(admitCandidates(input))).toEqual(JSON.stringify(admitCandidates(input)));
  });
});

describe("divergence is a measure of difference, never a quality score (INV-008)", () => {
  it("counts shared and unique blocks between two candidate texts", () => {
    const a = "alpha\n\nbeta";
    const b = "alpha\n\ngamma";
    expect(candidateDivergence(a, b)).toEqual({ shared: 1, uniqueToA: 1, uniqueToB: 1 });
  });

  it("reports zero unique blocks for a reformatted copy", () => {
    expect(candidateDivergence(BASE, BASE.toUpperCase())).toEqual({ shared: 3, uniqueToA: 0, uniqueToB: 0 });
  });
});

describe("blocks are paragraphs, normalized only for comparison", () => {
  it("splits on blank lines and keeps each block's original text", () => {
    expect(blocksOf("one\ntwo\n\n\nthree\n").map((b) => b.text)).toEqual(["one\ntwo", "three"]);
  });

  it("gives two surface variants of one paragraph the same key", () => {
    const [plain] = blocksOf("It must use PostgreSQL.");
    const [bulleted] = blocksOf("- it must use postgresql");
    expect(plain?.key).toEqual(bulleted?.key);
  });
});

describe("merge is a union: every source block reaches the result (WS-R8)", () => {
  const source = (id: string, text: string): MergeSource => ({ id, label: id, text });

  const SURGICAL = [
    "Build a data pipeline agent.",
    "",
    "It must use PostgreSQL.",
    "",
    "Change at most 5 files.",
  ].join("\n");

  const RIGOROUS = [
    "Build a data pipeline agent.",
    "",
    "It must never log credentials.",
    "",
    "Run the full test suite before reporting done.",
  ].join("\n");

  it("keeps every block of every source, de-duplicated, in first-appearance order", () => {
    const merged = mergeCandidateTexts([source("a", SURGICAL), source("b", RIGOROUS)]);
    expect(merged.blocks.map((b) => b.text)).toEqual([
      "Build a data pipeline agent.",
      "It must use PostgreSQL.",
      "Change at most 5 files.",
      "It must never log credentials.",
      "Run the full test suite before reporting done.",
    ]);
    expect(merged.text).toBe(merged.blocks.map((b) => b.text).join("\n\n"));
  });

  it("attributes a shared block to every source that carried it", () => {
    const merged = mergeCandidateTexts([source("a", SURGICAL), source("b", RIGOROUS)]);
    expect(merged.blocks[0]?.sourceIds).toEqual(["a", "b"]);
    expect(merged.blocks[1]?.sourceIds).toEqual(["a"]);
    expect(merged.blocks[4]?.sourceIds).toEqual(["b"]);
  });

  it("reports how many blocks each source contributed and how many it shared", () => {
    const merged = mergeCandidateTexts([source("a", SURGICAL), source("b", RIGOROUS)]);
    expect(merged.contributions).toEqual([
      { sourceId: "a", label: "a", blocks: 3, unique: 2, shared: 1 },
      { sourceId: "b", label: "b", blocks: 3, unique: 2, shared: 1 },
    ]);
  });

  it("drops nothing: every block of every source is present in the merged text", () => {
    const merged = mergeCandidateTexts([source("a", SURGICAL), source("b", RIGOROUS)]);
    for (const text of [SURGICAL, RIGOROUS]) {
      for (const block of blocksOf(text)) {
        expect(isPresent(merged.text, block.text)).toBe(true);
      }
    }
  });

  it("preserves the first source's block order, so anything contiguous in it stays contiguous", () => {
    const merged = mergeCandidateTexts([source("a", SURGICAL), source("b", RIGOROUS)]);
    const fromA = merged.blocks.filter((b) => b.sourceIds.includes("a")).map((b) => b.text);
    expect(fromA).toEqual(blocksOf(SURGICAL).map((b) => b.text));
    expect(isPresent(merged.text, SURGICAL)).toBe(true);
  });

  it("merges three sources as readily as two", () => {
    const merged = mergeCandidateTexts([
      source("a", "alpha"),
      source("b", "beta"),
      source("c", "gamma"),
    ]);
    expect(merged.text).toBe("alpha\n\nbeta\n\ngamma");
  });

  it("is deterministic and involves no clock, model or randomness (INV-005)", () => {
    const sources = [source("a", SURGICAL), source("b", RIGOROUS)];
    expect(mergeCandidateTexts(sources)).toEqual(mergeCandidateTexts(sources));
  });

  it("refuses fewer than two sources, because MERGE needs two artifacts (WS-R5)", () => {
    expect(() => mergeCandidateTexts([source("a", SURGICAL)])).toThrow(MergeSourceError);
    expect(() => mergeCandidateTexts([])).toThrow(MergeSourceError);
  });

  it("refuses two sources that are the same artifact", () => {
    expect(() => mergeCandidateTexts([source("a", SURGICAL), source("a", RIGOROUS)])).toThrow(MergeSourceError);
  });

  it("refuses a source with no content, rather than merging a hole into the result", () => {
    expect(() => mergeCandidateTexts([source("a", SURGICAL), source("b", "   \n\n ")])).toThrow(MergeSourceError);
  });
});

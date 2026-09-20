/**
 * V2-D2 — semantic drift, the judged advisory layer (WS-R26…WS-R29, DG-R3, DG-R4).
 *
 * Two things are under test, and only one of them is the matcher.
 *
 * The first is **status**: every finding is `judged`/`warning`, cites both
 * versions, is discarded when its citation does not resolve, stays out of
 * pinned material, and — asserted in `preservation.ts`'s own describe block —
 * cannot reach a Layer 1 diagnostic at all (AC-041).
 *
 * The second is the **false-alarm rate**, measured on real extracted IRs from
 * the frozen P1.6 corpus and the IR fixtures rather than on inputs written to
 * flatter it. The measurement is what V2-D2's exit gate asks for, and the
 * number it produces is recorded in `plan.md`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CHANGED_BELOW,
  VANISHED_BELOW,
  compareVersionIrs,
  driftStatements,
  renderStatements,
  similarity,
} from "../../src/critic/judged/drift.js";
import {
  LayerConfusionError,
  preservationFailed,
  preservationResult,
} from "../../src/critic/preservation.js";
import { checkRequirementLedger, type LedgerEntry } from "../../src/critic/deterministic/ledger.js";
import { attributeDraft, userInputSegment } from "../../src/ir/attribution.js";
import { diagnostic, measureEvidence } from "../../src/ir/diagnostic.js";
import { DraftIRSchema, parseTaskIR, type TaskIR } from "../../src/ir/schema.js";

/* -------------------------------------------------------------------------- */
/* Real IRs: extracted by a real model, replayed from committed evidence.      */
/* -------------------------------------------------------------------------- */

function irsFromCassettes(): TaskIR[] {
  const out: TaskIR[] = [];
  for (const dir of ["evals/p16/evidence/cassettes", "fixtures/cassettes"]) {
    for (const file of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const cassette = JSON.parse(readFileSync(`${dir}/${file}`, "utf8")) as {
        boundaryId: string;
        responseText: string;
      };
      if (cassette.boundaryId !== "intent.extract") continue;
      let payload: unknown;
      try {
        payload = JSON.parse(cassette.responseText);
      } catch {
        // A truncated recording is evidence of nothing; skip it rather than
        // repairing model output to make a corpus bigger.
        continue;
      }
      const draft = DraftIRSchema.safeParse(payload);
      if (!draft.success) continue;
      out.push(attributeDraft(draft.data, [userInputSegment("s1")]));
    }
  }
  for (const file of readdirSync("fixtures/ir").filter((n) => n.endsWith(".json"))) {
    const parsed = parseTaskIR(JSON.parse(readFileSync(`fixtures/ir/${file}`, "utf8")));
    out.push(parsed);
  }
  return out;
}

const CORPUS = irsFromCassettes();

/**
 * A meaning-preserving reformatting of an IR.
 *
 * Every change here is surface: node ids are renumbered, statements are
 * re-cased, re-wrapped, bulleted and re-punctuated at their boundaries, and
 * the node order is reversed. A drift finding between an IR and this is a
 * false alarm **by construction** — which is what makes the rate below a
 * measurement rather than an opinion.
 *
 * Sentence punctuation is dropped only where it separates words from
 * whitespace or the end of the text. Removing a dot from inside `tokens.json`
 * would fuse two tokens into one, which is a change to the words rather than
 * to their presentation — and the first draft of this helper did exactly that,
 * turning a fixture bug into eleven "false alarms".
 */
function reformat(ir: TaskIR): TaskIR {
  const surface = (text: string): string =>
    `- ${text.toUpperCase().replace(/([.;,])(\s|$)/g, "$2").replace(/\s+/g, "\n  ")} .`;
  const raw = JSON.parse(JSON.stringify(ir)) as TaskIR;
  return {
    ...raw,
    goals: [...raw.goals].reverse().map((g, i) => ({ ...g, id: `g${90 + i}`, statement: surface(g.statement) })),
    constraints: [...raw.constraints]
      .reverse()
      .map((c, i) => ({ ...c, id: `c${90 + i}`, statement: surface(c.statement) })),
    non_goals: [...raw.non_goals].reverse().map((n, i) => ({ ...n, id: `n${90 + i}`, statement: surface(n.statement) })),
  } as TaskIR;
}

const pin = (id: string, text: string): LedgerEntry => ({
  id,
  text,
  contentHash: `sha256:${id.padEnd(64, "0")}`,
  origin: "user_input",
});

describe("a drift finding is judged advice, and says so (WS-R26, DG-R3)", () => {
  const before = CORPUS[0]!;
  const after: TaskIR = {
    ...before,
    constraints: before.constraints.slice(1),
  } as TaskIR;

  it("emits FORGE-W006 at warning severity from the judged source", () => {
    const report = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: after });
    expect(report.layer).toBe("judged");
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.diagnostic.code).toBe("FORGE-W006");
      expect(finding.diagnostic.severity).toBe("warning");
      expect(finding.diagnostic.source).toBe("judged");
      expect(finding.diagnostic.message).toContain("Advisory");
      expect(finding.diagnostic.message).toContain("not a guarantee");
    }
  });

  it("cites both versions' statements, and both citations resolve (WS-R26, DG-R4)", () => {
    const report = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: after });
    const renderings: Record<string, string> = {
      "version/1/ir-statements": renderStatements(driftStatements(before)),
      "version/2/ir-statements": renderStatements(driftStatements(after)),
    };
    for (const finding of report.findings) {
      expect(finding.diagnostic.evidence).toHaveLength(2);
      for (const evidence of finding.diagnostic.evidence) {
        expect(evidence.kind).toBe("span");
        if (evidence.kind !== "span") continue;
        const source = renderings[evidence.artifact_path];
        expect(source).toBeDefined();
        expect(source!.slice(evidence.start, evidence.end)).toBe(evidence.quote);
      }
    }
  });

  it("discards a finding whose citation cannot resolve, silently (DG-R4)", () => {
    // An IR with no requirement-bearing statements gives nothing to cite in
    // the later version, so there is nothing a reader could check.
    const empty = { ...before, goals: [], constraints: [], non_goals: [] } as TaskIR;
    const report = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: empty });
    expect(report.findings).toEqual([]);
    expect(report.discarded).toBe(report.compared);
  });

  it("stays out of pinned material — that is Layer 1's answer to give (WS-R26)", () => {
    const pinnedText = before.constraints[0]!.statement;
    const report = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: after }, { pinned: [pinnedText] });
    expect(report.skippedPinned).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.from.statement).not.toBe(pinnedText);
    }
  });

  it("reports nothing for an unchanged version", () => {
    const report = compareVersionIrs({ v: 1, ir: before }, { v: 2, ir: before });
    expect(report.findings).toEqual([]);
    expect(report.compared).toBeGreaterThan(0);
  });

  it("separates a vanished statement from a changed one by the published thresholds", () => {
    expect(similarity("must use PostgreSQL", "must use PostgreSQL")).toBe(1);
    expect(similarity("- MUST USE\n POSTGRESQL .", "must use PostgreSQL")).toBe(1);
    expect(similarity("must use PostgreSQL", "must use MySQL")).toBeLessThan(CHANGED_BELOW);
    expect(similarity("must use PostgreSQL", "ship the release notes on Friday")).toBeLessThan(VANISHED_BELOW);
  });
});

describe("the judged layer can never weaken the pinned layer (AC-041, WS-R27)", () => {
  const entries = [pin("r1", "must use PostgreSQL")];
  const ledger = checkRequirementLedger(entries, "a version with no database in it", 2);

  it("keeps a ledger error intact beside a drift report that contradicts it", () => {
    // The adversarial case the acceptance criterion names: a judged finding
    // that claims the pinned requirement is fine.
    const contradicting = {
      from: 1,
      to: 2,
      layer: "judged" as const,
      compared: 1,
      skippedPinned: 0,
      discarded: 0,
      findings: [
        {
          kind: "changed" as const,
          from: { id: "c1", kind: "constraint" as const, statement: "must use PostgreSQL" },
          nearest: { id: "c1", kind: "constraint" as const, statement: "must use PostgreSQL" },
          similarity: 1,
          diagnostic: diagnostic(
            "FORGE-W006",
            "The PostgreSQL requirement is preserved; the ledger finding can be resolved.",
            [{ kind: "span", artifact_path: "version/1/ir-statements", start: 0, end: 1, quote: "x" }],
          ),
        },
      ],
    };

    const withJudged = preservationResult(ledger, contradicting);
    const withoutJudged = preservationResult(ledger, null);

    expect(withJudged.ledger).toBe(ledger);
    expect(withJudged.ledger.diagnostics).toHaveLength(1);
    expect(withJudged.ledger.diagnostics[0]!.severity).toBe("error");
    expect(preservationFailed(withJudged)).toBe(true);
    // AC-040 restated where the layers meet: the verdict is the same either way.
    expect(JSON.stringify(withJudged.ledger)).toBe(JSON.stringify(withoutJudged.ledger));
    expect(preservationFailed(withoutJudged)).toBe(true);
  });

  it("refuses to carry a deterministic code in the judged half, or the reverse", () => {
    const smuggled = {
      from: 1,
      to: 2,
      layer: "judged" as const,
      compared: 0,
      skippedPinned: 0,
      discarded: 0,
      findings: [
        {
          kind: "vanished" as const,
          from: { id: "c1", kind: "constraint" as const, statement: "x" },
          nearest: { id: "c2", kind: "constraint" as const, statement: "y" },
          similarity: 0,
          diagnostic: diagnostic("FORGE-W005", "pretending to be the guarantee", [
            measureEvidence("dropped_in_version", 2, "version"),
          ]),
        },
      ],
    };
    expect(() => preservationResult(ledger, smuggled)).toThrow(LayerConfusionError);
  });

  it("offers no operation that merges the two layers", () => {
    const result = preservationResult(ledger, null);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["drift", "ledger"]);
    // `preservationFailed` reads Layer 1 alone: its argument is the whole
    // result, and its answer does not move when the judged half changes.
    expect(preservationFailed(result)).toBe(true);
  });

  it("treats a silent judged layer as no evidence at all (WS-R27.2)", () => {
    const quiet = compareVersionIrs({ v: 1, ir: CORPUS[0]! }, { v: 2, ir: CORPUS[0]! });
    expect(quiet.findings).toEqual([]);
    // A pinned requirement that is genuinely absent stays absent.
    const result = preservationResult(ledger, quiet);
    expect(preservationFailed(result)).toBe(true);
    expect(result.ledger.findings.every((f) => !f.present)).toBe(true);
  });
});

describe("false-alarm rate on the eval corpus (V2-D2 exit gate)", () => {
  it("has a corpus of real extracted IRs to measure on", () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(10);
    expect(CORPUS.some((ir) => ir.constraints.length > 0)).toBe(true);
  });

  it("raises no finding when meaning is unchanged and only the surface moved", () => {
    let statements = 0;
    let falseAlarms = 0;
    const offenders: string[] = [];
    for (const [index, ir] of CORPUS.entries()) {
      const report = compareVersionIrs({ v: 1, ir }, { v: 2, ir: reformat(ir) });
      statements += report.compared;
      falseAlarms += report.findings.length;
      for (const finding of report.findings) offenders.push(`#${index} ${finding.from.statement}`);
    }
    const rate = statements === 0 ? 0 : falseAlarms / statements;
    // Printed so the number recorded in plan.md comes from a run, not a guess.
    console.log(
      `[V2-D2] false-alarm rate: ${falseAlarms}/${statements} statements = ${(rate * 100).toFixed(2)}% ` +
        `over ${CORPUS.length} real IRs`,
    );
    expect(offenders).toEqual([]);
    expect(rate).toBe(0);
  });

  it("is not vacuous: a genuinely dropped statement is still caught", () => {
    let caught = 0;
    let attempted = 0;
    for (const ir of CORPUS) {
      if (ir.constraints.length === 0) continue;
      attempted += 1;
      const dropped = { ...ir, constraints: ir.constraints.slice(1) } as TaskIR;
      const report = compareVersionIrs({ v: 1, ir }, { v: 2, ir: dropped });
      if (report.findings.some((f) => f.from.statement === ir.constraints[0]!.statement)) caught += 1;
    }
    console.log(`[V2-D2] dropped-constraint detection: ${caught}/${attempted}`);
    expect(attempted).toBeGreaterThan(0);
    expect(caught / attempted).toBeGreaterThan(0.8);
  });
});

/**
 * V2-G verdict rules (`FR-053`, `EV-R4`–`EV-R6`, `AC-047`, `AC-049`).
 *
 * The matrix below is the whole rule table of `spec.md` §11.1 run exhaustively:
 * every obligation kind × every evidence shape × every exit-code case. A verdict
 * FORGE produces that is not in this table is a defect.
 */
import { describe, expect, it } from "vitest";

import { verifyPackage, type VerdictReport } from "../../src/verify/verdict.js";
import { EvidenceShapeError } from "../../src/verify/evidence.js";
import { expectedExitCode } from "../../src/verify/obligations.js";
import { buildPackage, evidenceText, filesOf, fourKindIr, record, sha } from "../helpers/verify.js";

const PKG = buildPackage();
const FILES = filesOf(PKG);
const ID = PKG.semanticId;

const run = (records: Record<string, unknown>[], logHashes = new Map<string, string | null>()): VerdictReport =>
  verifyPackage({ files: FILES, evidence: evidenceText(records), logHashes });

const verdictOf = (report: VerdictReport, id: string) => report.verdicts.find((v) => v.obligation_id === id)!;

describe("the package under test really has every kind (guards the matrix)", () => {
  it("declares command, test, review and manual obligations, none degraded", () => {
    const verification = JSON.parse(FILES.get("verification.json")!) as {
      entries: Array<{ id: string; kind: string; degraded_from: string | null }>;
    };
    expect(verification.entries.map((e) => `${e.id}:${e.kind}`).sort()).toEqual([
      "v1:command",
      "v2:review",
      "v3:manual",
      "v4:test",
    ]);
    expect(verification.entries.every((e) => e.degraded_from === null)).toBe(true);
  });
});

describe("AC-047 — the kind × evidence × exit-code matrix", () => {
  const KINDS: Record<string, string> = { v1: "command", v4: "test", v2: "review", v3: "manual" };
  const SHAPES: Record<string, Array<number>> = {
    absent: [],
    pass: [0],
    fail: [1],
    "pass+fail": [0, 1],
    "pass+pass": [0, 0],
  };
  const EXPECTED: Record<string, Record<string, string>> = {
    command: { absent: "UNVERIFIED", pass: "VERIFIED", fail: "FAILED", "pass+fail": "FAILED", "pass+pass": "VERIFIED" },
    test: { absent: "UNVERIFIED", pass: "VERIFIED", fail: "FAILED", "pass+fail": "FAILED", "pass+pass": "VERIFIED" },
    review: Object.fromEntries(Object.keys(SHAPES).map((s) => [s, "REVIEW_REQUIRED"])),
    manual: Object.fromEntries(Object.keys(SHAPES).map((s) => [s, "REVIEW_REQUIRED"])),
  };

  for (const [obligation, kind] of Object.entries(KINDS)) {
    for (const [shape, codes] of Object.entries(SHAPES)) {
      it(`${kind} obligation with ${shape} evidence → ${EXPECTED[kind]![shape]}`, () => {
        const report = run(
          codes.map((exit_code) => record({ obligation_id: obligation, kind, exit_code, package_semantic_id: ID })),
        );
        expect(report.package_valid).toBe(true);
        expect(verdictOf(report, obligation).verdict).toBe(EXPECTED[kind]![shape]);
      });
    }
  }

  it("gives every obligation exactly one verdict", () => {
    const report = run([record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID })]);
    expect(report.verdicts.map((v) => v.obligation_id).sort()).toEqual(["v1", "v2", "v3", "v4"]);
  });

  it("marks every executable obligation UNVERIFIED when there is no evidence at all", () => {
    const report = run([]);
    expect(report.verdicts.map((v) => `${v.obligation_id}:${v.verdict}`)).toEqual([
      "v1:UNVERIFIED",
      "v2:REVIEW_REQUIRED",
      "v3:REVIEW_REQUIRED",
      "v4:UNVERIFIED",
    ]);
    expect(report.diagnostics.filter((d) => d.code === "FORGE-V001")).toHaveLength(2);
  });

  it("cites the exit code and the record in a FAILED verdict (FORGE-V002)", () => {
    const report = run([
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID }),
      record({ obligation_id: "v1", kind: "command", exit_code: 7, package_semantic_id: ID }),
    ]);
    const v1 = verdictOf(report, "v1");
    expect(v1.verdict).toBe("FAILED");
    expect(v1.records.map((r) => `${r.index}:${r.exit_code}`)).toEqual(["0:0", "1:7"]);
    const failed = report.diagnostics.find((d) => d.code === "FORGE-V002")!;
    expect(failed.severity).toBe("error");
    expect(failed.evidence).toContainEqual({ kind: "node", node_id: "v1" });
    expect(failed.evidence).toContainEqual(expect.objectContaining({ kind: "measure", value: 7 }));
    expect(failed.message).toContain("#1");
  });
});

describe("manual and review can never become VERIFIED", () => {
  it("ignores any quantity of passing evidence, of any claimed kind", () => {
    for (const obligation of ["v2", "v3"]) {
      for (const kind of ["manual", "review", "command", "test"]) {
        const report = run(
          [0, 0, 0].map((exit_code) => record({ obligation_id: obligation, kind, exit_code, package_semantic_id: ID })),
        );
        expect(verdictOf(report, obligation).verdict, `${obligation} with ${kind} evidence`).toBe("REVIEW_REQUIRED");
      }
    }
  });
});

describe("evidence records are untrusted (EV-R2, EV-R5)", () => {
  it("never lets evidence for a different contract verify anything (FORGE-V003)", () => {
    const other = sha("some other package");
    const report = run([record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: other })]);
    expect(verdictOf(report, "v1").verdict).toBe("UNVERIFIED");
    expect(report.diagnostics.map((d) => d.code)).toContain("FORGE-V003");
  });

  it("rejects a record for an obligation the package does not declare (FORGE-V005)", () => {
    const report = run([record({ obligation_id: "v99", kind: "command", exit_code: 0, package_semantic_id: ID })]);
    expect(report.diagnostics.map((d) => d.code)).toContain("FORGE-V005");
    expect(report.verdicts).toHaveLength(4);
  });

  it("rejects a record whose kind differs from the obligation's", () => {
    const report = run([record({ obligation_id: "v1", kind: "test", exit_code: 0, package_semantic_id: ID })]);
    expect(verdictOf(report, "v1").verdict).toBe("UNVERIFIED");
    expect(report.diagnostics.map((d) => d.code)).toContain("FORGE-V005");
  });

  it("rejects an executable record with no exit code", () => {
    const report = run([record({ obligation_id: "v1", kind: "command", exit_code: null, package_semantic_id: ID })]);
    expect(verdictOf(report, "v1").verdict).toBe("UNVERIFIED");
    expect(report.diagnostics.map((d) => d.code)).toContain("FORGE-V005");
  });

  it("rejects a record whose supplied log does not match its recorded hash", () => {
    const log = "PASS src/auth\n";
    const good = record({
      obligation_id: "v1",
      kind: "command",
      exit_code: 0,
      package_semantic_id: ID,
      stdout_hash: sha(log),
      logs: { stdout: "logs/v1.out" },
    });
    expect(verdictOf(run([good], new Map([["logs/v1.out", sha(log)]])), "v1").verdict).toBe("VERIFIED");

    const tampered = run([good], new Map([["logs/v1.out", sha("PASS src/auth\n(edited)\n")]]));
    expect(verdictOf(tampered, "v1").verdict).toBe("UNVERIFIED");
    expect(tampered.diagnostics.map((d) => d.code)).toContain("FORGE-V005");

    const missing = run([good], new Map());
    expect(verdictOf(missing, "v1").verdict).toBe("UNVERIFIED");
  });

  it("refuses a log path that escapes the evidence directory", () => {
    for (const path of ["../secrets.txt", "/etc/passwd", "logs/../../x", "C:\\x"]) {
      const r = record({
        obligation_id: "v1",
        kind: "command",
        exit_code: 0,
        package_semantic_id: ID,
        logs: { stdout: path },
      });
      const report = run([r], new Map([[path, sha("x")]]));
      expect(verdictOf(report, "v1").verdict, path).toBe("UNVERIFIED");
    }
  });

  it("rejects a malformed evidence file as a whole", () => {
    for (const bad of ["not json", "{}", '{"records":[{"obligation_id":"v1"}]}']) {
      expect(() => verifyPackage({ files: FILES, evidence: bad, logHashes: new Map() })).toThrow(EvidenceShapeError);
    }
  });

  it("refuses raw output in a record — only hashes are accepted", () => {
    const r = { ...record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID }), stdout: "AWS_SECRET=x" };
    expect(() => verifyPackage({ files: FILES, evidence: evidenceText([r]), logHashes: new Map() })).toThrow(
      EvidenceShapeError,
    );
  });
});

describe("the expected exit code (EV-R4)", () => {
  it("is N for exactly `exit N`, otherwise 0", () => {
    expect(expectedExitCode("exit 0")).toBe(0);
    expect(expectedExitCode("exit 2")).toBe(2);
    expect(expectedExitCode("matches")).toBe(0);
    expect(expectedExitCode("exit two")).toBe(0);
  });

  it("verifies against a non-zero expectation", () => {
    const ir = fourKindIr() as unknown as { verification: Array<Record<string, unknown>> };
    ir.verification.find((v) => v.id === "v1")!["expected"] = "exit 2";
    const pkg = buildPackage(ir as never);
    const verify = (exit_code: number) =>
      verifyPackage({
        files: filesOf(pkg),
        evidence: evidenceText([record({ obligation_id: "v1", kind: "command", exit_code, package_semantic_id: pkg.semanticId })]),
        logHashes: new Map(),
      }).verdicts.find((v) => v.obligation_id === "v1")!.verdict;
    expect(verify(2)).toBe("VERIFIED");
    expect(verify(0)).toBe("FAILED");
  });
});

describe("AC-049 — verdicts are deterministic (EV-R6)", () => {
  it("produces a byte-identical report for fixed package and evidence bytes", () => {
    const records = [
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID }),
      record({ obligation_id: "v4", kind: "test", exit_code: 1, package_semantic_id: ID }),
    ];
    const a = run(records);
    const b = run(records);
    expect(a.json).toBe(b.json);
    expect(a.json.endsWith("\n")).toBe(true);
  });

  it("states that FORGE executed nothing and what VERIFIED means", () => {
    const report = run([]);
    const parsed = JSON.parse(report.json) as Record<string, unknown>;
    expect(parsed["executed_by_forge"]).toBe(false);
    expect(String(parsed["caveat"])).toMatch(/taken at its word/);
  });
});

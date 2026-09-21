/**
 * The requirement traceability matrix (V2-H, `FR-058`, `spec.md` §22.10
 * TM-R1–TM-R4, `AC-056`, `AC-057`).
 *
 * The matrix is a join and nothing else. These tests hold it to that: fixed
 * inputs give the same bytes, every column traces to an input that already
 * held it, a verdict lands only on the requirements its obligation satisfies,
 * superseded rows survive, and advisory links can never land in an
 * authoritative column — whatever shape the caller hands in.
 */
import { describe, expect, it } from "vitest";

import { contentHash } from "../../src/ir/canonical.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import type { LedgerEntry } from "../../src/critic/deterministic/ledger.js";
import { requirementId } from "../../src/requirement/identity.js";
import { recordDecisions } from "../../src/requirement/governance.js";
import type { AdvisoryLink, LinkageResult } from "../../src/requirement/linkage.js";
import { buildTraceabilityMatrix, type MatrixInput } from "../../src/requirement/traceability.js";

const GOAL_A = "Passwords are hashed with bcrypt before storage";
const GOAL_B = "Sessions expire after thirty minutes of inactivity";
const PINNED = "The login endpoint returns 429 after five failed attempts";
const A = requirementId(GOAL_A);
const B = requirementId(GOAL_B);
const P = requirementId(PINNED);

function ir(): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: { statement: "Harden auth", kind: "feature", success_definition: "Policy holds", source_ref: "user_input" },
    goals: [
      { id: "g1", statement: GOAL_A, acceptance: ["hashes stored"], priority: "must", source_ref: "user_input" },
      { id: "g2", statement: GOAL_B, acceptance: ["idle sessions expire"], priority: "must", source_ref: "user_input" },
    ],
    constraints: [],
    non_goals: [],
    scope: { include: ["src/**"], exclude: [], blast_radius: "module", source_ref: "user_input" },
    context_refs: [],
    deliverables: [{ id: "d1", description: "A patch to the auth module", kind: "code_change", source_ref: "user_input" }],
    verification: [
      { id: "v1", kind: "test", spec: "pnpm test auth", expected: "exit 0", satisfies: ["g1"], source_ref: "user_input" },
      { id: "v2", kind: "manual", spec: "check idle expiry", expected: "session gone", satisfies: ["g2"], source_ref: "user_input" },
    ],
    assumptions: [],
    open_questions: [],
    risk: { level: "medium", factors: [] },
    required_capabilities: [],
  });
}

const ledger: LedgerEntry[] = [{ id: "k1", text: PINNED, contentHash: contentHash(PINNED), origin: "user_input" }];

const linkage: LinkageResult = {
  authoritative: [
    {
      advisory: false,
      requirement_id: A,
      path: "src/auth/password.ts",
      kind: "file",
      evidence: [{ type: "rg_term", matched_terms: ["bcrypt", "hash", "password"], matched: 3, of: 4, required: 3 }],
    },
    {
      advisory: false,
      requirement_id: A,
      path: "tests/password.test.ts",
      kind: "test",
      evidence: [{ type: "test_naming", matched_terms: ["password", "hash"] }],
    },
  ],
  excluded: [],
  redacted: [],
  notes: [],
  diagnostics: [],
};

const advisory: AdvisoryLink[] = [
  { advisory: true, requirement_id: B, path: "src/auth/session.ts", source: "user_asserted", note: "I think it's here" },
];

function input(overrides: Partial<MatrixInput> = {}): MatrixInput {
  const theIr = ir();
  return {
    ledger,
    ir: theIr,
    log: recordDecisions({ ledger, ir: theIr }, [{ kind: "accept", requirement_id: A }]),
    package_semantic_id: "sha256:" + "a".repeat(64),
    spans: [
      { artifact_path: "CLAUDE.md", start: 10, end: 60, origin: { kind: "ir_node", node_id: "g1" } },
      { artifact_path: "CLAUDE.md", start: 0, end: 10, origin: { kind: "renderer_template" } },
    ],
    obligations: theIr.verification.map((v) => ({ id: v.id, kind: v.kind, spec: v.spec, expected: v.expected, satisfies: v.satisfies })),
    verdicts: {
      package_valid: true,
      package_semantic_id: "sha256:" + "a".repeat(64),
      caveat: "VERIFIED means the supplied evidence, taken at its word, shows the expected exit code.",
      verdicts: [
        { obligation_id: "v1", verdict: "VERIFIED", records: [{ index: 0 }] },
        { obligation_id: "v2", verdict: "REVIEW_REQUIRED", records: [] },
      ],
    },
    linkage,
    advisory,
    ...overrides,
  };
}

describe("TM-R1/TM-R2 — one row per requirement, a join of existing facts", () => {
  const matrix = buildTraceabilityMatrix(input());
  const row = (id: string) => matrix.rows.find((r) => r.id === id)!;

  it("carries the full chain for an IR requirement: provenance → lifecycle → node → span → links → obligation → verdict", () => {
    expect(row(A)).toMatchObject({
      text: GOAL_A,
      origin: "inferred",
      status: "accepted",
      pinned: false,
      superseded_by: null,
      active: true,
      sources: [{ kind: "ir_node", node_id: "g1", node_kind: "goal" }],
      artifact_spans: [{ artifact_path: "CLAUDE.md", start: 10, end: 60, node_id: "g1" }],
      obligations: [{ id: "v1", kind: "test", verdict: "VERIFIED", accepted_records: 1 }],
    });
    expect(row(A).files.map((l) => l.path)).toEqual(["src/auth/password.ts"]);
    expect(row(A).tests.map((l) => l.path)).toEqual(["tests/password.test.ts"]);
  });

  it("joins each verdict only to the requirements its obligation satisfies", () => {
    expect(row(B).obligations).toEqual([
      expect.objectContaining({ id: "v2", kind: "manual", verdict: "REVIEW_REQUIRED", accepted_records: 0 }),
    ]);
    // A pinned requirement with no IR node has no obligation — shown empty, never filled in.
    expect(row(P)).toMatchObject({ origin: "user_stated", status: "accepted", pinned: true, obligations: [], files: [], tests: [] });
    expect(matrix.caveat).toContain("taken at its word");
  });

  it("shows no verdict at all when no evidence was supplied, or the package was rejected", () => {
    const none = buildTraceabilityMatrix(input({ verdicts: null }));
    expect(none.rows.find((r) => r.id === A)!.obligations[0]!.verdict).toBeNull();
    expect(none.caveat).toBeNull();
    const rejected = buildTraceabilityMatrix(
      input({ verdicts: { ...input().verdicts!, package_valid: false } }),
    );
    expect(rejected.verdicts_rejected).toBe(true);
    expect(rejected.rows.every((r) => r.obligations.every((o) => o.verdict === null))).toBe(true);
  });

  it("keeps a superseded requirement's row, with its successor named", () => {
    const theIr = ir();
    const log = recordDecisions({ ledger, ir: theIr }, [{ kind: "supersede", requirement_id: B, successor_id: A }]);
    const matrix2 = buildTraceabilityMatrix(input({ log }));
    expect(matrix2.rows.find((r) => r.id === B)).toMatchObject({ status: "superseded", superseded_by: A, active: false });
  });

  it("states an unextracted IR and an unbound repository rather than inventing either", () => {
    const bare = buildTraceabilityMatrix(input({ ir: null, spans: null, obligations: null, linkage: null, log: [] }));
    expect(bare.ir_extracted).toBe(false);
    expect(bare.repository_bound).toBe(false);
    expect(bare.rows.map((r) => r.id)).toEqual([P]);
  });
});

describe("LK-R4 / AC-056 — advisory links never reach an authoritative column", () => {
  it("keeps advisory links in their own field, labelled advisory", () => {
    const matrix = buildTraceabilityMatrix(input());
    const b = matrix.rows.find((r) => r.id === B)!;
    expect(b.files).toEqual([]);
    expect(b.tests).toEqual([]);
    expect(b.advisory_links).toEqual([expect.objectContaining({ advisory: true, path: "src/auth/session.ts" })]);
  });

  it("forces advisory:true even when a caller mislabels an advisory link", () => {
    const mislabelled = [{ ...advisory[0]!, advisory: false }] as unknown as AdvisoryLink[];
    const matrix = buildTraceabilityMatrix(input({ advisory: mislabelled }));
    const b = matrix.rows.find((r) => r.id === B)!;
    expect(b.files).toEqual([]);
    expect(b.advisory_links[0]!.advisory).toBe(true);
    for (const r of matrix.rows) for (const l of [...r.files, ...r.tests]) expect(l.advisory).toBe(false);
  });

  it("drops an 'authoritative' link that carries no deterministic evidence", () => {
    const forged: LinkageResult = {
      ...linkage,
      authoritative: [
        { advisory: false, requirement_id: B, path: "src/forged.ts", kind: "file", evidence: [{ type: "scope_glob", glob: "src/**" }] },
      ],
    };
    const b = buildTraceabilityMatrix(input({ linkage: forged })).rows.find((r) => r.id === B)!;
    expect(b.files).toEqual([]);
  });
});

describe("TM-R3 — deterministic", () => {
  it("is byte-identical for fixed inputs", () => {
    const one = buildTraceabilityMatrix(input()).json;
    const two = buildTraceabilityMatrix(JSON.parse(JSON.stringify(input())) as MatrixInput).json;
    expect(two).toBe(one);
    expect(one).not.toMatch(/"(at|timestamp|generated_at)"/);
  });
});

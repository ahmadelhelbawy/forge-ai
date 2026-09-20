/**
 * Semantic validation — AC-007, AC-010, INV-002, INV-006, INV-007.
 *
 * Each fixture must produce EXACTLY its expected set of diagnostic codes. Asserting
 * exact sets rather than "contains" is deliberate: a check that starts firing
 * spuriously is as much a defect as one that stops firing.
 */
import { describe, expect, it } from "vitest";

import { codesOf, diagnostic, EmptyEvidenceError, hasErrors } from "../../src/ir/diagnostic.js";
import { advisoryNodeIds, checkIntegrity } from "../../src/ir/integrity.js";
import { semanticHash } from "../../src/ir/projection.js";
import {
  AssumptionSchema,
  ConstraintSchema,
  DeliverableSchema,
  GoalSchema,
  NonGoalSchema,
  ObjectiveSchema,
  OpenQuestionSchema,
  ScopeSchema,
  VerificationSchema,
  parseTaskIR,
} from "../../src/ir/schema.js";
import { resolveTrust } from "../../src/ir/trust.js";
import { AGENT_STEERING } from "../../src/ir/vocabulary.js";
import { clone, loadFixture, readFixtureRaw } from "../helpers/fixtures.js";

describe("fixtures produce exactly their expected diagnostics", () => {
  it("auth-debug is clean", () => {
    expect(codesOf(checkIntegrity(loadFixture("auth-debug")))).toEqual([]);
  });

  it("bloated reports one C010 per unjustified reference (INV-006)", () => {
    const diagnostics = checkIntegrity(loadFixture("bloated"));
    // ctx2 and ctx3 justify nothing; ctx4 justifies a goal that does not exist.
    expect(codesOf(diagnostics)).toEqual(["FORGE-C010", "FORGE-C010", "FORGE-C010"]);
    expect(hasErrors(diagnostics)).toBe(true);

    const cited = diagnostics.flatMap((d) =>
      d.evidence.filter((e) => e.kind === "node").map((e) => e.node_id),
    );
    expect(cited).toContain("ctx2");
    expect(cited).toContain("ctx3");
    expect(cited).toContain("ctx4");
  });

  it("untrusted-instruction refuses via C050 (INV-002)", () => {
    const diagnostics = checkIntegrity(loadFixture("untrusted-instruction"));
    expect(codesOf(diagnostics)).toEqual(["FORGE-C050"]);
    expect(hasErrors(diagnostics)).toBe(true);
    expect(diagnostics[0]!.severity).toBe("error");
  });

  it("semi-trusted-instruction warns via C052 without refusing", () => {
    const diagnostics = checkIntegrity(loadFixture("semi-trusted-instruction"));
    expect(codesOf(diagnostics)).toEqual(["FORGE-C052"]);
    expect(hasErrors(diagnostics)).toBe(false);
    expect(diagnostics[0]!.severity).toBe("warning");
  });

  /**
   * The trust-laundering channel closed in the P1.4 pass. Before it, this fixture
   * produced NO diagnostics at all: the trust check walked instruction-bearing nodes
   * only, so an assumption sourced from an untrusted page and a question sourced from a
   * repository file were invisible to it — and rendered in the artifact as ordinary,
   * unattributed content.
   */
  it("laundered-influence refuses an untrusted assumption and demotes a semi-trusted question", () => {
    const diagnostics = checkIntegrity(loadFixture("laundered-influence"));
    expect(codesOf(diagnostics)).toEqual(["FORGE-C050", "FORGE-C052"]);
    expect(hasErrors(diagnostics)).toBe(true);

    const untrusted = diagnostics.find((d) => d.code === "FORGE-C050")!;
    expect(untrusted.severity).toBe("error");
    expect(untrusted.message).toContain("assumption");
    expect(untrusted.message).toContain("authoritative premise");
    expect(untrusted.evidence.map((e) => (e.kind === "node" ? e.node_id : ""))).toContain("a1");

    const semi = diagnostics.find((d) => d.code === "FORGE-C052")!;
    expect(semi.message).toContain("open question");
    expect(semi.evidence.map((e) => (e.kind === "node" ? e.node_id : ""))).toContain("q1");
  });
});

describe("every agent-steering node carries provenance (IR-R5, INV-002)", () => {
  /**
   * A structural check on the SCHEMA, not on a fixture. If a node kind joins the
   * agent-steering set without a `source_ref` field, its trust cannot be resolved even
   * in principle — which is exactly how `open_questions` came to be unattributable.
   */
  const SCHEMA_BY_KIND = {
    objective: ObjectiveSchema,
    goals: GoalSchema,
    constraints: ConstraintSchema,
    non_goals: NonGoalSchema,
    verification: VerificationSchema,
    deliverables: DeliverableSchema,
    scope: ScopeSchema,
    assumptions: AssumptionSchema,
    open_questions: OpenQuestionSchema,
  } as const;

  it("covers exactly the AGENT_STEERING set, so a new kind cannot be forgotten", () => {
    expect(Object.keys(SCHEMA_BY_KIND).sort()).toEqual([...AGENT_STEERING].sort());
  });

  for (const kind of AGENT_STEERING) {
    it(`${kind} declares source_ref`, () => {
      expect(SCHEMA_BY_KIND[kind].shape.source_ref).toBeDefined();
    });
  }

  it("rejects an open question with no source_ref", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    delete (raw["open_questions"] as Array<Record<string, unknown>>)[0]!["source_ref"];
    expect(() => parseTaskIR(raw)).toThrow();
  });
});

describe("trust resolution (IR-R7, SC-R1)", () => {
  it("resolves the first-party sources as trusted", () => {
    const ir = loadFixture("auth-debug");
    expect(resolveTrust(ir, "user_input")).toBe("trusted");
    expect(resolveTrust(ir, "forge_derived")).toBe("trusted");
    expect(resolveTrust(ir, "st_surgical")).toBe("trusted");
  });

  it("resolves a context reference to that reference's tier", () => {
    const ir = loadFixture("auth-debug");
    expect(resolveTrust(ir, "ctx1")).toBe("semi_trusted");
  });

  it("is total and FAILS CLOSED on an unresolvable source", () => {
    const ir = loadFixture("auth-debug");
    expect(resolveTrust(ir, "ctx999")).toBe("untrusted");
  });

  it("reports an unresolvable source from two angles: C090 and C050", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    (raw["constraints"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx999";
    const codes = codesOf(checkIntegrity(parseTaskIR(raw)));
    expect(codes).toContain("FORGE-C090");
    expect(codes).toContain("FORGE-C050");
  });

  it("applies trust rules to EVERY agent-steering node kind (IR-R5, SC-R1)", () => {
    // Untrusted material must not slip in through ANY steering field — instruction-
    // bearing or influence-bearing. `assumptions` and `open_questions` are here because
    // their absence was the laundering channel: a premise or a question is read as
    // guidance by whatever reads the artifact.
    const mutations: Array<[string, (raw: Record<string, unknown>) => void]> = [
      ["objective", (r) => void ((r["objective"] as Record<string, unknown>)["source_ref"] = "ctx99")],
      ["scope", (r) => void ((r["scope"] as Record<string, unknown>)["source_ref"] = "ctx99")],
      ["goal", (r) => void ((r["goals"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99")],
      [
        "constraint",
        (r) => void ((r["constraints"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
      [
        "non_goal",
        (r) => void ((r["non_goals"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
      [
        "verification",
        (r) => void ((r["verification"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
      [
        "deliverable",
        (r) => void ((r["deliverables"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
      [
        "assumption",
        (r) => void ((r["assumptions"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
      [
        "open_question",
        (r) => void ((r["open_questions"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx99"),
      ],
    ];

    // The mutation list must cover every steering kind, so adding a kind without
    // extending this test fails rather than passing silently.
    expect(mutations).toHaveLength(AGENT_STEERING.length);

    for (const [label, mutate] of mutations) {
      const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
      (raw["context_refs"] as Array<Record<string, unknown>>).push({
        id: "ctx99",
        uri: "web://example.invalid/page",
        role: "background",
        trust: "untrusted",
        justifies: ["g1"],
        content_hash: null,
      });
      mutate(raw);
      const codes = codesOf(checkIntegrity(parseTaskIR(raw)));
      expect(codes, `${label} sourced from untrusted content must raise C050`).toContain(
        "FORGE-C050",
      );
    }
  });

  it("marks every semi-trusted steering node for advisory relocation", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    // ctx1 is semi_trusted in this fixture.
    (raw["assumptions"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx1";
    (raw["open_questions"] as Array<Record<string, unknown>>)[0]!["source_ref"] = "ctx1";
    const ir = parseTaskIR(raw);

    expect(advisoryNodeIds(ir).has("a1")).toBe(true);
    expect(advisoryNodeIds(ir).has("q1")).toBe(true);
    // And the diagnostic agrees, because both read the same enumeration.
    expect(codesOf(checkIntegrity(ir)).filter((c) => c === "FORGE-C052")).toHaveLength(2);
  });
});

describe("context role restriction (C053)", () => {
  it("rejects an untrusted reference claiming constraint_source", () => {
    const raw = clone(readFixtureRaw("untrusted-instruction")) as Record<string, unknown>;
    (raw["context_refs"] as Array<Record<string, unknown>>)[0]!["role"] = "constraint_source";
    expect(codesOf(checkIntegrity(parseTaskIR(raw)))).toContain("FORGE-C053");
  });

  it("permits a semi-trusted reference to be a constraint_source", () => {
    const codes = codesOf(checkIntegrity(loadFixture("semi-trusted-instruction")));
    expect(codes).not.toContain("FORGE-C053");
  });
});

describe("referential integrity", () => {
  it("reports a duplicate id once (C091)", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    const goals = raw["goals"] as Array<Record<string, unknown>>;
    goals.push({ ...clone(goals[0]!), statement: "A different goal reusing an id" });
    const codes = codesOf(checkIntegrity(parseTaskIR(raw)));
    expect(codes.filter((c) => c === "FORGE-C091")).toHaveLength(1);
  });

  it("reports a duplicate id across different collections (C091)", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    // A context ref and an assumption cannot collide by prefix, so force the case.
    (raw["assumptions"] as Array<Record<string, unknown>>).push({
      id: "a1",
      statement: "A duplicate assumption id",
      confidence: "low",
      source_ref: "forge_derived",
    });
    expect(codesOf(checkIntegrity(parseTaskIR(raw)))).toContain("FORGE-C091");
  });

  it("reports a dangling verification target (C090)", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    (raw["verification"] as Array<Record<string, unknown>>)[0]!["satisfies"] = ["g99"];
    expect(codesOf(checkIntegrity(parseTaskIR(raw)))).toContain("FORGE-C090");
  });

  it("reports a dangling default_assumption_ref (C090)", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    (raw["open_questions"] as Array<Record<string, unknown>>)[0]!["default_assumption_ref"] = "a99";
    expect(codesOf(checkIntegrity(parseTaskIR(raw)))).toContain("FORGE-C090");
  });
});

describe("stored hash verification (C092)", () => {
  it("accepts a correct stored hash", () => {
    const ir = loadFixture("auth-debug");
    const withHash = parseTaskIR({ ...readFixtureRaw("auth-debug"), semantic_hash: semanticHash(ir) });
    expect(codesOf(checkIntegrity(withHash))).not.toContain("FORGE-C092");
  });

  it("reports a stale stored hash", () => {
    const ir = loadFixture("auth-debug");
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    raw["semantic_hash"] = semanticHash(ir);
    (raw["goals"] as Array<Record<string, unknown>>)[0]!["statement"] = "Something else entirely";
    expect(codesOf(checkIntegrity(parseTaskIR(raw)))).toContain("FORGE-C092");
  });

  it("does not report when no hash is stored", () => {
    expect(codesOf(checkIntegrity(loadFixture("auth-debug")))).not.toContain("FORGE-C092");
  });
});

describe("diagnostic construction (INV-007)", () => {
  it("refuses to construct a diagnostic without evidence", () => {
    expect(() => diagnostic("FORGE-C010", "no evidence", [])).toThrow(EmptyEvidenceError);
  });

  it("gives every emitted diagnostic a code, a severity and evidence", () => {
    const all = [
      ...checkIntegrity(loadFixture("bloated")),
      ...checkIntegrity(loadFixture("untrusted-instruction")),
      ...checkIntegrity(loadFixture("semi-trusted-instruction")),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) {
      expect(d.code).toMatch(/^FORGE-C\d{3}$/);
      expect(["error", "warning", "info"]).toContain(d.severity);
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.message.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic: repeated runs give identical output", () => {
    const ir = loadFixture("bloated");
    expect(JSON.stringify(checkIntegrity(ir))).toBe(JSON.stringify(checkIntegrity(ir)));
  });
});

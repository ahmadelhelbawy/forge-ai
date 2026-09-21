/**
 * Requirement identity (V2-F, `FR-052`, `RQ-R1`–`RQ-R3`, `AC-044`).
 *
 * §22.8 already answers "did this requirement survive into this version?".
 * It does not answer "is this the same requirement as the one in version 3?",
 * and the Execution Package needs the second: a manifest whose entries change
 * id on every revision records nothing at all.
 *
 * Two properties carry the weight, and both are about what CANNOT happen:
 *
 *  - **The id does not move.** It is derived from the requirement's own token
 *    sequence, so it survives reformatting, re-pinning, and every version the
 *    conversation goes through. Deriving it from a Task IR node id would have
 *    been the obvious mistake — `g1` in v3 and `g1` in v7 are unrelated objects
 *    that happen to share a string (`RQ-R1`).
 *  - **`origin` cannot be promoted.** `user_stated` is reserved for text the
 *    user wrote. No path — model or deterministic — turns an `inferred`
 *    requirement into a stated one, because that is `INV-016`'s laundering
 *    failure wearing a different noun (`RQ-R3`).
 */
import { describe, expect, it } from "vitest";

import {
  REQUIREMENT_ORIGINS,
  identifyLedgerEntry,
  requirementId,
  requirementsFromIr,
  requirementManifest,
} from "../../src/requirement/identity.js";
import { contentHash } from "../../src/ir/canonical.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import type { LedgerEntry } from "../../src/critic/deterministic/ledger.js";

const PINNED = "The agent must never approve a change that removes a test.";

function entry(text: string, id = "storage-key-1"): LedgerEntry {
  return { id, text, contentHash: contentHash(text), origin: "user_input" };
}

function ir(): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: {
      statement: "Build a code review assistant",
      success_definition: "It reviews a diff and reports findings",
      kind: "feature",
      source_ref: "user_input",
    },
    goals: [
      {
        id: "g1",
        statement: "Report findings with a file path and a line number",
        priority: "must",
        acceptance: ["Every finding cites a path and a line"],
        source_ref: "user_input",
      },
    ],
    constraints: [
      {
        id: "c1",
        kind: "process",
        hardness: "hard",
        statement: "Never approve a change that removes a test",
        source_ref: "user_input",
      },
    ],
    non_goals: [
      { id: "n1", statement: "Rewriting the test framework", source_ref: "user_input" },
    ],
    scope: { include: ["src/**"], exclude: [], blast_radius: "module", source_ref: "user_input" },
    required_capabilities: [],
    context_refs: [],
    assumptions: [],
    open_questions: [],
    verification: [],
    deliverables: [
      { id: "d1", kind: "code_change", description: "The review assistant", source_ref: "user_input" },
    ],
    risk: { level: "low", factors: [] },
  });
}

describe("a requirement id is derived, stable and model-free (RQ-R1, RQ-R2)", () => {
  it("is deterministic for the same text", () => {
    expect(requirementId(PINNED)).toBe(requirementId(PINNED));
  });

  /**
   * The presence rule of §22.8 already decides that formatting is not meaning.
   * Identity uses the same tokenization, so the two cannot disagree about
   * whether two strings are the same requirement — which they would if identity
   * hashed raw bytes and presence compared tokens.
   */
  it("survives the reformatting the presence rule already forgives", () => {
    expect(requirementId("- Must use PostgreSQL.")).toBe(requirementId("must use postgresql"));
    expect(requirementId("  Never   log credentials  ")).toBe(requirementId("Never log credentials."));
  });

  it("differs for different requirements", () => {
    expect(requirementId("Must use PostgreSQL")).not.toBe(requirementId("Must use MySQL"));
  });

  it("does not depend on the storage key the ledger happens to hold", () => {
    // The ledger's `id` is a random UUID: a storage key, not an identity.
    // Deriving identity from it would make every conversation's requirements
    // unrelatable and every package non-deterministic.
    const a = identifyLedgerEntry(entry(PINNED, "uuid-aaaa"));
    const b = identifyLedgerEntry(entry(PINNED, "uuid-bbbb"));
    expect(a.id).toBe(b.id);
  });

  it("is a readable, bounded token", () => {
    expect(requirementId(PINNED)).toMatch(/^req-[0-9a-f]{12}$/);
  });

  it("refuses text with no tokens rather than inventing an id", () => {
    // "---" has no letters or digits, so it has no token sequence and cannot
    // be a requirement. Hashing it anyway would mint a stable id for nothing.
    expect(() => requirementId("---")).toThrow();
    expect(() => requirementId("   ")).toThrow();
  });
});

describe("origin is FORGE-assigned and cannot be promoted (RQ-R3, AC-044)", () => {
  it("marks a pinned ledger entry as user_stated", () => {
    // The user wrote it verbatim and pinned it themselves (WS-R24).
    expect(identifyLedgerEntry(entry(PINNED)).origin).toBe("user_stated");
  });

  it("marks every IR-derived requirement as inferred", () => {
    // A goal or constraint in the IR is the extraction boundary's restatement
    // of what the user said. Calling that "stated" is exactly the demotion
    // inversion FORGE-W008 exists to catch, run backwards.
    const found = requirementsFromIr(ir());
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) expect(r.origin).toBe("inferred");
  });

  it("admits exactly two origins", () => {
    expect([...REQUIREMENT_ORIGINS]).toEqual(["user_stated", "inferred"]);
  });

  /**
   * The non-negotiable one. There is no promotion function, and this test
   * exists so that adding one is a deliberate act that breaks a named test
   * rather than a plausible-looking convenience.
   */
  it("offers no operation that turns an inferred requirement into a stated one", async () => {
    const module = (await import("../../src/requirement/identity.js")) as Record<string, unknown>;
    const names = Object.keys(module).map((n) => n.toLowerCase());
    for (const name of names) {
      expect(name, `"${name}" looks like a promotion path`).not.toMatch(/promote|accept|restate|elevate/);
    }
  });

  it("freezes each requirement, so no caller can rewrite an origin in place", () => {
    const [first] = requirementsFromIr(ir());
    expect(first).toBeDefined();
    expect(Object.isFrozen(first)).toBe(true);
  });
});

describe("the manifest is a stable, ordered record", () => {
  it("carries both origins, user-stated first", () => {
    const manifest = requirementManifest(ir(), [entry(PINNED)]);
    expect(manifest[0]!.origin).toBe("user_stated");
    expect(manifest.some((r) => r.origin === "inferred")).toBe(true);
  });

  it("is byte-identical across runs (INV-005)", () => {
    const a = JSON.stringify(requirementManifest(ir(), [entry(PINNED)]));
    const b = JSON.stringify(requirementManifest(ir(), [entry(PINNED)]));
    expect(a).toBe(b);
  });

  it("names the IR node a requirement was read from, without becoming that node", () => {
    // RQ-R1: the link to a version's IR node is a derived resolution, recorded
    // so a reader can follow it — never the identity itself.
    const manifest = requirementManifest(ir(), []);
    const constraint = manifest.find((r) => r.node_id === "c1");
    expect(constraint).toBeDefined();
    expect(constraint!.id).not.toBe("c1");
    expect(constraint!.id).toBe(requirementId("Never approve a change that removes a test"));
  });

  it("records a pinned requirement with no node id, because it is not from the IR", () => {
    const manifest = requirementManifest(ir(), [entry(PINNED)]);
    expect(manifest[0]!.node_id).toBeNull();
  });

  it("deduplicates a requirement that is both pinned and in the IR, keeping user_stated", () => {
    // The user pinned the constraint verbatim; the extraction also produced it.
    // One requirement, and the stronger origin wins — reporting it twice would
    // make a manifest that double-counts what the user asked for.
    const manifest = requirementManifest(ir(), [entry("Never approve a change that removes a test")]);
    const matching = manifest.filter(
      (r) => r.id === requirementId("Never approve a change that removes a test"),
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]!.origin).toBe("user_stated");
  });

  /**
   * The schema makes a truly empty manifest unreachable — `goals` and
   * `deliverables` both have a minimum of one — so the property worth asserting
   * is the neighbouring one: absent collections contribute nothing, rather than
   * a placeholder.
   */
  it("invents no entry for a collection the IR leaves empty", () => {
    const bare = parseTaskIR({ ...ir(), constraints: [], non_goals: [] });
    const manifest = requirementManifest(bare, []);
    expect(manifest.map((r) => r.kind).sort()).toEqual(["deliverable", "goal"]);
    expect(manifest.every((r) => r.node_id !== null)).toBe(true);
  });
});

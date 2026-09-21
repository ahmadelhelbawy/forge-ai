/**
 * Requirement governance (V2-H, `FR-055`, `spec.md` §22.10 RG-R1–RG-R6,
 * `AC-051`–`AC-053`).
 *
 * Identity (§22.9) says which requirement; governance says what became of it.
 * The properties below are mostly about what CANNOT happen, because that is
 * where a lifecycle quietly goes wrong:
 *
 *  - a requirement never has two statuses, or none (RG-R1);
 *  - `open → accepted` happens only through a recorded human decision, and an
 *    illegal decision records nothing (RG-R3);
 *  - supersession never destroys the old requirement and never cycles (RG-R4);
 *  - a conflict is surfaced and stays surfaced until a human supersedes a side
 *    (RG-R5);
 *  - no decision can carry or change an `origin` (RG-R6).
 */
import { describe, expect, it } from "vitest";

import { contentHash } from "../../src/ir/canonical.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import type { LedgerEntry } from "../../src/critic/deterministic/ledger.js";
import { REQUIREMENT_ORIGINS, requirementId } from "../../src/requirement/identity.js";
import * as governance from "../../src/requirement/governance.js";
import {
  GovernanceDecisionSchema,
  GovernanceRefusal,
  REQUIREMENT_STATUSES,
  governRequirements,
  parseGovernanceFile,
  recordDecision,
  type GovernanceDecision,
  type GovernanceRecord,
} from "../../src/requirement/governance.js";

const GOAL_A = "Passwords are hashed with bcrypt before storage";
const GOAL_B = "Sessions expire after thirty minutes of inactivity";
const CONSTRAINT = "Rewrite the session store using Redis clusters";
const NON_GOAL = "rewrite the session store";
const PINNED = "The login endpoint returns 429 after five failed attempts";

function ledger(...texts: string[]): LedgerEntry[] {
  return texts.map((text, i) => ({ id: `key-${i}`, text, contentHash: contentHash(text), origin: "user_input" }));
}

function ir(options: { nonGoals?: string[]; constraints?: string[] } = {}): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: {
      statement: "Harden the authentication service",
      kind: "feature",
      success_definition: "Passwords and sessions follow the stated policy",
      source_ref: "user_input",
    },
    goals: [
      { id: "g1", statement: GOAL_A, acceptance: ["bcrypt hashes are stored"], priority: "must", source_ref: "user_input" },
      { id: "g2", statement: GOAL_B, acceptance: ["idle sessions expire"], priority: "must", source_ref: "user_input" },
    ],
    constraints: (options.constraints ?? []).map((statement, i) => ({
      id: `c${i + 1}`,
      statement,
      kind: "architectural",
      hardness: "hard",
      source_ref: "user_input",
    })),
    non_goals: (options.nonGoals ?? []).map((statement, i) => ({
      id: `n${i + 1}`,
      statement,
      source_ref: "user_input",
    })),
    scope: { include: ["src/auth/**"], exclude: [], blast_radius: "module", source_ref: "user_input" },
    context_refs: [],
    deliverables: [{ id: "d1", description: "A patch to the auth module", kind: "code_change", source_ref: "user_input" }],
    verification: [
      { id: "v1", kind: "test", spec: "run the auth tests", expected: "exit 0", satisfies: ["g1", "g2"], source_ref: "user_input" },
    ],
    assumptions: [],
    open_questions: [],
    risk: { level: "medium", factors: [] },
    required_capabilities: [],
  });
}

const A = requirementId(GOAL_A);
const B = requirementId(GOAL_B);
const P = requirementId(PINNED);

/** Apply decisions the way the product does: each one checked, then appended. */
function decide(
  base: { ledger: readonly LedgerEntry[]; ir: TaskIR | null },
  decisions: readonly GovernanceDecision[],
): GovernanceRecord[] {
  const log: GovernanceRecord[] = [];
  for (const decision of decisions) log.push(recordDecision({ ...base, log }, decision));
  return log;
}

function statusOf(base: { ledger: readonly LedgerEntry[]; ir: TaskIR | null }, log: readonly GovernanceRecord[], id: string) {
  const row = governRequirements({ ...base, log }).requirements.find((r) => r.id === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
}

describe("RG-R1/RG-R2 — one origin, one status, derived", () => {
  it("starts an inferred requirement open and a pinned one accepted", () => {
    const base = { ledger: ledger(PINNED), ir: ir() };
    const registry = governRequirements({ ...base, log: [] });
    expect(statusOf(base, [], A)).toMatchObject({ origin: "inferred", status: "open", pinned: false, superseded_by: null });
    expect(statusOf(base, [], P)).toMatchObject({ origin: "user_stated", status: "accepted", pinned: true, superseded_by: null });
    expect(registry.requirements.every((r) => r.active)).toBe(true);
  });

  it("keeps pinned separate from status: an unpinned inferred requirement is open, never 'pinned'", () => {
    for (const status of REQUIREMENT_STATUSES) expect(status).not.toBe("pinned");
    const row = statusOf({ ledger: [], ir: ir() }, [], A);
    expect(row.pinned).toBe(false);
    expect(row.status).toBe("open");
  });

  it("gives every requirement exactly one origin and one status under every short decision sequence", () => {
    const base = { ledger: ledger(PINNED), ir: ir() };
    const ids = [A, B, P];
    const alphabet: GovernanceDecision[] = [];
    for (const x of ids) {
      alphabet.push({ kind: "accept", requirement_id: x });
      for (const y of ids) {
        alphabet.push({ kind: "supersede", requirement_id: x, successor_id: y });
        if (x < y) alphabet.push({ kind: "conflict", requirement_ids: [x, y] });
      }
    }
    let sequences = 0;
    const walk = (log: GovernanceRecord[], depth: number): void => {
      sequences += 1;
      const registry = governRequirements({ ...base, log });
      for (const r of registry.requirements) {
        expect(REQUIREMENT_ORIGINS).toContain(r.origin);
        expect(REQUIREMENT_STATUSES).toContain(r.status);
        expect(r.superseded_by !== null).toBe(r.status === "superseded");
        // Origin is the manifest's, whatever was decided (RG-R6).
        expect(r.origin).toBe(r.id === P ? "user_stated" : "inferred");
      }
      expect(new Set(registry.requirements.map((r) => r.id)).size).toBe(registry.requirements.length);
      // The successor chain never cycles.
      for (const r of registry.requirements) {
        const seen = new Set<string>([r.id]);
        let next = r.superseded_by;
        while (next !== null) {
          expect(seen.has(next), `cycle through ${next}`).toBe(false);
          seen.add(next);
          next = registry.requirements.find((x) => x.id === next)?.superseded_by ?? null;
        }
      }
      if (depth === 3) return;
      for (const decision of alphabet) {
        let record: GovernanceRecord;
        try {
          record = recordDecision({ ...base, log }, decision);
        } catch (error) {
          expect(error).toBeInstanceOf(GovernanceRefusal);
          continue;
        }
        walk([...log, record], depth + 1);
      }
    };
    walk([], 0);
    expect(sequences).toBeGreaterThan(100);
  });
});

describe("RG-R3 — open → accepted only by an explicit decision", () => {
  const base = { ledger: [] as LedgerEntry[], ir: ir() };

  it("accepts an open requirement and records a FORGE-made snapshot", () => {
    const log = decide(base, [{ kind: "accept", requirement_id: A }]);
    expect(statusOf(base, log, A).status).toBe("accepted");
    expect(log[0]!.subjects).toEqual([{ id: A, text: GOAL_A, origin: "inferred" }]);
    // Nothing else moved.
    expect(statusOf(base, log, B).status).toBe("open");
  });

  it("refuses every illegal accept, and a refusal records nothing", () => {
    const accepted = decide(base, [{ kind: "accept", requirement_id: A }]);
    expect(() => recordDecision({ ...base, log: accepted }, { kind: "accept", requirement_id: A })).toThrow(/already accepted/);

    const superseded = decide(base, [{ kind: "supersede", requirement_id: A, successor_id: B }]);
    expect(() => recordDecision({ ...base, log: superseded }, { kind: "accept", requirement_id: A })).toThrow(GovernanceRefusal);

    const conflicted = decide(base, [{ kind: "conflict", requirement_ids: [A, B] }]);
    expect(() => recordDecision({ ...base, log: conflicted }, { kind: "accept", requirement_id: A })).toThrow(/conflict/);

    expect(() => recordDecision({ ...base, log: [] }, { kind: "accept", requirement_id: "req-000000000000" })).toThrow(
      /unknown requirement/,
    );
    // recordDecision is pure: the log it was given is untouched.
    expect(accepted).toHaveLength(1);
  });

  it("offers no operation that accepts, supersedes or promotes without a decision", () => {
    const names = Object.keys(governance);
    for (const name of names) expect(name).not.toMatch(/promot|autoAccept|setOrigin|markStated|resolveConflict/i);
  });
});

describe("RG-R4 — supersession is traceable, never destructive", () => {
  it("keeps the old requirement readable with its successor named, even after it left every version", () => {
    const withOld = { ledger: [] as LedgerEntry[], ir: ir() };
    const log = decide(withOld, [{ kind: "supersede", requirement_id: A, successor_id: B }]);
    const old = statusOf(withOld, log, A);
    expect(old).toMatchObject({ status: "superseded", superseded_by: B, text: GOAL_A, origin: "inferred", active: false });

    // A later version no longer contains A at all: the row survives from the snapshot.
    const later = parseTaskIR({ ...ir(), goals: [ir().goals[1]!] });
    const registry = governRequirements({ ledger: [], ir: later, log });
    const row = registry.requirements.find((r) => r.id === A);
    expect(row).toMatchObject({ text: GOAL_A, status: "superseded", superseded_by: B, active: false, sources: [] });
  });

  it("refuses self-supersession, re-pointing, a superseded successor, and cycles", () => {
    const base = { ledger: ledger(PINNED), ir: ir() };
    expect(() => recordDecision({ ...base, log: [] }, { kind: "supersede", requirement_id: A, successor_id: A })).toThrow(
      /itself/,
    );
    const once = decide(base, [{ kind: "supersede", requirement_id: A, successor_id: B }]);
    expect(() => recordDecision({ ...base, log: once }, { kind: "supersede", requirement_id: A, successor_id: P })).toThrow(
      /already superseded/,
    );
    expect(() => recordDecision({ ...base, log: once }, { kind: "supersede", requirement_id: P, successor_id: A })).toThrow(
      /successor .* superseded/,
    );
    // B → A would close the loop A → B → A.
    expect(() => recordDecision({ ...base, log: once }, { kind: "supersede", requirement_id: B, successor_id: A })).toThrow(
      GovernanceRefusal,
    );
  });

  it("rejects a supplied log whose supersessions cycle, rather than folding it", () => {
    const subject = (id: string, text: string) => ({ id, text, origin: "inferred" as const });
    const cyclic: GovernanceRecord[] = [
      { decision: { kind: "supersede", requirement_id: A, successor_id: B }, subjects: [subject(A, GOAL_A), subject(B, GOAL_B)] },
      { decision: { kind: "supersede", requirement_id: B, successor_id: A }, subjects: [subject(B, GOAL_B), subject(A, GOAL_A)] },
    ];
    expect(() => governRequirements({ ledger: [], ir: ir(), log: cyclic })).toThrow(/cycle/);
  });

  it("reports a superseded requirement that is still pinned, and leaves it pinned (FORGE-R002)", () => {
    const base = { ledger: ledger(PINNED), ir: ir() };
    const log = decide(base, [{ kind: "supersede", requirement_id: P, successor_id: A }]);
    const registry = governRequirements({ ...base, log });
    const row = registry.requirements.find((r) => r.id === P)!;
    expect(row).toMatchObject({ status: "superseded", pinned: true });
    const r002 = registry.diagnostics.filter((d) => d.code === "FORGE-R002");
    expect(r002).toHaveLength(1);
    expect(r002[0]!.message).toContain(P);
    expect(r002[0]!.message).toContain(A);
  });
});

describe("RG-R5 — conflicts are surfaced, never resolved", () => {
  const conflicting = { ledger: [] as LedgerEntry[], ir: ir({ constraints: [CONSTRAINT], nonGoals: [NON_GOAL] }) };
  const C = requirementId(CONSTRAINT);
  const N = requirementId(NON_GOAL);

  it("detects a non-goal whose token sequence the IR also requires, and marks both sides", () => {
    const registry = governRequirements({ ...conflicting, log: [] });
    expect(registry.requirements.find((r) => r.id === C)).toMatchObject({ status: "conflicted", conflicts_with: [N] });
    expect(registry.requirements.find((r) => r.id === N)).toMatchObject({ status: "conflicted", conflicts_with: [C] });
    const r001 = registry.diagnostics.filter((d) => d.code === "FORGE-R001");
    expect(r001).toHaveLength(1);
    expect(r001[0]!.severity).toBe("warning");
  });

  it("does not flag a short non-goal (fewer than three tokens)", () => {
    const registry = governRequirements({ ledger: [], ir: ir({ constraints: [CONSTRAINT], nonGoals: ["session store"] }), log: [] });
    expect(registry.diagnostics.filter((d) => d.code === "FORGE-R001")).toEqual([]);
  });

  it("stays conflicted on every fold until a human supersedes a side", () => {
    const again = governRequirements({ ...conflicting, log: [] });
    expect(again.requirements.find((r) => r.id === C)!.status).toBe("conflicted");
    const log = decide(conflicting, [{ kind: "supersede", requirement_id: N, successor_id: C }]);
    const after = governRequirements({ ...conflicting, log });
    expect(after.requirements.find((r) => r.id === C)!.status).toBe("open");
    expect(after.requirements.find((r) => r.id === N)!.status).toBe("superseded");
    expect(after.diagnostics.filter((d) => d.code === "FORGE-R001")).toEqual([]);
  });

  it("records a declared conflict, and refuses one against a superseded requirement", () => {
    const base = { ledger: [] as LedgerEntry[], ir: ir() };
    const log = decide(base, [{ kind: "conflict", requirement_ids: [A, B] }]);
    const registry = governRequirements({ ...base, log });
    expect(registry.requirements.find((r) => r.id === A)!.status).toBe("conflicted");
    expect(registry.diagnostics.filter((d) => d.code === "FORGE-R001")).toHaveLength(1);

    const superseded = decide(base, [{ kind: "supersede", requirement_id: A, successor_id: B }]);
    expect(() => recordDecision({ ...base, log: superseded }, { kind: "conflict", requirement_ids: [A, B] })).toThrow(
      GovernanceRefusal,
    );
    expect(() => recordDecision({ ...base, log: [] }, { kind: "conflict", requirement_ids: [A, A] })).toThrow(/itself/);
  });
});

describe("RG-R6 — no decision can carry or change an origin", () => {
  it("rejects a decision that names an origin, or anything else it does not define", () => {
    expect(() => GovernanceDecisionSchema.parse({ kind: "accept", requirement_id: A, origin: "user_stated" })).toThrow();
    expect(() => GovernanceDecisionSchema.parse({ kind: "promote", requirement_id: A })).toThrow();
    expect(() =>
      parseGovernanceFile(JSON.stringify({ decisions: [{ kind: "accept", requirement_id: A, origin: "user_stated" }] })),
    ).toThrow();
  });

  it("keeps an accepted inferred requirement inferred", () => {
    const base = { ledger: [] as LedgerEntry[], ir: ir() };
    const log = decide(base, [{ kind: "accept", requirement_id: A }]);
    expect(statusOf(base, log, A).origin).toBe("inferred");
  });

  it("shows a verbatim pin as a second source, never as a rewritten record", () => {
    const base = { ledger: ledger(GOAL_A), ir: ir() };
    const row = statusOf(base, [], A);
    expect(row.origin).toBe("user_stated");
    expect(row.sources).toEqual([{ kind: "ledger" }, { kind: "ir_node", node_id: "g1", node_kind: "goal" }]);
  });

  it("copies the snapshot origin from FORGE's record, not from the caller", () => {
    const base = { ledger: ledger(PINNED), ir: ir() };
    const [record] = decide(base, [{ kind: "supersede", requirement_id: A, successor_id: P }]);
    expect(record!.subjects).toEqual([
      { id: A, text: GOAL_A, origin: "inferred" },
      { id: P, text: PINNED, origin: "user_stated" },
    ]);
  });
});

describe("determinism", () => {
  it("folds identical inputs to byte-identical output", () => {
    const base = { ledger: ledger(PINNED), ir: ir({ constraints: [CONSTRAINT], nonGoals: [NON_GOAL] }) };
    const log = decide(base, [
      { kind: "accept", requirement_id: A },
      { kind: "supersede", requirement_id: B, successor_id: A },
    ]);
    const one = JSON.stringify(governRequirements({ ...base, log }));
    const two = JSON.stringify(governRequirements({ ...base, log: JSON.parse(JSON.stringify(log)) }));
    expect(one).toBe(two);
  });

  it("parses a governance file of ids only, and refuses a malformed one as a whole", () => {
    expect(parseGovernanceFile(JSON.stringify({ decisions: [{ kind: "accept", requirement_id: A }] }))).toEqual([
      { kind: "accept", requirement_id: A },
    ]);
    expect(() => parseGovernanceFile("{not json")).toThrow();
    expect(() => parseGovernanceFile(JSON.stringify({ decisions: [{ kind: "accept" }] }))).toThrow();
  });
});

/**
 * Requirement governance (V2-H, `FR-055`, `spec.md` §22.10 RG-R1–RG-R6).
 *
 * Identity (`identity.ts`) says *which* requirement. This module says *what
 * became of it*: whether a human accepted it, replaced it, or found it in
 * conflict with another.
 *
 * **Status is derived, never stored.** A conversation keeps an append-only log
 * of human decisions; the status of every requirement is a pure fold of that
 * log over the current requirement manifest (RG-R2). Storing a status field
 * instead would give the product two sources of truth — the field and the
 * decisions that were supposed to justify it — and the first bug would make
 * them disagree.
 *
 * **Status lives beside the package, not in it.** Accepting a requirement
 * changes no byte of `requirements.json`, so no `semantic_id` moves and evidence
 * already bound to a package stays bound (`EV-R2`).
 *
 * **There is no promotion and no automatic decision.** Nothing here accepts,
 * supersedes or resolves anything on its own; every change of status traces to
 * one recorded human decision. A decision names ids only — the `{id, text,
 * origin}` snapshot is built here from FORGE's own record, so no caller can
 * smuggle an origin into the log (RG-R6, `RQ-R3`).
 *
 * No model, no clock, no filesystem. A module reachable from a model boundary
 * may not import this one (`AC-053`).
 */
import { z } from "zod";

import { containsSequence, tokenize, type LedgerEntry } from "../critic/deterministic/ledger.js";
import { diagnostic, nodeEvidence, type Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import {
  identifyLedgerEntry,
  requirementManifest,
  requirementsFromIr,
  type Requirement,
  type RequirementOrigin,
} from "./identity.js";

/** RG-R1. `pinned` is deliberately absent: it is preservation policy, not a lifecycle state. */
export const REQUIREMENT_STATUSES = ["open", "accepted", "superseded", "conflicted"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

const RequirementIdSchema = z.string().regex(/^req-[0-9a-f]{12}$/, 'must look like "req-" + 12 hex');

/**
 * The three decisions a human can record (RG-R3). Strict: a decision that names
 * an `origin`, a status, or any field not defined here is refused whole.
 */
export const GovernanceDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("accept"), requirement_id: RequirementIdSchema }),
  z.strictObject({
    kind: z.literal("supersede"),
    requirement_id: RequirementIdSchema,
    successor_id: RequirementIdSchema,
  }),
  z.strictObject({
    kind: z.literal("conflict"),
    requirement_ids: z.tuple([RequirementIdSchema, RequirementIdSchema]),
  }),
]);
export type GovernanceDecision = z.infer<typeof GovernanceDecisionSchema>;

/** What FORGE knew about a requirement when a decision named it. */
export interface GovernanceSubject {
  readonly id: string;
  readonly text: string;
  readonly origin: RequirementOrigin;
}

/** One entry of the append-only log: the decision, and FORGE's snapshot of what it named. */
export interface GovernanceRecord {
  readonly decision: GovernanceDecision;
  readonly subjects: readonly GovernanceSubject[];
}

/** Where a row's text is found in the current version. Recomputed, never stored (RQ-R1). */
export type RequirementSource =
  | { readonly kind: "ledger" }
  | { readonly kind: "ir_node"; readonly node_id: string; readonly node_kind: Exclude<Requirement["kind"], "pinned"> };

export interface GovernedRequirement {
  readonly id: string;
  readonly text: string;
  /** Exactly one, FORGE-assigned (RQ-R3). */
  readonly origin: RequirementOrigin;
  /** Exactly one, derived by RG-R2. */
  readonly status: RequirementStatus;
  /** Preservation policy (§22.8). Orthogonal to status. */
  readonly pinned: boolean;
  /** Non-null exactly when `status` is `superseded` (RG-R1). */
  readonly superseded_by: string | null;
  /** Present in the current version and not superseded. A derived column, not a state. */
  readonly active: boolean;
  /** The other side of every live conflict, sorted. A self-conflict names itself. */
  readonly conflicts_with: readonly string[];
  /** Ledger first, then IR nodes in declaration order. Empty once it left every version. */
  readonly sources: readonly RequirementSource[];
}

export interface RequirementRegistry {
  readonly requirements: readonly GovernedRequirement[];
  /** `FORGE-R001` per live conflict, `FORGE-R002` per superseded-but-asserted requirement. */
  readonly diagnostics: readonly Diagnostic[];
}

export type GovernanceRefusalReason =
  | "unknown_requirement"
  | "self_reference"
  | "already_accepted"
  | "not_open"
  | "in_conflict"
  | "already_superseded"
  | "successor_superseded"
  | "supersession_cycle"
  | "missing_subject";

/** A decision the RG-R3 table does not allow. Nothing is recorded when this is thrown. */
export class GovernanceRefusal extends Error {
  constructor(
    readonly reason: GovernanceRefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "GovernanceRefusal";
  }
}

export interface GovernanceInput {
  /** The conversation's pinned ledger (the `user_stated` source). */
  readonly ledger: readonly LedgerEntry[];
  /** The current version's Task IR, or null when none has been extracted. */
  readonly ir: TaskIR | null;
  readonly log: readonly GovernanceRecord[];
}

/** Non-goals shorter than this match too much to call a conflict (RG-R5). */
const CONFLICT_MIN_TOKENS = 3;

/** The current requirements: the V2-F manifest, or the pinned half when there is no IR. */
function currentManifest(ledger: readonly LedgerEntry[], ir: TaskIR | null): readonly Requirement[] {
  if (ir !== null) return requirementManifest(ir, ledger);
  const byId = new Map<string, Requirement>();
  for (const entry of ledger) {
    const requirement = identifyLedgerEntry(entry);
    if (!byId.has(requirement.id)) byId.set(requirement.id, requirement);
  }
  return [...byId.values()];
}

/**
 * Deterministic conflicts (RG-R5): a non-goal whose token sequence the IR or the
 * ledger also *requires*. Uses §22.8's published tokenizer and contiguity rule,
 * so "conflict" and "present" cannot disagree about what a statement says.
 */
function detectConflicts(ledger: readonly LedgerEntry[], ir: TaskIR | null): Array<readonly [string, string]> {
  if (ir === null) return [];
  const all = requirementsFromIr(ir);
  const nonGoals = all.filter((r) => r.kind === "non_goal");
  const positives = [...ledger.map(identifyLedgerEntry), ...all.filter((r) => r.kind !== "non_goal")];
  const pairs: Array<readonly [string, string]> = [];
  for (const n of nonGoals) {
    const needle = tokenize(n.text);
    if (needle.length < CONFLICT_MIN_TOKENS) continue;
    for (const p of positives) {
      if (containsSequence(tokenize(p.text), needle)) pairs.push([n.id, p.id]);
    }
  }
  return pairs;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Known {
  readonly text: string;
  readonly origin: RequirementOrigin;
}

/**
 * Validate a log's own invariants — the ones that must hold of any history,
 * whatever the current manifest says: every named id has a snapshot, nothing
 * supersedes itself, nothing is superseded twice, and the successor chain never
 * cycles. A log that fails is refused as a whole rather than half-folded.
 */
function replay(log: readonly GovernanceRecord[]): {
  readonly supersededBy: ReadonlyMap<string, string>;
  readonly accepted: ReadonlySet<string>;
  readonly declared: ReadonlyArray<readonly [string, string]>;
  readonly snapshots: ReadonlyMap<string, Known>;
} {
  const supersededBy = new Map<string, string>();
  const accepted = new Set<string>();
  const declared: Array<readonly [string, string]> = [];
  const snapshots = new Map<string, Known>();
  for (const [index, record] of log.entries()) {
    const decision = GovernanceDecisionSchema.parse(record.decision);
    const named =
      decision.kind === "accept"
        ? [decision.requirement_id]
        : decision.kind === "supersede"
          ? [decision.requirement_id, decision.successor_id]
          : [...decision.requirement_ids];
    for (const id of named) {
      const subject = record.subjects.find((s) => s.id === id);
      if (!subject) {
        throw new GovernanceRefusal("missing_subject", `Governance record ${index} names ${id} without a snapshot of it.`);
      }
      if (!snapshots.has(id)) snapshots.set(id, { text: subject.text, origin: subject.origin });
    }
    if (decision.kind === "accept") {
      accepted.add(decision.requirement_id);
    } else if (decision.kind === "supersede") {
      const { requirement_id: from, successor_id: to } = decision;
      if (from === to) throw new GovernanceRefusal("self_reference", `Record ${index}: ${from} cannot supersede itself.`);
      if (supersededBy.has(from)) {
        throw new GovernanceRefusal("already_superseded", `Record ${index}: ${from} is already superseded.`);
      }
      supersededBy.set(from, to);
      assertAcyclic(supersededBy, from);
    } else {
      const [a, b] = decision.requirement_ids;
      if (a === b) throw new GovernanceRefusal("self_reference", `Record ${index}: ${a} cannot conflict with itself.`);
      declared.push([a, b]);
    }
  }
  return { supersededBy, accepted, declared, snapshots };
}

function assertAcyclic(supersededBy: ReadonlyMap<string, string>, start: string): void {
  const seen = new Set<string>([start]);
  let next = supersededBy.get(start);
  while (next !== undefined) {
    if (seen.has(next)) {
      throw new GovernanceRefusal("supersession_cycle", `Superseding ${start} would make the successor chain cycle through ${next}.`);
    }
    seen.add(next);
    next = supersededBy.get(next);
  }
}

/**
 * The fold (RG-R2): every requirement the conversation knows, with its derived
 * status. Rows follow the manifest order (pinned first, then IR declaration
 * order), then requirements known only from the log, in the order the log
 * first named them. Pure, so identical inputs give byte-identical output.
 */
export function governRequirements(input: GovernanceInput): RequirementRegistry {
  const { supersededBy, accepted, declared, snapshots } = replay(input.log);
  const manifest = currentManifest(input.ledger, input.ir);
  const pinned = new Set(input.ledger.map((e) => identifyLedgerEntry(e).id));
  const irRequirements = input.ir === null ? [] : requirementsFromIr(input.ir);

  const known = new Map<string, Known>();
  for (const r of manifest) known.set(r.id, { text: r.text, origin: r.origin });
  for (const [id, snapshot] of snapshots) if (!known.has(id)) known.set(id, snapshot);

  // Live conflicts: detected now, or declared — both sides still not superseded.
  const conflicts = new Map<string, Set<string>>();
  const conflictPairs = new Map<string, readonly [string, string]>();
  const addConflict = (a: string, b: string): void => {
    if (supersededBy.has(a) || supersededBy.has(b)) return;
    if (!known.has(a) || !known.has(b)) return;
    (conflicts.get(a) ?? conflicts.set(a, new Set()).get(a)!).add(b);
    (conflicts.get(b) ?? conflicts.set(b, new Set()).get(b)!).add(a);
    const key = pairKey(a, b);
    if (!conflictPairs.has(key)) conflictPairs.set(key, a < b ? [a, b] : [b, a]);
  };
  for (const [a, b] of detectConflicts(input.ledger, input.ir)) addConflict(a, b);
  for (const [a, b] of declared) addConflict(a, b);

  const inCurrent = new Set(manifest.map((r) => r.id));
  const requirements: GovernedRequirement[] = [];
  for (const [id, { text, origin }] of known) {
    const successor = supersededBy.get(id) ?? null;
    const status: RequirementStatus =
      successor !== null
        ? "superseded"
        : conflicts.has(id)
          ? "conflicted"
          : accepted.has(id) || pinned.has(id)
            ? "accepted"
            : "open";
    const sources: RequirementSource[] = [];
    if (pinned.has(id)) sources.push({ kind: "ledger" });
    for (const r of irRequirements) {
      if (r.id === id && r.node_id !== null && r.kind !== "pinned") {
        sources.push({ kind: "ir_node", node_id: r.node_id, node_kind: r.kind });
      }
    }
    requirements.push(
      Object.freeze({
        id,
        text,
        origin,
        status,
        pinned: pinned.has(id),
        superseded_by: successor,
        active: inCurrent.has(id) && successor === null,
        conflicts_with: [...(conflicts.get(id) ?? [])].sort(),
        sources,
      }),
    );
  }

  const diagnostics: Diagnostic[] = [];
  for (const [a, b] of [...conflictPairs.values()].sort((x, y) => pairKey(...x).localeCompare(pairKey(...y)))) {
    diagnostics.push(
      diagnostic(
        "FORGE-R001",
        a === b
          ? `Requirement ${a} is both required and excluded: "${known.get(a)!.text}". FORGE resolves nothing; supersede it to decide (RG-R5).`
          : `Requirements ${a} ("${known.get(a)!.text}") and ${b} ("${known.get(b)!.text}") conflict. ` +
              `Both stay conflicted until a human supersedes one of them; FORGE picks no side (RG-R5).`,
        a === b ? [nodeEvidence(a)] : [nodeEvidence(a), nodeEvidence(b)],
      ),
    );
  }
  for (const row of requirements) {
    if (row.status !== "superseded" || !(row.pinned || row.sources.some((s) => s.kind === "ir_node"))) continue;
    diagnostics.push(
      diagnostic(
        "FORGE-R002",
        `Requirement ${row.id} was superseded by ${row.superseded_by} but is still ` +
          `${row.pinned ? "pinned" : "present in the current version"}: "${row.text}". ` +
          `Reported, not changed — unpinning or revising is the user's decision (RG-R4).`,
        [nodeEvidence(row.id), nodeEvidence(row.superseded_by!)],
      ),
    );
  }
  return Object.freeze({ requirements: Object.freeze(requirements), diagnostics: Object.freeze(diagnostics) });
}

/**
 * Check one human decision against the RG-R3 table and return the record to
 * append. Pure: the caller appends; a refusal throws and nothing is recorded.
 * The snapshot is built from FORGE's registry, never from the caller.
 */
export function recordDecision(input: GovernanceInput, candidate: GovernanceDecision): GovernanceRecord {
  const decision = GovernanceDecisionSchema.parse(candidate);
  const registry = governRequirements(input);
  const rows = new Map(registry.requirements.map((r) => [r.id, r]));
  const row = (id: string): GovernedRequirement => {
    const found = rows.get(id);
    if (!found) throw new GovernanceRefusal("unknown_requirement", `${id} is an unknown requirement in this conversation.`);
    return found;
  };
  const snapshot = (id: string): GovernanceSubject => {
    const r = row(id);
    return { id: r.id, text: r.text, origin: r.origin };
  };

  if (decision.kind === "accept") {
    const r = row(decision.requirement_id);
    if (r.status === "accepted") throw new GovernanceRefusal("already_accepted", `${r.id} is already accepted.`);
    if (r.status === "conflicted") {
      throw new GovernanceRefusal(
        "in_conflict",
        `${r.id} is in conflict with ${r.conflicts_with.join(", ")}. A conflict is resolved by superseding one side, not by accepting through it.`,
      );
    }
    if (r.status !== "open") throw new GovernanceRefusal("not_open", `${r.id} is ${r.status}; only an open requirement can be accepted.`);
    return Object.freeze({ decision, subjects: [snapshot(r.id)] });
  }

  if (decision.kind === "supersede") {
    const from = row(decision.requirement_id);
    const to = row(decision.successor_id);
    if (from.id === to.id) throw new GovernanceRefusal("self_reference", `${from.id} cannot supersede itself.`);
    if (from.superseded_by !== null) {
      throw new GovernanceRefusal(
        "already_superseded",
        `${from.id} is already superseded by ${from.superseded_by}; history is not rewritten (RG-R4).`,
      );
    }
    if (to.superseded_by !== null) {
      throw new GovernanceRefusal(
        "successor_superseded",
        `The successor ${to.id} is itself superseded by ${to.superseded_by}; name the requirement that replaced it.`,
      );
    }
    const record: GovernanceRecord = Object.freeze({ decision, subjects: [snapshot(from.id), snapshot(to.id)] });
    // Defence in depth: the successor rule above already prevents a cycle, but
    // the invariant is checked on the log itself, not assumed from the rule.
    replay([...input.log, record]);
    return record;
  }

  const [a, b] = decision.requirement_ids;
  if (a === b) throw new GovernanceRefusal("self_reference", `${a} cannot conflict with itself.`);
  for (const id of [a, b]) {
    const r = row(id);
    if (r.status === "superseded") {
      throw new GovernanceRefusal("already_superseded", `${r.id} is superseded by ${r.superseded_by}; it cannot conflict with anything.`);
    }
  }
  return Object.freeze({ decision, subjects: [snapshot(a), snapshot(b)] });
}

/** A governance file for the CLI: `{ "decisions": [ ... ] }`, ids only. Malformed → refused whole. */
export const GovernanceFileSchema = z.strictObject({ decisions: z.array(GovernanceDecisionSchema) });

export function parseGovernanceFile(text: string): GovernanceDecision[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`The governance file is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return GovernanceFileSchema.parse(raw).decisions;
}

/**
 * Apply a file's decisions in order, each one checked against the state the
 * previous ones left — the same path a user's clicks take in the workspace.
 */
export function recordDecisions(
  base: Omit<GovernanceInput, "log">,
  decisions: readonly GovernanceDecision[],
): GovernanceRecord[] {
  const log: GovernanceRecord[] = [];
  for (const decision of decisions) log.push(recordDecision({ ...base, log }, decision));
  return log;
}

/**
 * Requirement identity (`FR-052`, `spec.md` §22.9, `RQ-R1`–`RQ-R3`).
 *
 * §22.8 answers *did this requirement survive into this version?*. This module
 * answers the other question the Execution Package needs: *is this the same
 * requirement as the one in version 3?* A manifest whose entries change id on
 * every revision records nothing at all.
 *
 * **Why the id is derived and not stored.** The obvious implementation — reuse
 * the Task IR node id — is wrong, and quietly so. The IR is re-extracted per
 * version, so `g1` in v3 and `g1` in v7 are unrelated objects that happen to
 * share a string; a manifest built on them would claim continuity it does not
 * have (`RQ-R1`). The ledger's own `id` is no better: it is a random UUID, a
 * storage key chosen at pin time, so two conversations holding the same
 * requirement would be unrelatable and the record would be non-deterministic
 * (`RQ-R2`, `INV-005`).
 *
 * So identity is derived from the requirement's own **token sequence**, using
 * the published normalization of §22.8. Reusing that tokenizer rather than
 * writing a second one is deliberate: presence and identity must not be able to
 * disagree about whether two strings are the same requirement, which they would
 * the moment one compared bytes and the other compared tokens.
 *
 * **`origin` is a fact FORGE owns, never a field a model fills** (`RQ-R3`).
 * `user_stated` is reserved for text the user wrote — in practice, a pinned
 * ledger entry, which `WS-R24` already stores verbatim and forbids a model to
 * rewrite. Everything read out of the Task IR is `inferred`, because a goal or
 * constraint is the extraction boundary's *restatement* of what the user said.
 * Calling that "stated" would be `FORGE-W008`'s inversion run backwards, and it
 * is the same laundering `INV-016` forbids for `source_ref`.
 *
 * **There is no promotion.** Nothing here turns an `inferred` requirement into
 * a `user_stated` one, and a test asserts no exported name looks like it might.
 * Status, supersession and conflict are V2-H; recording identity without a
 * workflow is the deliberate scope of this phase.
 */
import { rawHash } from "../ir/canonical.js";
import { tokenize, type LedgerEntry } from "../critic/deterministic/ledger.js";
import type { TaskIR } from "../ir/schema.js";

/**
 * The two origins, in precedence order: where a requirement appears under both,
 * `user_stated` wins, because the user's own words outrank a restatement of them.
 */
export const REQUIREMENT_ORIGINS = ["user_stated", "inferred"] as const;
export type RequirementOrigin = (typeof REQUIREMENT_ORIGINS)[number];

export interface Requirement {
  /** Derived from the text, stable for the life of the conversation (RQ-R1). */
  readonly id: string;
  /** The requirement as it was written. Never rewritten here. */
  readonly text: string;
  /** FORGE-assigned and immutable (RQ-R3). */
  readonly origin: RequirementOrigin;
  /**
   * The node this was read from **in one version's IR**, or null for a pinned
   * entry, which does not come from the IR at all.
   *
   * A derived resolution recorded so a reader can follow it — deliberately not
   * the identity, because the node id is only stable within its own version.
   */
  readonly node_id: string | null;
  /** Which part of the IR carried it, for a reader deciding how to weigh it. */
  readonly kind: "pinned" | "goal" | "constraint" | "non_goal" | "deliverable";
}

export class EmptyRequirementError extends Error {
  constructor(text: string) {
    super(
      `A requirement must contain at least one letter or digit; received ${JSON.stringify(text)}. ` +
        `Text with no token sequence has no identity under spec.md §22.8, and minting one ` +
        `would give a stable id to nothing.`,
    );
    this.name = "EmptyRequirementError";
  }
}

/** How much of the hash the id carries. 48 bits: short enough to read, wide
 *  enough that a collision within one conversation is not a real risk. */
const ID_HEX_LENGTH = 12;

/**
 * The published derivation: `req-` + the first 12 hex of the SHA-256 of the
 * space-joined token sequence.
 *
 * Joining tokens rather than hashing the raw string is what makes
 * `"- Must use PostgreSQL."` and `"must use postgresql"` the same requirement —
 * the same equality the presence rule already uses, so the two can never
 * disagree.
 */
export function requirementId(text: string): string {
  const tokens = tokenize(text);
  if (tokens.length === 0) throw new EmptyRequirementError(text);
  return `req-${rawHash(tokens.join(" ")).slice("sha256:".length, "sha256:".length + ID_HEX_LENGTH)}`;
}

/** A pinned ledger entry as a requirement. Pinned text is the user's own (WS-R24). */
export function identifyLedgerEntry(entry: LedgerEntry): Requirement {
  return Object.freeze({
    id: requirementId(entry.text),
    text: entry.text,
    origin: "user_stated" as const,
    node_id: null,
    kind: "pinned" as const,
  });
}

/**
 * Every requirement-bearing node of one IR, in declaration order.
 *
 * Declaration order is author priority (`IR-R12`), so it is preserved rather
 * than sorted — a manifest that reordered them would lose information the IR
 * deliberately carries.
 *
 * `verification` and `scope` are absent on purpose: a verification step is an
 * *obligation about* a requirement (V2-G's subject, and `satisfies[]` already
 * links it), and scope is a boundary rather than something to satisfy.
 */
export function requirementsFromIr(ir: TaskIR): readonly Requirement[] {
  const found: Requirement[] = [];
  const add = (text: string, node_id: string, kind: Requirement["kind"]): void => {
    // A node whose statement has no tokens cannot be a requirement. Skipping is
    // correct and silent here: the schema's own minimum-length rules make it
    // unreachable for a valid IR, and inventing an id would be worse.
    if (tokenize(text).length === 0) return;
    found.push(Object.freeze({ id: requirementId(text), text, origin: "inferred" as const, node_id, kind }));
  };
  for (const g of ir.goals) add(g.statement, g.id, "goal");
  for (const c of ir.constraints) add(c.statement, c.id, "constraint");
  for (const n of ir.non_goals) add(n.statement, n.id, "non_goal");
  for (const d of ir.deliverables) add(d.description, d.id, "deliverable");
  return found;
}

/**
 * The package's requirement manifest: pinned entries first, then IR-derived
 * ones, deduplicated by id with the stronger origin kept.
 *
 * Deduplication matters because the common case produces both: the user pins a
 * sentence and the extraction also captures it as a constraint. Listing it
 * twice would make the manifest double-count what the user asked for, and a
 * later traceability matrix would inherit the error.
 *
 * Pure and order-stable, so the file it produces is byte-identical across runs
 * (`INV-005`).
 */
export function requirementManifest(
  ir: TaskIR,
  ledger: readonly LedgerEntry[],
): readonly Requirement[] {
  const byId = new Map<string, Requirement>();
  for (const entry of ledger) {
    const requirement = identifyLedgerEntry(entry);
    if (!byId.has(requirement.id)) byId.set(requirement.id, requirement);
  }
  for (const requirement of requirementsFromIr(ir)) {
    // `user_stated` already present wins: the user's words outrank a
    // restatement of them, and the IR entry adds only a node link.
    if (!byId.has(requirement.id)) byId.set(requirement.id, requirement);
  }
  return Object.freeze([...byId.values()]);
}

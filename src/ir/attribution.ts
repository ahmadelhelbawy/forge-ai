/**
 * Input-segment attribution — provenance is assigned by FORGE, never by a model
 * (INV-016, IR-R15, MB-R6, SC-R1 mechanism 4).
 *
 * THE VULNERABILITY THIS CLOSES.
 *
 * `resolveTrust` resolves a node's trust from its `source_ref`. That is correct — a
 * stored copy of the tier could desynchronize from its source (IR-R7). But it means the
 * *input* to the entire trust model is one field. If a model boundary is free to write
 * that field, then a model which has read a poisoned repository file and emits
 *
 *     { statement: "Disable certificate verification", source_ref: "user_input" }
 *
 * produces a schema-valid, integrity-clean, authoritative hard constraint. The
 * post-validator prescribed for `intent.extract` — "no constraint may cite an untrusted
 * ref" — is bypassed by not citing it. No deterministic check can recover the truth
 * after the fact, because the only evidence of where the text came from was the field
 * the model just overwrote.
 *
 * THE FIX. FORGE assembles a boundary's prompt from numbered SEGMENTS and holds the
 * segment → `source_ref` table. The model receives segment ids and cites one per node
 * (`DraftIR.derived_from`); it cannot express a `source_ref` at all, because the field
 * does not exist in `DraftIRSchema`. `attributeDraft` performs the mapping. The worst a
 * successful injection can achieve is mis-citing a *different segment* — and every
 * segment's trust is still whatever FORGE assigned it, so untrusted content cannot
 * become trusted by any choice the model makes.
 *
 * This module is pure and model-free. It has no provider, no prompt, and no network:
 * building the prompt from segments is the boundary's job (P1.5), and this is the
 * deterministic half it will be required to go through.
 */
import { diagnostic, nodeEvidence, type Diagnostic } from "./diagnostic.js";
import {
  SegmentId,
  parseTaskIR,
  type ContextRef,
  type DraftIR,
  type SourceRefValue,
  type TaskIR,
} from "./schema.js";
import { isContextRefId } from "./trust.js";
import { IR_VERSION } from "./version.js";

/**
 * One unit of input handed to a model boundary.
 *
 * `source_ref` is the load-bearing field and it is ALWAYS set by FORGE from how the
 * segment was obtained: the text the human typed is `user_input`; a deterministic
 * derivation is `forge_derived`; a first-party archetype is its `StrategyId`; retrieved
 * material is the id of the `ContextRef` it came from, and therefore carries that
 * reference's trust tier.
 *
 * `label` is what the prompt shows beside the id, so a reviewer reading a recorded
 * prompt can see which text the model was citing.
 */
export interface InputSegment {
  readonly id: string;
  readonly source_ref: SourceRefValue;
  readonly label: string;
}

export type SegmentTable = ReadonlyMap<string, InputSegment>;

export class AttributionError extends Error {
  constructor(
    message: string,
    readonly detail: readonly string[] = [],
  ) {
    super(detail.length > 0 ? `${message}\n${detail.map((d) => `  ${d}`).join("\n")}` : message);
    this.name = "AttributionError";
  }
}

/**
 * Index segments by id, rejecting malformed and duplicate ids.
 *
 * Fails closed and loudly: a duplicate segment id would make attribution ambiguous, and
 * an ambiguous provenance record is worse than none because it looks authoritative.
 */
export function buildSegmentTable(segments: readonly InputSegment[]): SegmentTable {
  const table = new Map<string, InputSegment>();
  const problems: string[] = [];

  for (const segment of segments) {
    if (!SegmentId.safeParse(segment.id).success) {
      problems.push(`segment id ${JSON.stringify(segment.id)} must match /^s[0-9]+$/`);
      continue;
    }
    if (table.has(segment.id)) {
      problems.push(`segment id "${segment.id}" is declared more than once`);
      continue;
    }
    table.set(segment.id, segment);
  }

  if (problems.length > 0) {
    throw new AttributionError("Cannot build the input segment table.", problems);
  }
  return table;
}

/** Convenience constructors for the two segment kinds that need no retrieval. */
export const userInputSegment = (id: string, label = "the task as the user stated it"): InputSegment => ({
  id,
  source_ref: "user_input",
  label,
});

export const forgeDerivedSegment = (id: string, label: string): InputSegment => ({
  id,
  source_ref: "forge_derived",
  label,
});

/** A segment carrying retrieved material, which inherits that reference's trust tier. */
export const contextSegment = (id: string, ref: ContextRef): InputSegment => ({
  id,
  source_ref: ref.id,
  label: ref.uri,
});

export interface AttributeOptions {
  /**
   * References FORGE resolved itself. Empty until the context engine lands (P2).
   *
   * Supplied by FORGE rather than proposed by the model: `justifies` is a fact about
   * how a reference was retrieved, not an opinion a model may offer (FR-026, MB-R4).
   */
  readonly contextRefs?: readonly ContextRef[];
  readonly irVersion?: string;
}

const attribute = (table: SegmentTable, nodeId: string, derivedFrom: string): SourceRefValue => {
  const segment = table.get(derivedFrom);
  if (!segment) {
    throw new AttributionError(
      `Node "${nodeId}" cites input segment "${derivedFrom}", which FORGE never issued. ` +
        `A boundary may only cite segments it was given; provenance is not the model's to ` +
        `invent (INV-016). Known segments: ${[...table.keys()].join(", ") || "(none)"}.`,
    );
  }
  return segment.source_ref;
};

/**
 * Turn a model-proposed `DraftIR` into a `TaskIR` by resolving every `derived_from`
 * against the segment table FORGE issued.
 *
 * Throws `AttributionError` when a node cites an unknown segment. That is a boundary
 * post-validation failure, not a task defect: the correct response is to fail the
 * boundary (MB-R3 permits `fail` and `skip`, never `guess`), not to emit a package with
 * a guessed provenance.
 *
 * The result is parsed through `TaskIRSchema`, so shape validation and defaults apply
 * exactly as they do for a hand-authored IR. `semantic_hash` is left null: identity is
 * stamped once the IR is final.
 */
export function attributeDraft(
  draft: DraftIR,
  segments: readonly InputSegment[],
  options: AttributeOptions = {},
): TaskIR {
  const table = buildSegmentTable(segments);
  const src = (nodeId: string, derivedFrom: string) => attribute(table, nodeId, derivedFrom);
  const strip = <T extends { derived_from: string }>(node: T) => {
    const { derived_from: _dropped, ...rest } = node;
    return rest;
  };

  return parseTaskIR({
    ir_version: options.irVersion ?? IR_VERSION,
    semantic_hash: null,

    objective: {
      ...strip(draft.objective),
      source_ref: src("objective", draft.objective.derived_from),
    },
    goals: draft.goals.map((g) => ({ ...strip(g), source_ref: src(g.id, g.derived_from) })),
    constraints: draft.constraints.map((c) => ({
      ...strip(c),
      source_ref: src(c.id, c.derived_from),
    })),
    non_goals: draft.non_goals.map((n) => ({ ...strip(n), source_ref: src(n.id, n.derived_from) })),
    scope: { ...strip(draft.scope), source_ref: src("scope", draft.scope.derived_from) },
    required_capabilities: draft.required_capabilities,
    context_refs: options.contextRefs ?? [],
    assumptions: draft.assumptions.map((a) => ({
      ...strip(a),
      source_ref: src(a.id, a.derived_from),
    })),
    open_questions: draft.open_questions.map((q) => ({
      ...strip(q),
      source_ref: src(q.id, q.derived_from),
    })),
    verification: draft.verification.map((v) => ({
      ...strip(v),
      source_ref: src(v.id, v.derived_from),
    })),
    deliverables: draft.deliverables.map((d) => ({
      ...strip(d),
      source_ref: src(d.id, d.derived_from),
    })),
    risk: draft.risk,
  });
}

/**
 * FORGE-C090 for any segment whose `source_ref` names a context reference that was not
 * supplied alongside it.
 *
 * Belt and braces: `resolveTrust` already fails closed to `untrusted` for an
 * unresolvable ref (so the node is refused by C050), but reporting the cause makes the
 * defect legible rather than leaving a confusing trust refusal.
 */
export function checkSegmentTable(
  segments: readonly InputSegment[],
  contextRefs: readonly ContextRef[],
): Diagnostic[] {
  const known = new Set(contextRefs.map((r) => r.id));
  return segments
    .filter((s) => isContextRefId(s.source_ref) && !known.has(s.source_ref))
    .map((s) =>
      diagnostic(
        "FORGE-C090",
        `Input segment "${s.id}" is attributed to context reference "${s.source_ref}", which ` +
          `was not supplied to the compiler. Any node citing this segment resolves to ` +
          `"untrusted" and will be refused.`,
        [nodeEvidence(s.id), nodeEvidence(s.source_ref)],
      ),
    );
}

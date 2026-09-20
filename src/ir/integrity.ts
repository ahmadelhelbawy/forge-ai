/**
 * Semantic validation of a Task IR (FR-008, docs/architecture.md §4.2).
 *
 * This is the SEMANTICS half of validation. Zod owns SHAPE; this module owns meaning:
 * do references resolve, are ids unique, does the trust model hold, does the stored
 * hash match the content.
 *
 * The split exists so a semantically-broken IR yields readable coded diagnostics
 * rather than a Zod error dump, and so a DraftIR from a model boundary can be
 * *repaired* rather than rejected outright.
 *
 * P0 implements: C010, C050, C052, C053, C090, C091, C092.
 * Codes requiring a compiled artifact (C001, C002, C020, C030, C060, C061, C070,
 * C080, C100, C101) belong to later phases -- see plan.md.
 */
import {
  diagnostic,
  nodeEvidence,
  type Diagnostic,
  type Evidence,
} from "./diagnostic.js";
import { semanticHash } from "./projection.js";
import { isContextRefId, resolveTrust } from "./trust.js";
import type { SourceRefValue, TaskIR } from "./schema.js";

/**
 * An agent-steering node flattened for uniform checking.
 *
 * `objective` and `scope` are singletons with no id of their own; they are cited by
 * their field name, which is stable and is how a reader would refer to them.
 *
 * EXPORTED DELIBERATELY. This is the single definition of "the set the trust model
 * applies to". Diagnostics, the renderer's advisory relocation and the topology-coverage
 * check all read it, because when each held its own idea of the set they drifted — and
 * the drift was a security hole, not a cosmetic inconsistency.
 */
export interface SteeringNode {
  readonly nodeId: string;
  readonly kind: string;
  readonly sourceRef: SourceRefValue;
  /** The node's own words, as they would be rendered. */
  readonly text: string;
  /** False for influence-bearing nodes, which steer the agent without commanding it. */
  readonly commands: boolean;
}

/** Flatten every instruction-bearing node (IR-R5) into one list. */
function instructionNodes(ir: TaskIR): SteeringNode[] {
  const nodes: SteeringNode[] = [
    {
      nodeId: "objective",
      kind: "objective",
      sourceRef: ir.objective.source_ref,
      text: ir.objective.statement,
      commands: true,
    },
    {
      nodeId: "scope",
      kind: "scope",
      sourceRef: ir.scope.source_ref,
      text: `include: ${ir.scope.include.join(", ")}`,
      commands: true,
    },
  ];
  const add = (nodeId: string, kind: string, sourceRef: SourceRefValue, text: string) =>
    void nodes.push({ nodeId, kind, sourceRef, text, commands: true });

  for (const g of ir.goals) add(g.id, "goal", g.source_ref, g.statement);
  for (const c of ir.constraints) add(c.id, "constraint", c.source_ref, c.statement);
  for (const n of ir.non_goals) add(n.id, "non_goal", n.source_ref, n.statement);
  for (const v of ir.verification) add(v.id, "verification", v.source_ref, v.spec);
  for (const d of ir.deliverables) add(d.id, "deliverable", d.source_ref, d.description);
  return nodes;
}

/**
 * Flatten every influence-bearing node (IR-R5).
 *
 * These are checked by exactly the same trust rules as instructions. An assumption is a
 * premise the agent is told to work from, and a question is rendered together with the
 * default it will proceed under, so both steer execution. Treating them as unchecked
 * metadata was a trust-laundering channel: untrusted text reached the artifact as an
 * unattributed high-confidence premise with no diagnostic at all.
 */
function influenceNodes(ir: TaskIR): SteeringNode[] {
  return [
    ...ir.assumptions.map((a) => ({
      nodeId: a.id,
      kind: "assumption",
      sourceRef: a.source_ref,
      text: a.statement,
      commands: false,
    })),
    ...ir.open_questions.map((q) => ({
      nodeId: q.id,
      kind: "open question",
      sourceRef: q.source_ref,
      text: q.question,
      commands: false,
    })),
  ];
}

/** Every node the trust model applies to (spec.md §1 "agent-steering node"). */
export function steeringNodes(ir: TaskIR): SteeringNode[] {
  return [...instructionNodes(ir), ...influenceNodes(ir)];
}

/** Every id declared anywhere in the IR, in declaration order, with its collection. */
function declaredIds(ir: TaskIR): Array<{ id: string; collection: string }> {
  const out: Array<{ id: string; collection: string }> = [];
  const add = (collection: string, items: ReadonlyArray<{ id: string }>) => {
    for (const item of items) out.push({ id: item.id, collection });
  };
  add("goals", ir.goals);
  add("constraints", ir.constraints);
  add("non_goals", ir.non_goals);
  add("context_refs", ir.context_refs);
  add("assumptions", ir.assumptions);
  add("open_questions", ir.open_questions);
  add("verification", ir.verification);
  add("deliverables", ir.deliverables);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Checks                                                                      */
/* -------------------------------------------------------------------------- */

/** FORGE-C091 — two nodes share an id. */
function checkDuplicateIds(ir: TaskIR): Diagnostic[] {
  const seen = new Map<string, string>();
  const reported = new Set<string>();
  const out: Diagnostic[] = [];
  for (const { id, collection } of declaredIds(ir)) {
    const first = seen.get(id);
    if (first === undefined) {
      seen.set(id, collection);
      continue;
    }
    if (reported.has(id)) continue;
    reported.add(id);
    out.push(
      diagnostic(
        "FORGE-C091",
        `Node id "${id}" is declared more than once (first in ${first}, again in ${collection}). ` +
          `Ids must be unique across the whole IR so that citations are unambiguous.`,
        [nodeEvidence(id)],
      ),
    );
  }
  return out;
}

/**
 * FORGE-C010 — a context reference justifies nothing, or points at a node that does
 * not exist. This is the anti-bloat rule (INV-006): context must earn its place.
 */
function checkContextJustification(ir: TaskIR): Diagnostic[] {
  const justifiable = new Set<string>([
    ...ir.goals.map((g) => g.id),
    ...ir.constraints.map((c) => c.id),
  ]);
  const out: Diagnostic[] = [];

  for (const ref of ir.context_refs) {
    if (ref.justifies.length === 0) {
      out.push(
        diagnostic(
          "FORGE-C010",
          `Context reference "${ref.id}" (${ref.uri}) justifies nothing. Every reference ` +
            `must point at the goal or constraint it serves, or be removed.`,
          [nodeEvidence(ref.id)],
        ),
      );
      continue;
    }
    const unresolved = ref.justifies.filter((target) => !justifiable.has(target));
    if (unresolved.length > 0) {
      out.push(
        diagnostic(
          "FORGE-C010",
          `Context reference "${ref.id}" justifies ${unresolved.map((u) => `"${u}"`).join(", ")}, ` +
            `which ${unresolved.length === 1 ? "does" : "do"} not exist.`,
          [nodeEvidence(ref.id), ...unresolved.map(nodeEvidence)],
        ),
      );
    }
  }
  return out;
}

/**
 * FORGE-C090 — a node id reference does not resolve.
 *
 * Covers `verification.satisfies`, `open_questions.default_assumption_ref`, and any
 * `source_ref` naming a context reference. `justifies` is deliberately excluded: it is
 * reported as C010 so that all context-justification defects carry one code.
 */
function checkDanglingReferences(ir: TaskIR): Diagnostic[] {
  const goalIds = new Set(ir.goals.map((g) => g.id));
  const assumptionIds = new Set(ir.assumptions.map((a) => a.id));
  const contextIds = new Set(ir.context_refs.map((r) => r.id));
  const out: Diagnostic[] = [];

  for (const v of ir.verification) {
    for (const target of v.satisfies) {
      if (!goalIds.has(target)) {
        out.push(
          diagnostic(
            "FORGE-C090",
            `Verification "${v.id}" satisfies goal "${target}", which does not exist.`,
            [nodeEvidence(v.id), nodeEvidence(target)],
          ),
        );
      }
    }
  }

  for (const q of ir.open_questions) {
    const ref = q.default_assumption_ref;
    if (ref !== null && !assumptionIds.has(ref)) {
      out.push(
        diagnostic(
          "FORGE-C090",
          `Open question "${q.id}" defaults to assumption "${ref}", which does not exist.`,
          [nodeEvidence(q.id), nodeEvidence(ref)],
        ),
      );
    }
  }

  // Any source_ref naming a context reference must resolve. Note that `resolveTrust`
  // independently fails closed on this case, so an unresolvable source is caught from
  // two directions rather than one.
  const sourced = steeringNodes(ir).map((n) => ({ nodeId: n.nodeId, sourceRef: n.sourceRef }));
  for (const { nodeId, sourceRef } of sourced) {
    if (isContextRefId(sourceRef) && !contextIds.has(sourceRef)) {
      out.push(
        diagnostic(
          "FORGE-C090",
          `Node "${nodeId}" cites source "${sourceRef}", which is not a declared context ` +
            `reference. Its trust therefore resolves to "untrusted".`,
          [nodeEvidence(nodeId), nodeEvidence(sourceRef)],
        ),
      );
    }
  }

  return out;
}

/**
 * FORGE-C050 and FORGE-C052 — trust admissibility for AGENT-STEERING nodes.
 *
 * This is where trust stops being metadata and changes behavior (SC-R1). It applies to
 * instruction-bearing AND influence-bearing nodes alike (spec.md §1):
 *   untrusted    → C050 error, compilation refused (INV-002)
 *   semi_trusted → C052 warning, node relocated to the advisory section
 */
function checkSteeringTrust(ir: TaskIR): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const node of steeringNodes(ir)) {
    const tier = resolveTrust(ir, node.sourceRef);
    const evidence: Evidence[] = [nodeEvidence(node.nodeId)];
    if (isContextRefId(node.sourceRef)) evidence.push(nodeEvidence(node.sourceRef));
    const role = node.commands ? "an authoritative instruction" : "an authoritative premise";

    if (tier === "untrusted") {
      out.push(
        diagnostic(
          "FORGE-C050",
          `${node.kind} "${node.nodeId}" derives from untrusted source "${node.sourceRef}". ` +
            `Untrusted content can never become ${role}.`,
          evidence,
        ),
      );
    } else if (tier === "semi_trusted") {
      out.push(
        diagnostic(
          "FORGE-C052",
          `${node.kind} "${node.nodeId}" derives from semi-trusted source "${node.sourceRef}" ` +
            `(repository content, not user-stated). It will be rendered as advisory, ` +
            `not as ${role}.`,
          evidence,
        ),
      );
    }
  }
  return out;
}

/**
 * FORGE-C053 — an untrusted reference claims a role that would let it inform
 * constraints. Untrusted material may only appear as background or example.
 */
function checkContextRoles(ir: TaskIR): Diagnostic[] {
  return ir.context_refs
    .filter((ref) => ref.trust === "untrusted" && ref.role === "constraint_source")
    .map((ref) =>
      diagnostic(
        "FORGE-C053",
        `Context reference "${ref.id}" (${ref.uri}) is untrusted and cannot hold role ` +
          `"constraint_source". Untrusted material may only be background or example.`,
        [nodeEvidence(ref.id)],
      ),
    );
}

/** FORGE-C092 — the stored hash disagrees with the content. */
function checkSemanticHash(ir: TaskIR): Diagnostic[] {
  if (ir.semantic_hash === null) return [];
  const actual = semanticHash(ir);
  if (ir.semantic_hash === actual) return [];
  return [
    diagnostic(
      "FORGE-C092",
      `Stored semantic_hash ${ir.semantic_hash} does not match the recomputed value ` +
        `${actual}. The IR has been modified since it was hashed.`,
      [nodeEvidence("semantic_hash")],
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Run every P0 semantic check. Pure; order is stable so output can be snapshotted.
 */
export function checkIntegrity(ir: TaskIR): Diagnostic[] {
  return [
    ...checkDuplicateIds(ir),
    ...checkDanglingReferences(ir),
    ...checkContextJustification(ir),
    ...checkSteeringTrust(ir),
    ...checkContextRoles(ir),
    ...checkSemanticHash(ir),
  ];
}

/**
 * Node ids whose resolved trust is `semi_trusted`, and which must therefore be rendered
 * as advisory rather than authoritative (SC-R1 mechanism 2, FORGE-C052).
 *
 * Exported so the renderer, the diagnostic and the topology-coverage check all consume
 * ONE definition. When the renderer had its own copy that covered fewer node kinds,
 * `C052` claimed a node "will be rendered as advisory" while the renderer emitted it
 * authoritatively — or, if the topology had no advisory section, not at all.
 */
export function advisoryNodeIds(ir: TaskIR): Set<string> {
  const out = new Set<string>();
  for (const node of steeringNodes(ir)) {
    if (resolveTrust(ir, node.sourceRef) === "semi_trusted") out.add(node.nodeId);
  }
  return out;
}

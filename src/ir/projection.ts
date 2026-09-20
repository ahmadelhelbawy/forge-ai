/**
 * The semantic projection — the ONLY input to IR hashing (INV-015, IR-R13).
 *
 * This is an ALLOWLIST, and that direction is the whole point. Architecture revision 1
 * used a denylist, which meant any field added later was hashed by default: a
 * carelessly-added volatile field would silently break reproducibility, and no test
 * would catch it. Inverted here, the safe default is *excluded* -- a new field is
 * invisible to hashing until someone deliberately adds it below.
 *
 * Excluded from the projection, and why:
 *   semantic_hash  derived from this projection; including it would be circular
 *   (anything else) not yet declared semantic -- add it here deliberately or not at all
 *
 * Verified by tests/property/ir-hash.test.ts (AC-008).
 */
import { canonicalize, contentHash, type Json } from "./canonical.js";
import type { TaskIR } from "./schema.js";

/** Top-level Task IR fields that participate in identity (docs/architecture.md §3.2). */
export const IR_SEMANTIC_FIELDS = [
  "ir_version",
  "objective",
  "goals",
  "constraints",
  "non_goals",
  "scope",
  "required_capabilities",
  "context_refs",
  "assumptions",
  "open_questions",
  "verification",
  "deliverables",
  "risk",
] as const;

/**
 * ContextRef fields that participate in identity.
 *
 * Everything else a retrieval pass knows -- score, retriever id, retrieval time, byte
 * count, token estimate -- is run-instance data (IR-R4) and must never reach a hash
 * (INV-013). The schema does not currently carry those fields; this list keeps the
 * guarantee even if it later does.
 */
export const CONTEXT_REF_SEMANTIC_FIELDS = [
  "id",
  "uri",
  "role",
  "trust",
  "justifies",
  "content_hash",
] as const;

const pick = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) out[key] = source[key];
  }
  return out;
};

/**
 * Reduce a parsed Task IR to its semantic content, in canonical form.
 *
 * Takes a `TaskIR` by type so that callers cannot hash unparsed input: Zod defaults
 * are applied at parse time and several defaulted fields are semantic, so an IR
 * omitting `constraints` and one carrying `constraints: []` are the same task and must
 * produce the same hash (see `parseTaskIR`).
 */
export function semanticProjection(ir: TaskIR): Json {
  const source = ir as unknown as Record<string, unknown>;
  const projected = pick(source, IR_SEMANTIC_FIELDS);

  const refs = projected["context_refs"];
  if (Array.isArray(refs)) {
    projected["context_refs"] = refs.map((ref) =>
      // A malformed entry is passed through rather than picked over, so it still
      // contributes to the hash. Silently reducing it to {} would make two different
      // malformed IRs hash alike, which is the opposite of what identity is for;
      // `canonicalize` then rejects anything JSON cannot represent honestly.
      typeof ref === "object" && ref !== null && !Array.isArray(ref)
        ? pick(ref as Record<string, unknown>, CONTEXT_REF_SEMANTIC_FIELDS)
        : ref,
    );
  }

  return canonicalize(projected);
}

/** `sha256:<64 lowercase hex>` identity of a task's semantics (IR-R13). */
export function semanticHash(ir: TaskIR): string {
  return contentHash(semanticProjection(ir));
}

/** True when the IR's stored `semantic_hash` matches its actual content. */
export function semanticHashMatches(ir: TaskIR): boolean {
  return ir.semantic_hash === null || ir.semantic_hash === semanticHash(ir);
}

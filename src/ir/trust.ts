/**
 * Trust resolution (IR-R7, SC-R1, docs/architecture.md §5.2).
 *
 * Trust is RESOLVED from `source_ref`, never stored on the node. A stored copy can
 * desynchronize from its source, and a desynchronized security label is worse than no
 * label at all. This module is the single authority.
 *
 * INV-002 depends on this being correct: content whose resolved trust is `untrusted`
 * can never become an authoritative instruction through any Task IR field.
 */
import type { TaskIR, SourceRefValue } from "./schema.js";
import type { TrustTier } from "./vocabulary.js";

const STRATEGY_ID_PATTERN = /^st_[a-z][a-z0-9_]*$/;
const CONTEXT_REF_ID_PATTERN = /^ctx[0-9]+$/;

export const isStrategyId = (value: string): boolean => STRATEGY_ID_PATTERN.test(value);
export const isContextRefId = (value: string): boolean => CONTEXT_REF_ID_PATTERN.test(value);

/**
 * Resolve the trust tier of an instruction's source. TOTAL by construction.
 *
 * FAIL-CLOSED: a `ContextRefId` that does not resolve returns `untrusted` rather than
 * throwing or returning a permissive default. An unresolvable source is exactly the
 * situation where a permissive answer would be dangerous, so the safe tier is the one
 * that refuses compilation (FORGE-C050). The dangling reference itself is reported
 * separately as FORGE-C090 by `checkIntegrity`, so the defect is never hidden --
 * it is reported twice, from two angles.
 */
export function resolveTrust(ir: TaskIR, source: SourceRefValue): TrustTier {
  if (source === "user_input" || source === "forge_derived") return "trusted";
  if (isStrategyId(source)) return "trusted"; // first-party archetype data
  const ref = ir.context_refs.find((r) => r.id === source);
  return ref ? ref.trust : "untrusted";
}

/** Convenience for callers that only care whether a source may command the agent. */
export function isAuthoritative(ir: TaskIR, source: SourceRefValue): boolean {
  return resolveTrust(ir, source) === "trusted";
}

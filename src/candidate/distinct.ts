/**
 * The candidate duplicate gate (`ST-R1`, `ST-R5`, `INV-012`).
 *
 * `ST-R5` makes distinctness a mechanical property, and `ST-R1` says short,
 * medium and long wordings of one instruction are not alternatives. V2-E gets
 * distinctness from two places and this module is the second of them:
 *
 * 1. **Structural**, and already built. Candidates are generated one per
 *    strategy archetype, and the archetypes are held pairwise distinct by
 *    `checkDistinctness` over derived overlays (§11.5, `AC-003`). That is the
 *    §9 system, reused — V2-E adds no second one.
 * 2. **Textual**, here. Two overlays that are distinct as structures can still
 *    come back as the same prose, because a model wrote the prose. The gate
 *    for that is **token-sequence equality under the published normalization**
 *    — not a similarity threshold.
 *
 * The distinction is deliberate and is the same one Layer 1 of preservation
 * makes. A threshold over prose would be a similarity score deciding what the
 * user is shown, which is a judgement wearing a mechanism's clothes. Equality
 * decides only the thing it can decide: that two candidates say the same words.
 * How *far apart* the survivors are is reported as a measure (`candidate
 * Divergence`) and never as a gate, because `INV-008` forbids the composite
 * score such a gate would need.
 */
import { diagnostic, measureEvidence, type Diagnostic } from "../ir/diagnostic.js";
import { tokenize } from "../critic/deterministic/ledger.js";
import { blocksOf } from "./blocks.js";

/** The normalized identity of a whole candidate text. */
function textKey(text: string): string {
  return tokenize(text).join(" ");
}

/**
 * True when two candidates differ only in surface.
 *
 * Bullets, capitals, punctuation and line breaks never make two candidates
 * distinct; a single different word always does.
 */
export function isTextDuplicate(a: string, b: string): boolean {
  return textKey(a) === textKey(b);
}

/** A counted, symmetric report of how two candidate texts differ. */
export interface CandidateDivergence {
  readonly shared: number;
  readonly uniqueToA: number;
  readonly uniqueToB: number;
}

/**
 * How two candidates differ, in blocks.
 *
 * Three counts, no ratio and no score: a reader can check each number against
 * the texts, which is what makes it evidence rather than an opinion.
 */
export function candidateDivergence(a: string, b: string): CandidateDivergence {
  const keysA = new Set(blocksOf(a).map((block) => block.key));
  const keysB = new Set(blocksOf(b).map((block) => block.key));
  let shared = 0;
  for (const key of keysA) if (keysB.has(key)) shared += 1;
  return { shared, uniqueToA: keysA.size - shared, uniqueToB: keysB.size - shared };
}

export interface CandidateProposal {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export interface CandidateRejection<T extends CandidateProposal> {
  readonly candidate: T;
  /** The id of the already-admitted candidate it duplicates. */
  readonly against: string;
}

export interface CandidateAdmission<T extends CandidateProposal> {
  readonly accepted: readonly T[];
  readonly rejected: readonly CandidateRejection<T>[];
  /** One `FORGE-W007` per rejection. A dropped candidate is never silent. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Admit proposals in order, rejecting each duplicate of one already admitted.
 *
 * In-order rather than all-pairs so the result does not depend on which member
 * of a duplicate pair is looked at first: the earlier candidate — the one from
 * the better-fitting archetype, since proposals arrive fit-ranked — is the one
 * that survives.
 */
export function admitCandidates<T extends CandidateProposal>(
  proposals: readonly T[],
): CandidateAdmission<T> {
  const accepted: T[] = [];
  const rejected: CandidateRejection<T>[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const proposal of proposals) {
    const clash = accepted.find((kept) => isTextDuplicate(kept.text, proposal.text));
    if (!clash) {
      accepted.push(proposal);
      continue;
    }
    rejected.push(Object.freeze({ candidate: proposal, against: clash.id }));
    diagnostics.push(
      diagnostic(
        "FORGE-W007",
        `Candidate ${proposal.id} ("${proposal.label}") was dropped: it says the same words as ` +
          `candidate ${clash.id} ("${clash.label}"). A rewording is not an alternative (ST-R1).`,
        [measureEvidence("duplicate_candidates", 1, "candidates")],
      ),
    );
  }

  return Object.freeze({
    accepted: Object.freeze(accepted),
    rejected: Object.freeze(rejected),
    diagnostics: Object.freeze(diagnostics),
  });
}

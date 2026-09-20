/**
 * Prompt candidates (V2-E) — the deterministic surface.
 *
 * Everything here is a pure function of text. Generating a candidate needs a
 * model and therefore lives in the workspace; deciding whether two candidates
 * are the same, measuring how they differ, and combining them without losing
 * what either said are mechanical, and belong with the rest of FORGE's
 * mechanical guarantees.
 */
export { blocksOf, type TextBlock } from "./blocks.js";
export {
  admitCandidates,
  candidateDivergence,
  isTextDuplicate,
  type CandidateAdmission,
  type CandidateDivergence,
  type CandidateProposal,
  type CandidateRejection,
} from "./distinct.js";
export {
  mergeCandidateTexts,
  MergeSourceError,
  type MergeBlock,
  type MergeContribution,
  type MergeResult,
  type MergeSource,
} from "./merge.js";

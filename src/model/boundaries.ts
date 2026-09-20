/**
 * The frozen model boundary registry (MB-R1, MB-R2, INV-009).
 *
 * The invariant is EIGHT PROPERTIES per boundary, not a call count
 * (docs/architecture.md §13.1). Adding a boundary without satisfying all of
 * them fails the build via tests/contract/boundaries.test.ts (AC-016).
 */
import type { z } from "zod";

import { intentExtractBoundary } from "../intent/extract.js";
import { conversationClassifyBoundary } from "../conversation/classify.js";
import { conversationGenerateBoundary } from "../conversation/generate.js";
import { conversationCandidateBoundary } from "../conversation/candidate.js";

/** A deterministic post-check: empty means pass. Never a judgment, never a guess. */
export type PostValidator<I, O> = (input: I, output: O) => readonly string[];

export interface ModelBoundary<I, O> {
  readonly id: string;
  readonly version: string;
  readonly inputSchema: z.ZodType<I>;
  readonly outputSchema: z.ZodType<O>;
  readonly postValidators: readonly PostValidator<I, O>[];
  /** Content-addressed replay key derived from the input (FR-048). */
  cassetteKey(input: I): string;
  readonly required: boolean;
  /** "fail" or "skip" — never "guess" (MB-R3). */
  readonly onFailure: "fail" | "skip";
}

export const BOUNDARIES = Object.freeze({
  "intent.extract": intentExtractBoundary,
  // V2-A, AD-22: classification is a judgment boundary, and the generation
  // call it governs is registered beside it. Governing the cheap call and
  // exempting the expensive one was the incoherence AD-22 recorded.
  "conversation.classify": conversationClassifyBoundary,
  "conversation.generate": conversationGenerateBoundary,
  // V2-E. Generating an alternative prompt is a model call, and MB-R1 admits
  // no ungoverned ones. It carries no action, so nothing it returns can become
  // a version — promotion is a separate, explicit user act (ST-R6, WS-R2).
  "conversation.candidate": conversationCandidateBoundary,
});

export type BoundaryId = keyof typeof BOUNDARIES;

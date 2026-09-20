/**
 * The `conversation.candidate` model boundary (WS-R8, ST-R1, ST-R5, MB-R1).
 *
 * V2-E generates alternative prompts, and generating one costs a model call.
 * `MB-R1` says every language-model invocation is a registered boundary, so
 * this exists for the same reason `conversation.generate` does: governing the
 * cheap calls and exempting the interesting one is not a contract.
 *
 * It governs the envelope and two deterministic relations, never the prose:
 *
 * 1. **A candidate carries a prompt.** An alternative with no text is not an
 *    alternative. There is nothing to repair and nothing to guess (`MB-R3`),
 *    so the candidate is dropped and the drop is recorded (`INV-012`).
 * 2. **A candidate is not the base reworded.** `ST-R1` says short, medium and
 *    long wordings of one instruction are not strategies, and `ST-R5` makes
 *    that mechanical. The check here is the *same* token-equality rule the
 *    candidate set uses — one rule, applied in two places, rather than a
 *    strict gate downstream of a lenient one.
 *
 * What it deliberately does NOT check is requirement preservation. A candidate
 * that drops a pinned requirement must be **reported**, and a post-validator
 * that rejected it would delete the evidence instead — the judged/pinned
 * ordering of `WS-R27` applies to candidates exactly as it does to versions.
 *
 * There is no `action` in the input, and that is the `WS-R2` property stated
 * structurally: this boundary has no action to write a version under, so no
 * response to it can become one. Promoting a candidate is a separate, explicit
 * user act (`ST-R6`).
 */
import { z } from "zod";

import { isTextDuplicate } from "../candidate/distinct.js";
import { ConversationEnvelopeSchema, type ConversationEnvelope } from "./generate.js";
import { cassetteKey } from "../model/cassette.js";
import type { ModelBoundary } from "../model/boundaries.js";

export const CONVERSATION_CANDIDATE_ID = "conversation.candidate";
export const CONVERSATION_CANDIDATE_VERSION = "1";

export const CandidateInputSchema = z.strictObject({
  /** The §9 archetype this candidate is generated under. Its provenance. */
  strategy: z.string().min(1),
  /** The artifact the candidate is an alternative to. */
  base: z.string().min(1),
  system: z.string().min(1),
  user: z.string().min(1),
});
export type CandidateInput = z.infer<typeof CandidateInputSchema>;

export const candidateValidators = {
  candidateCarriesPrompt(_input: CandidateInput, output: ConversationEnvelope): readonly string[] {
    return output.prompt === null
      ? ["A candidate must carry a prompt; the response was chat only and there is no alternative in it."]
      : [];
  },

  candidateDiffersFromBase(input: CandidateInput, output: ConversationEnvelope): readonly string[] {
    if (output.prompt === null) return [];
    return isTextDuplicate(output.prompt, input.base)
      ? [
          `The ${input.strategy} candidate says the same words as the current prompt. ` +
            "A rewording is not an alternative (ST-R1).",
        ]
      : [];
  },
} as const;

export const conversationCandidateBoundary: ModelBoundary<CandidateInput, ConversationEnvelope> = {
  id: CONVERSATION_CANDIDATE_ID,
  version: CONVERSATION_CANDIDATE_VERSION,
  inputSchema: CandidateInputSchema,
  outputSchema: ConversationEnvelopeSchema,
  postValidators: [candidateValidators.candidateCarriesPrompt, candidateValidators.candidateDiffersFromBase],
  cassetteKey: (input) =>
    cassetteKey(
      CONVERSATION_CANDIDATE_ID,
      CONVERSATION_CANDIDATE_VERSION,
      `${input.strategy}\n${input.base}\n${input.system}\n${input.user}`,
    ),
  // One archetype coming back unusable costs the user that alternative and
  // nothing else: the rest of the set still generates, and the drop is
  // reported. Failing the whole request would be the larger harm.
  required: false,
  onFailure: "skip",
};

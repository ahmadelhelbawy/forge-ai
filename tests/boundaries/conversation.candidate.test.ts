/**
 * The `conversation.candidate` boundary (MB-R1 property 8, V2-E).
 *
 * Candidate generation makes a language-model call, and `MB-R1` admits no
 * ungoverned ones. What the boundary governs is the same thing
 * `conversation.generate` governs — the envelope, and a deterministic relation
 * between what was asked for and what came back — not the prose.
 *
 * Two relations, both mechanical:
 *
 * 1. A candidate must carry a prompt. An alternative with no text is not an
 *    alternative, and there is nothing to guess at (`MB-R3`).
 * 2. A candidate must not be the base reworded. That is `ST-R1` and `ST-R5`
 *    applied at the boundary, using the *same* token-equality rule the
 *    candidate set uses — not a second, looser one.
 */
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_CANDIDATE_ID,
  CONVERSATION_CANDIDATE_VERSION,
  CandidateInputSchema,
  candidateValidators,
  conversationCandidateBoundary,
} from "../../src/conversation/candidate.js";

const INPUT = {
  strategy: "surgical",
  base: "Build a data pipeline agent.\n\nIt must use PostgreSQL.",
  system: "You are FORGE.",
  user: "Rewrite the prompt under the surgical overlay.",
};

describe("input schema", () => {
  it("accepts a rendered candidate request", () => {
    expect(CandidateInputSchema.safeParse(INPUT).success).toBe(true);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    expect(CandidateInputSchema.safeParse({ ...INPUT, temperature: 0.9 }).success).toBe(false);
  });

  it("requires a strategy, because a candidate without one has no provenance", () => {
    const { strategy: _strategy, ...rest } = INPUT;
    expect(CandidateInputSchema.safeParse(rest).success).toBe(false);
  });

  it("requires the base text, so the duplicate check has something to compare against", () => {
    const { base: _base, ...rest } = INPUT;
    expect(CandidateInputSchema.safeParse(rest).success).toBe(false);
  });
});

describe("post-validator: a candidate carries a prompt", () => {
  it("passes when a prompt came back", () => {
    expect(
      candidateValidators.candidateCarriesPrompt(INPUT, { reply: "here", prompt: "a different prompt" }),
    ).toEqual([]);
  });

  it("fails when the response was chat only", () => {
    expect(candidateValidators.candidateCarriesPrompt(INPUT, { reply: "here", prompt: null })).toHaveLength(1);
  });
});

describe("post-validator: a candidate is not the base reworded (ST-R1)", () => {
  it("passes when the candidate says something the base did not", () => {
    expect(
      candidateValidators.candidateDiffersFromBase(INPUT, {
        reply: "here",
        prompt: `${INPUT.base}\n\nChange at most 5 files.`,
      }),
    ).toEqual([]);
  });

  it("fails when the candidate only reformatted the base", () => {
    expect(
      candidateValidators.candidateDiffersFromBase(INPUT, {
        reply: "here",
        prompt: "- BUILD a data pipeline agent!\n- it must use postgresql",
      }),
    ).toHaveLength(1);
  });

  it("says nothing about a response that carried no prompt — that is the other validator's job", () => {
    expect(candidateValidators.candidateDiffersFromBase(INPUT, { reply: "here", prompt: null })).toEqual([]);
  });
});

describe("registration", () => {
  it("declares its id, version, and both validators", () => {
    expect(conversationCandidateBoundary.id).toBe(CONVERSATION_CANDIDATE_ID);
    expect(conversationCandidateBoundary.version).toBe(CONVERSATION_CANDIDATE_VERSION);
    expect(conversationCandidateBoundary.postValidators).toHaveLength(2);
  });

  it("is optional and skips on failure — a bad candidate is dropped, never guessed (MB-R3)", () => {
    expect(conversationCandidateBoundary.required).toBe(false);
    expect(conversationCandidateBoundary.onFailure).toBe("skip");
  });

  it("keys a cassette over exactly what was sent, strategy included", () => {
    const key = conversationCandidateBoundary.cassetteKey(INPUT);
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conversationCandidateBoundary.cassetteKey(INPUT)).toBe(key);
    expect(conversationCandidateBoundary.cassetteKey({ ...INPUT, strategy: "rigorous" })).not.toBe(key);
  });

  it("can never produce a prompt version: it has no action to write one under (WS-R2)", () => {
    expect(Object.keys(CandidateInputSchema.shape)).not.toContain("action");
  });
});

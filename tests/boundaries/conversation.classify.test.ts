/**
 * `conversation.classify` — FORGE's first judgment boundary (WS-R1, WS-R3,
 * WS-R5, AD-22).
 *
 * There is no deterministic check that a label is *correct*, so what is tested
 * here is everything that IS deterministic: the closed action set, prompt
 * determinism, the cassette key, and the post-validators that refuse an action
 * the conversation state cannot express. The label's correctness is the
 * classifier corpus's job (tests/product/turn-pipeline.test.ts), not this
 * file's.
 */
import { describe, expect, it } from "vitest";

import { CONVERSATION_ACTIONS } from "../../src/conversation/actions.js";
import {
  CONVERSATION_CLASSIFY_ID,
  CONVERSATION_CLASSIFY_VERSION,
  ClassifyInputSchema,
  ClassifyOutputSchema,
  classifyValidators,
  conversationClassifyBoundary,
  parseClassifyOutput,
  renderClassifyPrompt,
} from "../../src/conversation/classify.js";

const STATE = {
  hasCurrentPrompt: true,
  versions: [1, 2],
  candidateCount: 0,
  hasPendingClarification: false,
};

const input = (over: Partial<typeof STATE> = {}, message = "Make it stricter.") => ({
  message,
  state: { ...STATE, ...over },
});

describe("input and output contract", () => {
  it("accepts only the ten closed actions (WS-R1)", () => {
    for (const action of CONVERSATION_ACTIONS) {
      expect(ClassifyOutputSchema.safeParse({ action, versions: [] }).success).toBe(true);
    }
    expect(ClassifyOutputSchema.safeParse({ action: "DELETE", versions: [] }).success).toBe(false);
  });

  it("rejects an empty message rather than classifying nothing", () => {
    expect(ClassifyInputSchema.safeParse(input({}, "   ")).success).toBe(false);
  });

  it("parses a model answer wrapped in prose or fences", () => {
    const parsed = parseClassifyOutput('Sure!\n```json\n{"action":"REVISE","versions":[]}\n```');
    expect(parsed.action).toBe("REVISE");
  });

  it("throws rather than guessing when the answer is not a known action", () => {
    expect(() => parseClassifyOutput('{"action":"REWRITE"}')).toThrow();
    expect(() => parseClassifyOutput("no json here")).toThrow();
  });

  it("defaults the cited version list to empty", () => {
    expect(parseClassifyOutput('{"action":"DISCUSS"}').versions).toEqual([]);
  });
});

describe("prompt and cassette key", () => {
  it("renders the same prompt for the same input", () => {
    expect(renderClassifyPrompt(input())).toBe(renderClassifyPrompt(input()));
  });

  it("names every action it is allowed to choose", () => {
    const prompt = renderClassifyPrompt(input());
    for (const action of CONVERSATION_ACTIONS) expect(prompt).toContain(action);
  });

  it("tells the model what the state can express, so it does not propose the impossible", () => {
    const prompt = renderClassifyPrompt(input({ hasPendingClarification: true }));
    expect(prompt).toContain("pending question");
  });

  it("keys the cassette on boundary identity plus the rendered prompt", () => {
    const key = conversationClassifyBoundary.cassetteKey(input());
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(conversationClassifyBoundary.cassetteKey(input({}, "Different message."))).not.toBe(key);
  });

  it("is registered under a stable id and version", () => {
    expect(conversationClassifyBoundary.id).toBe(CONVERSATION_CLASSIFY_ID);
    expect(conversationClassifyBoundary.version).toBe(CONVERSATION_CLASSIFY_VERSION);
  });
});

describe("post-validators refuse what the state cannot express (WS-R5)", () => {
  const problems = (over: Partial<typeof STATE>, output: { action: string; versions?: number[] }) =>
    conversationClassifyBoundary.postValidators.flatMap((v) =>
      v(input(over) as never, { versions: [], ...output } as never),
    );

  it("refuses COMPARE with fewer than two addressable artifacts", () => {
    expect(problems({ versions: [1], candidateCount: 0 }, { action: "COMPARE" })).not.toEqual([]);
    expect(problems({ versions: [1], candidateCount: 1 }, { action: "COMPARE" })).toEqual([]);
  });

  it("refuses MERGE with fewer than two addressable artifacts", () => {
    expect(problems({ versions: [1], candidateCount: 0 }, { action: "MERGE" })).not.toEqual([]);
  });

  it("refuses RESTORE of a version that does not exist", () => {
    expect(problems({ versions: [1, 2] }, { action: "RESTORE", versions: [7] })).not.toEqual([]);
    expect(problems({ versions: [1, 2] }, { action: "RESTORE", versions: [1] })).toEqual([]);
  });

  it("refuses RESTORE that cites no version at all", () => {
    expect(problems({ versions: [1, 2] }, { action: "RESTORE", versions: [] })).not.toEqual([]);
  });

  it("refuses CLARIFY with no pending question", () => {
    expect(problems({ hasPendingClarification: false }, { action: "CLARIFY" })).not.toEqual([]);
    expect(problems({ hasPendingClarification: true }, { action: "CLARIFY" })).toEqual([]);
  });

  it("refuses REVISE when there is no prompt to revise", () => {
    expect(problems({ hasCurrentPrompt: false, versions: [] }, { action: "REVISE" })).not.toEqual([]);
  });

  it("accepts DISCUSS in every state — it is always expressible (WS-R4)", () => {
    expect(problems({ hasCurrentPrompt: false, versions: [], candidateCount: 0 }, { action: "DISCUSS" })).toEqual([]);
  });

  it("refuses a cited version that is not in the conversation, whatever the action", () => {
    expect(
      classifyValidators.citedVersionsExist(input({ versions: [1] }) as never, {
        action: "COMPARE",
        versions: [1, 9],
      } as never),
    ).not.toEqual([]);
  });
});

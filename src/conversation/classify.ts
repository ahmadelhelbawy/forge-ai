/**
 * The `conversation.classify` model boundary (WS-R1, WS-R3, WS-R5, AD-22).
 *
 * FORGE's first JUDGMENT boundary. There is no deterministic check that a
 * label is correct — only that it parses, which Zod already does. So the
 * validation here is moved off the label and onto two things that ARE
 * deterministic:
 *
 *   1. the action must be one the conversation state can express (WS-R5), and
 *   2. any version it cites must exist.
 *
 * The action → effect check of WS-R3 lives with the effect, in
 * `conversation.generate` and in the turn pipeline's write guard. A label is
 * a proposal; a version write is damage.
 *
 * The prompt is an inline template rather than a sidecar `.md`: it is short,
 * and a second file would need the build's copy step, which is a build change
 * for no reading benefit. `renderClassifyPrompt` is pure, so the cassette key
 * is stable for the same input.
 */
import { z } from "zod";

import {
  CONVERSATION_ACTIONS,
  type ConversationAction,
} from "./actions.js";
import { jsonObjects } from "./discovery.js";
import { cassetteKey } from "../model/cassette.js";
import type { ModelBoundary } from "../model/boundaries.js";

export const CONVERSATION_CLASSIFY_ID = "conversation.classify";
export const CONVERSATION_CLASSIFY_VERSION = "2";
/**
 * Raised from 200 in Product Sprint 1. A reasoning model can spend a 200-token
 * cap before it emits any answer, which surfaced in the running app as
 * "classifier returned no JSON". The answer itself is ~30 tokens; the headroom
 * is for the model, not for the output.
 */
export const CONVERSATION_CLASSIFY_MAX_TOKENS = 1024;

/** What the conversation can currently express. Facts, never model output. */
export const ConversationStateSchema = z.strictObject({
  hasCurrentPrompt: z.boolean(),
  /** Every version number that exists, ascending. */
  versions: z.array(z.number().int().positive()),
  candidateCount: z.number().int().min(0),
  hasPendingClarification: z.boolean(),
  /** WS-R31: discovery is open, so no classified action will write a version. */
  discoveryOpen: z.boolean().optional(),
});
export type ConversationStateSummary = z.infer<typeof ConversationStateSchema>;

export const ClassifyInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(20000),
  state: ConversationStateSchema,
});
export type ClassifyInput = z.infer<typeof ClassifyInputSchema>;

export const ClassifyOutputSchema = z.strictObject({
  action: z.enum(CONVERSATION_ACTIONS),
  /** Versions cited by RESTORE, COMPARE or MERGE. Empty for everything else. */
  versions: z.array(z.number().int().positive()).default([]),
});
export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;

/** The model answered with something that is not a classification. */
export class ClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassificationError";
  }
}

const ACTION_GUIDE: ReadonlyArray<readonly [ConversationAction, string]> = [
  ["DISCUSS", "the user is talking, asking, or thinking out loud; nothing about the prompt changes"],
  [
    "DISCOVER",
    "the user's goal is incomplete, ambiguous, exploratory or strategic — they do not yet know exactly what they want built — so FORGE should ask questions and help them think, not write a prompt",
  ],
  ["CREATE", "produce the first prompt, or a deliberately fresh one"],
  ["REVISE", "change the existing prompt while preserving everything not asked about"],
  ["CRITIQUE", "review the prompt and report weaknesses; change nothing"],
  ["EXPLAIN", "explain the prompt, or a choice made in it; change nothing"],
  ["COMPARE", "compare two existing artifacts; change nothing"],
  ["MERGE", "combine two existing artifacts into a new version"],
  ["RESTORE", "make an earlier version current again"],
  ["ANALYZE", "inspect the prompt's structure; change nothing"],
  ["CLARIFY", "the user is answering FORGE's outstanding question"],
];

/** Pure: same input → same prompt → same cassette key. */
export function renderClassifyPrompt(input: ClassifyInput): string {
  const state = input.state;
  const lines = [
    "Classify the user's message into exactly one FORGE conversation action.",
    "Answer with one JSON object and nothing else: {\"action\": \"<ACTION>\", \"versions\": [<numbers>]}",
    "",
    "ACTIONS:",
    ...ACTION_GUIDE.map(([action, meaning]) => `- ${action}: ${meaning}`),
    "",
    "RULES:",
    "- Only CREATE, REVISE, MERGE and RESTORE change the prompt. If the message only asks something, it is not one of those.",
    "- RESTORE cites exactly one existing version in `versions`. COMPARE and MERGE cite the two artifacts they address.",
    "- Choose CREATE only when the user has described a concrete enough task to write a good prompt for. When the goal itself is still unclear, choose DISCOVER.",
    "- Never choose an action this conversation's state cannot express. When unsure, choose DISCUSS.",
    "",
    "CONVERSATION STATE:",
    `- current prompt: ${state.hasCurrentPrompt ? "yes" : "none yet"}`,
    `- existing versions: ${state.versions.length > 0 ? state.versions.join(", ") : "none"}`,
    `- alternative candidates: ${state.candidateCount}`,
    `- pending question from FORGE awaiting an answer: ${state.hasPendingClarification ? "yes" : "no"}`,
    `- discovery in progress (FORGE is still working out what the user wants): ${state.discoveryOpen ? "yes" : "no"}`,
    "",
    "USER MESSAGE:",
    input.message,
  ];
  return lines.join("\n");
}

/**
 * Pull the classification out of model chatter (WS-R34). Every JSON object in
 * the text is tried against the schema, in order, and the first that validates
 * wins; code fences and surrounding prose are tolerated because they wrap the
 * answer rather than change it. Nothing is reinterpreted: a bare word, a
 * near-miss label or a misspelt action is a failure, never a guess.
 */
export function parseClassifyOutput(text: string): ClassifyOutput {
  const objects = jsonObjects(text);
  if (objects.length === 0) {
    throw new ClassificationError(
      text.trim().length === 0
        ? "The classifier returned an empty response."
        : "The classifier response contained no JSON object.",
    );
  }
  let firstIssue: string | null = null;
  for (const payload of objects) {
    const parsed = ClassifyOutputSchema.safeParse(payload);
    if (parsed.success) return parsed.data;
    firstIssue ??= parsed.error.issues[0]?.message ?? "invalid";
  }
  throw new ClassificationError(
    `The classifier did not answer with one of the ${CONVERSATION_ACTIONS.length} conversation actions: ${firstIssue}.`,
  );
}

/**
 * The single bounded repair (WS-R34): the original task, the error, and the
 * exact shape required. Pure, so a repair is as replayable as the first call.
 */
export function renderClassifyRepairPrompt(input: ClassifyInput, error: string): string {
  return [
    renderClassifyPrompt(input),
    "",
    `YOUR PREVIOUS ANSWER WAS REJECTED: ${error}`,
    `Answer again with exactly one JSON object and nothing else, for example {"action": "DISCUSS", "versions": []}.`,
    `"action" must be one of: ${CONVERSATION_ACTIONS.join(", ")}.`,
  ].join("\n");
}

/**
 * WS-R5, as a pure function so the boundary, the pipeline and the tests all
 * consult the same rule. Empty means the state can express the action.
 */
export function actionSupportProblems(
  action: ConversationAction,
  state: ConversationStateSummary,
  cited: readonly number[],
): readonly string[] {
  // A version is addressable (RESTORE cites one), and so is a candidate. Two
  // versions are two artifacts to compare — that is the existing diff view.
  const addressable = state.versions.length + state.candidateCount;
  switch (action) {
    case "COMPARE":
    case "MERGE":
      return addressable >= 2
        ? []
        : [`${action} needs two addressable artifacts; this conversation has ${addressable}.`];
    case "RESTORE":
      if (cited.length !== 1) return ["RESTORE must cite exactly one version to restore."];
      return state.versions.includes(cited[0] as number)
        ? []
        : [`RESTORE cites version ${cited[0]}, which this conversation does not have.`];
    case "CLARIFY":
      return state.hasPendingClarification
        ? []
        : ["CLARIFY needs a question from FORGE that is still awaiting an answer."];
    case "REVISE":
      return state.hasCurrentPrompt ? [] : ["REVISE needs an existing prompt to revise."];
    default:
      return [];
  }
}

export const classifyValidators = {
  citedVersionsExist(input: ClassifyInput, output: ClassifyOutput): readonly string[] {
    const missing = output.versions.filter((v) => !input.state.versions.includes(v));
    return missing.length === 0 ? [] : [`Cited versions do not exist: ${missing.join(", ")}.`];
  },
  stateSupportsAction(input: ClassifyInput, output: ClassifyOutput): readonly string[] {
    return actionSupportProblems(output.action, input.state, output.versions);
  },
} as const;

export const conversationClassifyBoundary: ModelBoundary<ClassifyInput, ClassifyOutput> = {
  id: CONVERSATION_CLASSIFY_ID,
  version: CONVERSATION_CLASSIFY_VERSION,
  inputSchema: ClassifyInputSchema,
  outputSchema: ClassifyOutputSchema,
  postValidators: [classifyValidators.citedVersionsExist, classifyValidators.stateSupportsAction],
  cassetteKey: (input) =>
    cassetteKey(CONVERSATION_CLASSIFY_ID, CONVERSATION_CLASSIFY_VERSION, renderClassifyPrompt(input)),
  // WS-R4: a classification that cannot be made is not a lost turn. The
  // pipeline degrades to DISCUSS and says so, which is why this is skippable
  // and why it is never "guess".
  required: false,
  onFailure: "skip",
};

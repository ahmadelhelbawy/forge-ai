/**
 * The closed conversation-action set (WS-R1, WS-R2).
 *
 * It lives in the core, not the workspace, because the `conversation.classify`
 * boundary and the turn runtime must agree on exactly one list. Two copies of
 * a closed set is how a set stops being closed.
 *
 * WS-R2 is expressed here as data: four actions may write a prompt version and
 * six may not. `writesVersion` is the single place that distinction is made.
 */

export const CONVERSATION_ACTIONS = [
  "DISCUSS",
  "CREATE",
  "REVISE",
  "CRITIQUE",
  "EXPLAIN",
  "COMPARE",
  "MERGE",
  "RESTORE",
  "ANALYZE",
  "CLARIFY",
] as const;

export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];

/** WS-R2: the only actions permitted to produce a new prompt version. */
export const VERSION_WRITING_ACTIONS = ["CREATE", "REVISE", "MERGE", "RESTORE"] as const;

export type VersionWritingAction = (typeof VERSION_WRITING_ACTIONS)[number];

/** WS-R2: the read-only six. A message that only asks a question lands here. */
export const READ_ONLY_ACTIONS = CONVERSATION_ACTIONS.filter(
  (action): action is Exclude<ConversationAction, VersionWritingAction> =>
    !(VERSION_WRITING_ACTIONS as readonly string[]).includes(action),
);

/** WS-R4: the least destructive action, and the only safe degradation target. */
export const DEFAULT_ACTION: ConversationAction = "DISCUSS";

export function isConversationAction(value: unknown): value is ConversationAction {
  return typeof value === "string" && (CONVERSATION_ACTIONS as readonly string[]).includes(value);
}

export function writesVersion(action: ConversationAction): action is VersionWritingAction {
  return (VERSION_WRITING_ACTIONS as readonly string[]).includes(action);
}

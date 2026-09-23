/**
 * The typed turn-event log (WS-R10, WS-R11, AD-17).
 *
 * One mechanism, not two: this is the stream the pipeline emits, the object
 * the UI renders, and the record persistence appends. There is deliberately no
 * event kind that can carry model reasoning — WS-R11 is enforced by the shape
 * of the union, not by a convention someone has to remember.
 *
 * AD-17 makes this log the checkpointer, which is why it is append-only and
 * why every event carries a sequence number assigned by the store.
 */
import type { ConversationAction } from "forge/dist/conversation/actions.js";
import type { Diagnostic } from "forge/dist/ir/diagnostic.js";

/**
 * Named, user-meaningful stages. Never a spinner, never chain-of-thought.
 *
 * A stage says what FORGE is doing in terms the user recognises from their own
 * request. It is deliberately a small closed set: a stage nobody can act on is
 * noise, and a stage derived from model output would be WS-R11's exact failure.
 */
export const TURN_STAGES = [
  "classifying",
  "reading_prompt",
  "adapting",
  "generating",
  "verifying",
  "saving",
] as const;

export type TurnStage = (typeof TURN_STAGES)[number];

export interface TurnEventBase {
  /** 1-based, assigned on append. Gaps or reuse mean the log was rewritten. */
  readonly seq: number;
  readonly turnId: string;
  readonly at: string;
}

export type TurnEventBody =
  | {
      readonly kind: "turn_started";
      readonly message?: string;
      /** True when this turn re-ran an earlier one's message (V2-B retry). */
      readonly regenerated?: boolean;
    }
  | { readonly kind: "stage"; readonly stage: TurnStage; readonly label: string }
  | {
      readonly kind: "action_resolved";
      readonly action: ConversationAction;
      /** True when classification failed or was skipped and WS-R4 applied. */
      readonly degraded: boolean;
      /** WS-R31: the user named the action with the generate control; no classification ran. */
      readonly explicit?: boolean;
      /** WS-R31: what the classifier said before the discovery gate changed it. */
      readonly gatedFrom?: ConversationAction;
    }
  | { readonly kind: "diagnostic"; readonly diagnostic: Diagnostic }
  | { readonly kind: "action_refused"; readonly action: ConversationAction; readonly reason: string }
  | { readonly kind: "current_version_moved"; readonly v: number }
  | {
      readonly kind: "model_call";
      readonly boundaryId: string;
      readonly model: string;
      readonly latencyMs: number;
      /** WS-R34: this call repaired the previous one's structured output. */
      readonly repair?: boolean;
      /** WS-R43: the reasoning effort sent with the call, when one was. */
      readonly reasoningEffort?: string;
    }
  | {
      /**
       * WS-R14: a call that was made and failed before any output arrived. It
       * has no output to hash, so it is not a ModelCallRecord — but the log
       * must still account for it, or a degraded turn looks like it spent
       * nothing.
       */
      readonly kind: "model_call_failed";
      readonly boundaryId: string;
      readonly reason: string;
    }
  | { readonly kind: "message_appended"; readonly role: "user" | "assistant" }
  | { readonly kind: "version_created"; readonly v: number; readonly action: ConversationAction }
  | {
      /**
       * Layer 1 ran (WS-R25, WS-R29). Counts only — the diagnostics that name
       * the dropped requirements travel as `diagnostic` events, so there is
       * one shape for a finding rather than two.
       */
      readonly kind: "preservation_checked";
      readonly v: number;
      readonly pinned: number;
      readonly missing: number;
    }
  | {
      /** WS-R30: the discovery state changed. Counts only; the state itself is on the conversation. */
      readonly kind: "discovery_updated";
      readonly status: "open" | "generated";
      readonly questions: number;
      readonly ready: boolean;
    }
  | { readonly kind: "clarification_pending"; readonly question: string }
  | { readonly kind: "clarification_resolved"; readonly question: string }
  | {
      readonly kind: "turn_completed";
      readonly action: ConversationAction;
      readonly versionCreated: boolean;
    }
  | { readonly kind: "turn_failed"; readonly reason: string }
  | { readonly kind: "turn_cancelled" };

export type TurnEvent = TurnEventBase & TurnEventBody;

/**
 * Streamed text, and the one thing in V2-B that is NOT in the log (WS-R10).
 *
 * The log is the audit record, and a record of every token is a record of
 * nothing: it would multiply each turn's events by a thousand, say no more
 * than the final text already says, and make AC-036's byte-comparison depend
 * on network chunking. So a delta travels on the same stream as the events —
 * one mechanism the UI reads — and is never appended.
 *
 * `field` can only name the two envelope fields, which is how WS-R11 holds:
 * there is no delta shape that could carry reasoning.
 */
export interface TurnDelta {
  readonly kind: "reply_delta" | "prompt_delta";
  readonly turnId: string;
  readonly text: string;
}

/** What the pipeline yields: persisted events plus transient text. */
export type TurnStreamItem = TurnEvent | TurnDelta;

export function isTurnDelta(item: TurnStreamItem): item is TurnDelta {
  return item.kind === "reply_delta" || item.kind === "prompt_delta";
}

/** What a caller supplies; the store owns `seq` and `at`. */
export type TurnEventInput = { readonly turnId: string } & TurnEventBody;

export const TURN_EVENT_KINDS = [
  "turn_started",
  "stage",
  "action_resolved",
  "diagnostic",
  "action_refused",
  "current_version_moved",
  "model_call",
  "model_call_failed",
  "message_appended",
  "version_created",
  "preservation_checked",
  "clarification_pending",
  "clarification_resolved",
  "turn_completed",
  "turn_failed",
  "turn_cancelled",
] as const;

export function isTurnEvent(value: unknown): value is TurnEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event["seq"] === "number" &&
    typeof event["turnId"] === "string" &&
    typeof event["at"] === "string" &&
    typeof event["kind"] === "string" &&
    (TURN_EVENT_KINDS as readonly string[]).includes(event["kind"] as string)
  );
}

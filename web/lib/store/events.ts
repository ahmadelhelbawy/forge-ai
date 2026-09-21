/**
 * The conversation run-event vocabulary (WS-R17).
 *
 * Truth is these events plus the objects they reference. A conversation is
 * not stored; it is **folded** from its events, which is what makes the
 * SQLite index derivable rather than authoritative (PS-R3, AD-20).
 *
 * Every event is append-only and every collection it feeds grows at the end,
 * so persisting a turn is a matter of writing down what was added — never of
 * rewriting a record. That is WS-R7 ("immutable once written") expressed in
 * the storage layer rather than merely asserted in the type.
 *
 * Large text never appears here. Message bodies, prompt version text,
 * candidate text and attachment payloads are stored as objects and referenced
 * by hash — WS-R18 for attachments, and the same reasoning for the rest: a
 * log line should stay readable, and identical content should be stored once.
 */
import type { ConversationAction } from "forge/dist/conversation/actions.js";
import type { ModelCallRecord } from "forge/dist/model/provider.js";

import type { TurnEvent } from "../turn/events";

export type ConversationEventBody =
  | {
      readonly kind: "conversation_created";
      readonly id: string;
      readonly title: string;
      readonly target: string;
      readonly provider: string;
      readonly model: string;
    }
  | { readonly kind: "conversation_deleted"; readonly id: string }
  | { readonly kind: "title_changed"; readonly id: string; readonly title: string }
  | {
      readonly kind: "settings_changed";
      readonly id: string;
      readonly target?: string;
      readonly provider?: string;
      readonly model?: string;
    }
  | {
      readonly kind: "message_appended";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly contentHash: string;
      readonly messageAt: string;
    }
  | { readonly kind: "messages_truncated"; readonly id: string; readonly keep: number }
  | {
      readonly kind: "prompt_version_written";
      readonly id: string;
      readonly v: number;
      readonly textHash: string;
      readonly source: "model" | "manual" | "import" | "restore" | "merge";
      readonly action?: ConversationAction;
      readonly turnId?: string;
      readonly versionAt: string;
    }
  | { readonly kind: "current_version_moved"; readonly id: string; readonly v: number }
  | {
      readonly kind: "candidate_added";
      readonly id: string;
      readonly candidateId: string;
      readonly label: string;
      readonly textHash: string;
      readonly fromVersion: number | null;
      readonly strategy?: string;
      readonly origin: "archetype";
      readonly rationale?: string;
      readonly score?: number;
      readonly candidateAt: string;
    }
  | {
      readonly kind: "candidate_promoted";
      readonly id: string;
      readonly v: number;
      readonly promotion: "select" | "merge";
      readonly candidateIds: readonly string[];
      readonly promotedAt: string;
    }
  | {
      readonly kind: "attachment_added";
      readonly id: string;
      readonly name: string;
      readonly size: number;
      readonly truncated: boolean;
      readonly contentHash: string;
      readonly attachmentAt: string;
      /**
       * Trust tier and redaction record, assigned at upload (V2-R step 10).
       *
       * Optional because the log is append-only and events written before
       * V2-R carry neither. A replay of one of those must not invent a tier:
       * the fold falls back to `semi_trusted`, which is the tier every
       * attachment has ever had under SC-R2 — recording it, not changing it.
       */
      readonly trust?: string;
      readonly redactions?: ReadonlyArray<{ readonly rule: string; readonly count: number }>;
    }
  | {
      readonly kind: "clarification_set";
      readonly id: string;
      readonly clarificationId: string;
      readonly question: string;
      readonly options: readonly string[];
      readonly askedInTurn: string;
      readonly clarificationAt: string;
    }
  | { readonly kind: "clarification_resolved"; readonly id: string; readonly answer: string; readonly turnId: string }
  | {
      readonly kind: "requirement_pinned";
      readonly id: string;
      readonly entryId: string;
      readonly textHash: string;
      readonly origin: "user_input";
      readonly pinnedFromVersion: number | null;
      readonly pinnedAt: string;
    }
  | { readonly kind: "requirement_unpinned"; readonly id: string; readonly entryId: string }
  | {
      readonly kind: "version_ir_extracted";
      readonly id: string;
      readonly v: number;
      readonly irHash: string;
      readonly boundaryId: string;
      readonly boundaryVersion: string;
      readonly extractedAt: string;
    }
  | { readonly kind: "turn_event"; readonly id: string; readonly event: TurnEvent }
  | { readonly kind: "model_call"; readonly id: string; readonly record: ModelCallRecord };

export type ConversationEventKind = ConversationEventBody["kind"];

export const CONVERSATION_EVENT_KINDS: readonly ConversationEventKind[] = [
  "conversation_created",
  "conversation_deleted",
  "title_changed",
  "settings_changed",
  "message_appended",
  "messages_truncated",
  "prompt_version_written",
  "current_version_moved",
  "candidate_added",
  "candidate_promoted",
  "attachment_added",
  "clarification_set",
  "clarification_resolved",
  "requirement_pinned",
  "requirement_unpinned",
  "version_ir_extracted",
  "turn_event",
  "model_call",
];

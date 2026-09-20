/**
 * The conversation repository over objects + the append-only log (WS-R17).
 *
 * The shape of this module is set by one decision: **a conversation is not a
 * record that gets rewritten, it is a fold over its events.** Loading replays
 * the log; saving writes down what was added since the load. Nothing here can
 * rewrite an event or a version, which is WS-R7 enforced by the storage layer
 * rather than promised by a type.
 *
 * Every collection on a `Conversation` grows only at the end, so the delta a
 * save must write is found by comparing lengths against the baseline the load
 * recorded. The one exception is V2-B's regenerate, which drops trailing
 * assistant messages — that is recorded as an explicit `messages_truncated`
 * event, because an append-only log has no silent shrink.
 *
 * Large text lives in objects, not in the log: message bodies, version text,
 * candidate text, and attachment payloads (WS-R18). Identical content is
 * therefore stored once, which is also why a regenerated identical answer
 * costs nothing.
 *
 * The baseline lives in a `WeakMap`, not on the object, so it never reaches
 * JSON, the browser, or `semanticSnapshot`.
 */
import { openObjectStore, type ObjectStore } from "forge/dist/store/objects.js";
import { openRunLog, type RunEvent, type RunLog } from "forge/dist/store/runlog.js";
import { openIndex, type StoreIndex } from "forge/dist/store/index-store.js";

import { conversationProjector } from "./projector";
import type { ConversationEventBody } from "./events";
import type {
  AttachmentMeta,
  ChatMessage,
  Conversation,
  ConversationSummary,
  PendingClarification,
  PinnedRequirement,
  PromptCandidate,
  PromptVersion,
  VersionIr,
} from "../store-types";

export interface Store {
  readonly root: string;
  readonly objects: ObjectStore;
  readonly log: RunLog;
}

interface Baseline {
  /**
   * The message objects as they stood at load.
   *
   * A count is not enough. V2-B's regenerate drops the trailing assistant
   * message and appends a new one, leaving the length unchanged while the
   * tail differs — a length diff would record the replacement as nothing at
   * all and the retry would vanish from the log. Message records are created
   * once and never mutated, so reference equality of the retained prefix is
   * an exact test for "where did this diverge".
   */
  readonly messageRefs: readonly ChatMessage[];
  readonly messages: number;
  readonly versions: number;
  readonly candidates: number;
  readonly candidatePromotions: number;
  readonly attachments: number;
  readonly turnEvents: number;
  readonly modelCalls: number;
  /**
   * Ledger ids at load.
   *
   * A count would not do: unpinning removes an entry, so the ledger is the one
   * collection on a conversation that can shrink as well as grow, and the
   * delta a save must write is a set difference rather than a tail.
   */
  readonly ledgerIds: readonly string[];
  readonly versionIrs: number;
  readonly currentV: number;
  readonly title: string;
  readonly target: string;
  readonly provider: string;
  readonly model: string;
  readonly clarificationId: string | null;
  readonly existed: boolean;
}

const baselines = new WeakMap<Conversation, Baseline>();

/** The baseline for a conversation the store has never seen. */
function emptyBaseline(convo: Conversation): Baseline {
  return {
    ...baselineOf(convo, false),
    messageRefs: [],
    messages: 0,
    versions: 0,
    candidates: 0,
    candidatePromotions: 0,
    attachments: 0,
    turnEvents: 0,
    modelCalls: 0,
    ledgerIds: [],
    versionIrs: 0,
    currentV: 0,
    title: "",
    target: "",
    provider: "",
    model: "",
    clarificationId: null,
  };
}

function baselineOf(convo: Conversation, existed: boolean): Baseline {
  return {
    messageRefs: [...convo.messages],
    messages: convo.messages.length,
    versions: convo.promptVersions.length,
    candidates: convo.candidates.length,
    candidatePromotions: convo.candidatePromotions.length,
    attachments: convo.attachments.length,
    turnEvents: convo.turnEvents.length,
    modelCalls: convo.modelCalls.length,
    ledgerIds: convo.ledger.map((e) => e.id),
    versionIrs: convo.versionIrs.length,
    currentV: convo.currentV,
    title: convo.title,
    target: convo.target,
    provider: convo.provider,
    model: convo.model,
    clarificationId: convo.pendingClarification?.id ?? null,
    existed,
  };
}

export function openStore(root: string): Store {
  return { root, objects: openObjectStore(root), log: openRunLog(root) };
}

/** A fresh index, rebuilt from the log (AD-20). Caller closes it. */
export function openStoreIndex(store: Store): StoreIndex {
  return openIndex(store.root, conversationProjector, store.log);
}

function text(store: Store, hash: string): string {
  const value = store.objects.get(hash);
  if (typeof value !== "string") {
    throw new Error(`Object ${hash} should hold text but holds ${value === null ? "nothing" : typeof value}.`);
  }
  return value;
}

/** An empty shell the fold fills. Never persisted in this state. */
function shell(id: string, at: string): Conversation {
  return {
    id,
    title: "New conversation",
    createdAt: at,
    updatedAt: at,
    target: "generic",
    provider: "",
    model: "",
    messages: [],
    attachmentContents: {},
    attachments: [],
    promptVersions: [],
    currentV: 0,
    candidates: [],
    candidatePromotions: [],
    pendingClarification: null,
    ledger: [],
    versionIrs: [],
    turnEvents: [],
    modelCalls: [],
  };
}

/**
 * Fold one conversation out of the log.
 *
 * Attachment and message text is resolved lazily-but-eagerly here: the
 * workspace hands whole conversations to the turn pipeline, so pretending the
 * text is not needed would only move the read. The objects are shared, so
 * this is a read of content that exists exactly once on disk.
 */
function foldOne(store: Store, id: string, events: readonly RunEvent[]): Conversation | null {
  let convo: Conversation | null = null;
  let deleted = false;

  for (const event of events) {
    if (event["id"] !== id) continue;
    const body = event as unknown as ConversationEventBody & RunEvent;

    switch (body.kind) {
      case "conversation_created":
        convo = shell(id, event.at);
        convo.title = body.title;
        convo.target = body.target;
        convo.provider = body.provider;
        convo.model = body.model;
        deleted = false;
        break;
      case "conversation_deleted":
        deleted = true;
        break;
      default:
        break;
    }
    if (convo === null) continue;

    switch (body.kind) {
      case "title_changed":
        convo.title = body.title;
        break;
      case "settings_changed":
        if (typeof body.target === "string") convo.target = body.target;
        if (typeof body.provider === "string") convo.provider = body.provider;
        if (typeof body.model === "string") convo.model = body.model;
        break;
      case "message_appended":
        convo.messages.push({ role: body.role, content: text(store, body.contentHash), at: body.messageAt });
        break;
      case "messages_truncated":
        convo.messages.length = Math.min(convo.messages.length, body.keep);
        break;
      case "prompt_version_written":
        convo.promptVersions.push(
          Object.freeze({
            v: body.v,
            text: text(store, body.textHash),
            source: body.source,
            at: body.versionAt,
            ...(body.action ? { action: body.action } : {}),
            ...(body.turnId ? { turnId: body.turnId } : {}),
          }),
        );
        convo.currentV = body.v;
        break;
      case "current_version_moved":
        convo.currentV = body.v;
        break;
      case "candidate_added":
        convo.candidates.push(
          Object.freeze({
            id: body.candidateId,
            label: body.label,
            text: text(store, body.textHash),
            fromVersion: body.fromVersion,
            ...(body.strategy ? { strategy: body.strategy } : {}),
            // Pre-V2-E records carry no origin. ST-R7's only v0.1 value is the
            // honest reading of them: they came from the archetype set.
            origin: body.origin ?? "archetype",
            ...(body.rationale ? { rationale: body.rationale } : {}),
            ...(typeof body.score === "number" ? { score: body.score } : {}),
            at: body.candidateAt,
          }),
        );
        break;
      case "candidate_promoted":
        convo.candidatePromotions.push(
          Object.freeze({
            v: body.v,
            promotion: body.promotion,
            candidateIds: Object.freeze([...body.candidateIds]),
            at: body.promotedAt,
          }),
        );
        break;
      case "attachment_added":
        convo.attachments.push({
          name: body.name,
          size: body.size,
          truncated: body.truncated,
          at: body.attachmentAt,
        });
        convo.attachmentContents[body.name] = text(store, body.contentHash);
        break;
      case "clarification_set":
        convo.pendingClarification = Object.freeze({
          id: body.clarificationId,
          question: body.question,
          options: Object.freeze([...body.options]),
          askedInTurn: body.askedInTurn,
          at: body.clarificationAt,
        });
        break;
      case "clarification_resolved":
        convo.pendingClarification = null;
        break;
      case "requirement_pinned":
        convo.ledger.push(
          Object.freeze({
            id: body.entryId,
            text: text(store, body.textHash),
            contentHash: body.textHash,
            origin: body.origin,
            pinnedFromVersion: body.pinnedFromVersion,
            at: body.pinnedAt,
          }),
        );
        break;
      case "requirement_unpinned": {
        // The entry leaves the active ledger; the event that pinned it stays
        // in the log. That is what "append-only" costs and buys (WS-R17).
        const at = convo.ledger.findIndex((e) => e.id === body.entryId);
        if (at !== -1) convo.ledger.splice(at, 1);
        break;
      }
      case "version_ir_extracted":
        convo.versionIrs.push(
          Object.freeze({
            v: body.v,
            irHash: body.irHash,
            boundaryId: body.boundaryId,
            boundaryVersion: body.boundaryVersion,
            at: body.extractedAt,
          }),
        );
        break;
      case "turn_event":
        convo.turnEvents.push(Object.freeze({ ...body.event }));
        break;
      case "model_call":
        convo.modelCalls.push(Object.freeze({ ...body.record }));
        break;
      default:
        break;
    }
    convo.updatedAt = event.at;
  }

  if (convo === null || deleted) return null;
  baselines.set(convo, baselineOf(convo, true));
  return convo;
}

export function loadConversation(store: Store, id: string): Conversation | null {
  return foldOne(store, id, store.log.readAll());
}

/** Register a conversation the caller built in memory, so `save` creates it. */
export function trackNew(convo: Conversation): Conversation {
  baselines.set(convo, emptyBaseline(convo));
  return convo;
}

/**
 * Append everything that changed since this conversation was loaded.
 *
 * There is no "write the record" path, by design: the only way to change
 * stored state is to append an event describing the change.
 */
export function saveConversation(store: Store, convo: Conversation): void {
  const base = baselines.get(convo) ?? emptyBaseline(convo);
  const emit = (body: ConversationEventBody): void => {
    store.log.append(body as unknown as Record<string, unknown>);
  };

  if (!base.existed) {
    emit({
      kind: "conversation_created",
      id: convo.id,
      title: convo.title,
      target: convo.target,
      provider: convo.provider,
      model: convo.model,
    });
  } else {
    if (convo.title !== base.title) emit({ kind: "title_changed", id: convo.id, title: convo.title });
    if (convo.target !== base.target || convo.provider !== base.provider || convo.model !== base.model) {
      emit({
        kind: "settings_changed",
        id: convo.id,
        ...(convo.target !== base.target ? { target: convo.target } : {}),
        ...(convo.provider !== base.provider ? { provider: convo.provider } : {}),
        ...(convo.model !== base.model ? { model: convo.model } : {}),
      });
    }
  }

  // V2-B regenerate drops trailing assistant messages and may append new ones
  // in their place. Both halves are recorded; neither is ever silent.
  let kept = 0;
  while (kept < base.messageRefs.length && convo.messages[kept] === base.messageRefs[kept]) kept += 1;
  if (kept < base.messageRefs.length) {
    emit({ kind: "messages_truncated", id: convo.id, keep: kept });
  }
  for (const message of convo.messages.slice(kept)) {
    emit({
      kind: "message_appended",
      id: convo.id,
      role: message.role,
      contentHash: store.objects.put(message.content),
      messageAt: message.at,
    });
  }

  for (const version of convo.promptVersions.slice(base.versions)) {
    emit({
      kind: "prompt_version_written",
      id: convo.id,
      v: version.v,
      textHash: store.objects.put(version.text),
      source: version.source,
      ...(version.action ? { action: version.action } : {}),
      ...(version.turnId ? { turnId: version.turnId } : {}),
      versionAt: version.at,
    });
  }

  for (const candidate of convo.candidates.slice(base.candidates)) {
    emit({
      kind: "candidate_added",
      id: convo.id,
      candidateId: candidate.id,
      label: candidate.label,
      textHash: store.objects.put(candidate.text),
      fromVersion: candidate.fromVersion,
      ...(candidate.strategy ? { strategy: candidate.strategy } : {}),
      origin: candidate.origin,
      ...(candidate.rationale ? { rationale: candidate.rationale } : {}),
      ...(typeof candidate.score === "number" ? { score: candidate.score } : {}),
      candidateAt: candidate.at,
    });
  }

  for (const promotion of convo.candidatePromotions.slice(base.candidatePromotions)) {
    emit({
      kind: "candidate_promoted",
      id: convo.id,
      v: promotion.v,
      promotion: promotion.promotion,
      candidateIds: [...promotion.candidateIds],
      promotedAt: promotion.at,
    });
  }

  for (const attachment of convo.attachments.slice(base.attachments)) {
    emit({
      kind: "attachment_added",
      id: convo.id,
      name: attachment.name,
      size: attachment.size,
      truncated: attachment.truncated,
      // WS-R18: the payload is an object, never inlined into the record.
      contentHash: store.objects.put(convo.attachmentContents[attachment.name] ?? ""),
      attachmentAt: attachment.at,
    });
  }

  // The ledger is a set, not a tail: pins added since the load are written,
  // and ids that were there and are gone are written as unpins.
  const baseLedger = new Set(base.ledgerIds);
  const nowLedger = new Set(convo.ledger.map((e) => e.id));
  for (const entry of convo.ledger) {
    if (baseLedger.has(entry.id)) continue;
    emit({
      kind: "requirement_pinned",
      id: convo.id,
      entryId: entry.id,
      textHash: store.objects.put(entry.text),
      origin: entry.origin,
      pinnedFromVersion: entry.pinnedFromVersion,
      pinnedAt: entry.at,
    });
  }
  for (const entryId of base.ledgerIds) {
    if (!nowLedger.has(entryId)) emit({ kind: "requirement_unpinned", id: convo.id, entryId });
  }

  for (const extracted of convo.versionIrs.slice(base.versionIrs)) {
    emit({
      kind: "version_ir_extracted",
      id: convo.id,
      v: extracted.v,
      irHash: extracted.irHash,
      boundaryId: extracted.boundaryId,
      boundaryVersion: extracted.boundaryVersion,
      extractedAt: extracted.at,
    });
  }

  for (const event of convo.turnEvents.slice(base.turnEvents)) {
    emit({ kind: "turn_event", id: convo.id, event });
  }
  for (const record of convo.modelCalls.slice(base.modelCalls)) {
    emit({ kind: "model_call", id: convo.id, record });
  }

  const clarificationId = convo.pendingClarification?.id ?? null;
  if (clarificationId !== base.clarificationId) {
    if (convo.pendingClarification) {
      const pending = convo.pendingClarification;
      emit({
        kind: "clarification_set",
        id: convo.id,
        clarificationId: pending.id,
        question: pending.question,
        options: [...pending.options],
        askedInTurn: pending.askedInTurn,
        clarificationAt: pending.at,
      });
    } else {
      emit({ kind: "clarification_resolved", id: convo.id, answer: "", turnId: "" });
    }
  }

  // A version pointer moved without a new version: RESTORE (WS-R7).
  if (convo.currentV !== base.currentV && convo.promptVersions.length === base.versions) {
    emit({ kind: "current_version_moved", id: convo.id, v: convo.currentV });
  }

  convo.updatedAt = new Date().toISOString();
  baselines.set(convo, baselineOf(convo, true));
}

export function deleteConversation(store: Store, id: string): boolean {
  if (loadConversation(store, id) === null) return false;
  store.log.append({ kind: "conversation_deleted", id } satisfies ConversationEventBody as never);
  return true;
}

/**
 * List conversations from the index (AD-20).
 *
 * This is the query the index exists for: it answers from indexed columns
 * instead of folding every conversation and reading every message object.
 */
export function listConversations(store: Store): ConversationSummary[] {
  const index = openStoreIndex(store);
  try {
    return index
      .query<{
        id: string;
        title: string;
        updated_at: string;
        message_count: number;
        current_v: number;
        version_count: number;
      }>(
        `SELECT id, title, updated_at, message_count, current_v, version_count
           FROM conversation WHERE deleted = 0 ORDER BY updated_at DESC, id ASC`,
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        updatedAt: row.updated_at,
        messageCount: Number(row.message_count),
        currentV: Number(row.current_v),
        hasPrompt: Number(row.version_count) > 0,
      }));
  } finally {
    index.close();
  }
}

export interface StoredVersion extends PromptVersion {
  readonly textHash: string;
}

/** Version history for one conversation, from the index plus objects. */
export function versionHistory(store: Store, id: string): StoredVersion[] {
  const index = openStoreIndex(store);
  try {
    return index
      .query<{ v: number; text_hash: string; source: string; action: string | null; turn_id: string | null; at: string }>(
        `SELECT v, text_hash, source, action, turn_id, at
           FROM prompt_version WHERE conversation_id = ? ORDER BY v ASC`,
        id,
      )
      .map((row) => ({
        v: Number(row.v),
        text: text(store, row.text_hash),
        textHash: row.text_hash,
        source: row.source as PromptVersion["source"],
        at: row.at,
        ...(row.action ? { action: row.action as PromptVersion["action"] } : {}),
        ...(row.turn_id ? { turnId: row.turn_id } : {}),
      }));
  } finally {
    index.close();
  }
}

export type {
  AttachmentMeta,
  ChatMessage,
  Conversation,
  ConversationSummary,
  PendingClarification,
  PinnedRequirement,
  PromptCandidate,
  PromptVersion,
  VersionIr,
};

/**
 * The conversation store (server-only).
 *
 * V2-C moved truth underneath this module without changing what it offers.
 * Callers still load a conversation, mutate it, and save it; what changed is
 * where that lands: **content-addressed objects plus an append-only run log**
 * (WS-R17), with a SQLite index that is rebuilt from them and may be deleted
 * at any time (AD-20, PS-R3, AC-032).
 *
 * The API stayed still on purpose. The turn pipeline, the routes and the
 * V2-A/V2-B test suites are about conversation *semantics*, and a storage
 * change that forced them all to be rewritten would have made it impossible
 * to tell a persistence regression from a churn artefact.
 *
 * `FORGE_DATA_DIR` names the store root; the layout inside it is PS-R1's
 * (`objects/`, `runs/`, `index.sqlite`). A pre-V2-C directory of flat
 * conversation JSON is migrated in on first use — see `store/migrate.ts`.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type { ConversationAction } from "forge/dist/conversation/actions.js";
import {
  checkRequirementLedger,
  ledgerFingerprint,
  type LedgerCheckResult,
  type LedgerEntry,
} from "forge/dist/critic/deterministic/ledger.js";
import { contentHash } from "forge/dist/ir/canonical.js";
import type { ModelCallRecord } from "forge/dist/model/provider.js";

import { migrateFlatFiles } from "./store/migrate";
import {
  loadConversation as repoLoad,
  deleteConversation as repoDelete,
  listConversations as repoList,
  openStore,
  openStoreIndex,
  saveConversation as repoSave,
  trackNew,
  versionHistory as repoVersionHistory,
  type Store,
  type StoredVersion,
} from "./store/repository";
import type {
  AttachmentMeta,
  CandidateOrigin,
  CandidatePromotion,
  ChatMessage,
  Conversation,
  ConversationSummary,
  PendingClarification,
  PinnedRequirement,
  PromptCandidate,
  PromptVersion,
  ResolvedClarification,
  VersionIr,
} from "./store-types";

export type { TurnEvent, TurnEventInput } from "./turn/events";
export type {
  AttachmentMeta,
  CandidateOrigin,
  CandidatePromotion,
  ChatMessage,
  Conversation,
  ConversationSummary,
  PendingClarification,
  PinnedRequirement,
  PromptCandidate,
  PromptVersion,
  ResolvedClarification,
  VersionIr,
} from "./store-types";
export type { StoredVersion } from "./store/repository";

import type { TurnEvent, TurnEventInput } from "./turn/events";

export function dataDir(): string {
  return process.env["FORGE_DATA_DIR"] ?? join(process.cwd(), "data");
}

/**
 * The store for the current data directory.
 *
 * Migration runs once per root per process: a pre-V2-C directory holds flat
 * conversation JSON that must become objects and events before anything can
 * read it, and doing that lazily here means no separate migration step for
 * the user to forget (PS-R4 — the process holds no state the store does not).
 */
const migrated = new Set<string>();

export function store(): Store {
  const root = dataDir();
  const opened = openStore(root);
  if (!migrated.has(root)) {
    migrateFlatFiles(opened);
    migrated.add(root);
  }
  return opened;
}

function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function newConversation(partial: {
  title?: string;
  target?: string;
  provider?: string;
  model?: string;
}): Conversation {
  const now = new Date().toISOString();
  return trackNew({
    id: randomUUID(),
    title: partial.title ?? "New conversation",
    createdAt: now,
    updatedAt: now,
    target: partial.target ?? "generic",
    provider: partial.provider ?? "",
    model: partial.model ?? "",
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
  });
}

export function loadConversation(id: string): Conversation | null {
  if (!isValidId(id)) return null;
  return repoLoad(store(), id);
}

export function saveConversation(convo: Conversation): void {
  repoSave(store(), convo);
}

export function deleteConversation(id: string): boolean {
  if (!isValidId(id)) return false;
  return repoDelete(store(), id);
}

export function listConversations(): ConversationSummary[] {
  return repoList(store());
}

/** Version history with the hash that names each version's text (WS-R7). */
export function versionHistory(id: string): StoredVersion[] {
  if (!isValidId(id)) return [];
  return repoVersionHistory(store(), id);
}

/** The derivable index, for callers that need to query it (AD-20). */
export { openStoreIndex };

export function currentPrompt(convo: Conversation): string | null {
  const found = convo.promptVersions.find((p) => p.v === convo.currentV);
  return found ? found.text : null;
}

/**
 * Write a new version (WS-R7). Immutable once written: the record is frozen
 * and nothing in this module mutates an existing entry.
 */
export function addPromptVersion(
  convo: Conversation,
  text: string,
  source: PromptVersion["source"],
  /**
   * WS-R7's provenance. `turnId` is optional because not every write happens
   * inside a turn: promoting or merging a candidate is a direct user action
   * (ST-R6), and a turn id there would be a reference into the event log that
   * resolves to nothing.
   */
  origin?: { action: ConversationAction; turnId?: string },
): PromptVersion {
  const v = convo.promptVersions.length > 0 ? Math.max(...convo.promptVersions.map((p) => p.v)) + 1 : 1;
  const version: PromptVersion = Object.freeze({
    v,
    text,
    source,
    at: new Date().toISOString(),
    ...(origin ? { action: origin.action } : {}),
    ...(origin?.turnId ? { turnId: origin.turnId } : {}),
  });
  convo.promptVersions.push(version);
  convo.currentV = v;
  return version;
}

/**
 * Append one event to the turn log (WS-R10, AD-17).
 *
 * The store owns `seq` and `at` so a caller cannot backdate or renumber an
 * event. The returned event is frozen; earlier entries are never touched.
 */
export function appendTurnEvent(convo: Conversation, input: TurnEventInput): TurnEvent {
  const event = Object.freeze({
    ...input,
    seq: convo.turnEvents.length + 1,
    at: new Date().toISOString(),
  }) as TurnEvent;
  convo.turnEvents.push(event);
  return event;
}

/** Events belonging to one turn, in the order they were emitted. */
export function turnEventsFor(convo: Conversation, turnId: string): TurnEvent[] {
  return convo.turnEvents.filter((e) => e.turnId === turnId);
}

/**
 * Persist one model call (WS-R14). Auditability that is claimed but not
 * persisted is not auditability, so this is called for every call the
 * workspace makes — classification included.
 */
export function recordModelCall(convo: Conversation, record: ModelCallRecord): void {
  convo.modelCalls.push(Object.freeze({ ...record }));
}

/**
 * WS-R8. Candidates are only ever added by an explicit user request.
 *
 * This writes to the candidate set and to nothing else. In particular it does
 * not touch `promptVersions` or `currentV`: a candidate that could become the
 * current prompt as a side effect of being generated would make "alternatives"
 * indistinguishable from "revisions", which is the one thing WS-R8 is for.
 */
export function addCandidate(
  convo: Conversation,
  candidate: {
    label: string;
    text: string;
    fromVersion?: number | null;
    strategy?: string;
    origin?: CandidateOrigin;
    rationale?: string;
    score?: number;
  },
): PromptCandidate {
  const entry: PromptCandidate = Object.freeze({
    id: randomUUID(),
    label: candidate.label,
    text: candidate.text,
    fromVersion: candidate.fromVersion ?? null,
    ...(candidate.strategy ? { strategy: candidate.strategy } : {}),
    origin: candidate.origin ?? "archetype",
    ...(candidate.rationale ? { rationale: candidate.rationale } : {}),
    ...(typeof candidate.score === "number" ? { score: candidate.score } : {}),
    at: new Date().toISOString(),
  });
  convo.candidates.push(entry);
  return entry;
}

/** One candidate by id, or null. The lookup every candidate action starts at. */
export function candidateById(convo: Conversation, id: string): PromptCandidate | null {
  return convo.candidates.find((c) => c.id === id) ?? null;
}

/**
 * ST-R6: record that the user chose (and what they chose).
 *
 * Append-only and never edited, so the provenance of a version produced from
 * the candidate set survives everything that happens to the set afterwards.
 */
export function recordCandidatePromotion(
  convo: Conversation,
  promotion: { v: number; promotion: "select" | "merge"; candidateIds: readonly string[] },
): CandidatePromotion {
  const entry: CandidatePromotion = Object.freeze({
    v: promotion.v,
    promotion: promotion.promotion,
    candidateIds: Object.freeze([...promotion.candidateIds]),
    at: new Date().toISOString(),
  });
  convo.candidatePromotions.push(entry);
  return entry;
}

/**
 * How many artifacts this conversation can address (WS-R5): the current
 * prompt plus its candidates. `COMPARE` and `MERGE` need at least two.
 */
export function addressableArtifactCount(convo: Conversation): number {
  return (convo.promptVersions.length > 0 ? 1 : 0) + convo.candidates.length;
}

/** WS-R5: record a question that must survive until the user answers it. */
export function setPendingClarification(
  convo: Conversation,
  question: { question: string; options?: readonly string[]; turnId: string },
): PendingClarification {
  const pending: PendingClarification = Object.freeze({
    id: randomUUID(),
    question: question.question,
    options: Object.freeze([...(question.options ?? [])]),
    askedInTurn: question.turnId,
    at: new Date().toISOString(),
  });
  convo.pendingClarification = pending;
  return pending;
}

/**
 * Answer the outstanding question. Returns null — and changes nothing — when
 * there is none, which is what makes `CLARIFY` refusable rather than guessable.
 */
export function resolvePendingClarification(
  convo: Conversation,
  answer: string,
  turnId: string,
): ResolvedClarification | null {
  const pending = convo.pendingClarification;
  if (!pending) return null;
  convo.pendingClarification = null;
  return Object.freeze({
    question: pending.question,
    answer,
    answeredInTurn: turnId,
    at: new Date().toISOString(),
  });
}

/**
 * Pin a requirement (WS-R24).
 *
 * The only way an entry enters the ledger, and it is reachable only from an
 * explicit user action. The text is stored verbatim — trimmed of surrounding
 * whitespace and nothing else — because a ledger whose entries FORGE tidied up
 * would already be a ledger a program had edited.
 */
export function pinRequirement(
  convo: Conversation,
  input: { text: string; fromVersion?: number | null },
): PinnedRequirement {
  const text = input.text.trim();
  const entry: PinnedRequirement = Object.freeze({
    id: randomUUID(),
    text,
    contentHash: contentHash(text),
    origin: "user_input",
    pinnedFromVersion: input.fromVersion ?? null,
    at: new Date().toISOString(),
  });
  convo.ledger.push(entry);
  return entry;
}

/**
 * Unpin (WS-R27.4). A user action, never a model's: this function is called
 * from the DELETE route and from nowhere the turn pipeline can reach.
 *
 * The entry leaves the active ledger; the event that pinned it stays in the
 * log, because an append-only log has no way to un-write history (WS-R17).
 */
export function unpinRequirement(convo: Conversation, entryId: string): PinnedRequirement | null {
  const at = convo.ledger.findIndex((e) => e.id === entryId);
  if (at === -1) return null;
  const [removed] = convo.ledger.splice(at, 1);
  return removed ?? null;
}

/** The ledger in the shape the deterministic check consumes. */
export function ledgerEntries(convo: Conversation): LedgerEntry[] {
  return convo.ledger.map((e) => ({
    id: e.id,
    text: e.text,
    contentHash: e.contentHash,
    origin: e.origin,
  }));
}

/**
 * Run Layer 1 against one version (WS-R25, WS-R29).
 *
 * Deterministic and model-free; the version defaults to the current one. An
 * empty ledger yields an empty verdict rather than a claim — FORGE never says
 * a requirement survived unless a requirement was pinned.
 */
export function checkLedger(convo: Conversation, v: number = convo.currentV): LedgerCheckResult {
  const version = convo.promptVersions.find((p) => p.v === v);
  // No version to check against is not a failed check. Reporting every pinned
  // requirement as "dropped by version 0" would be a preservation failure
  // claimed about a prompt that does not exist yet; the honest answer is that
  // nothing has been checked, which is what an empty result says (WS-R27.2).
  if (!version) return checkRequirementLedger([], "", v);
  return checkRequirementLedger(ledgerEntries(convo), version.text, v);
}

/**
 * Record the Task IR extracted for one version (WS-R26).
 *
 * Once per version: a second call for a version that already has one returns
 * the existing record and extracts nothing. The IR itself lives in the object
 * store, so two versions that extract to the same structure share one object.
 */
export function recordVersionIr(
  convo: Conversation,
  entry: { v: number; irHash: string; boundaryId: string; boundaryVersion: string },
): VersionIr {
  const existing = convo.versionIrs.find((e) => e.v === entry.v);
  if (existing) return existing;
  const record: VersionIr = Object.freeze({ ...entry, at: new Date().toISOString() });
  convo.versionIrs.push(record);
  return record;
}

/** The IR recorded for a version, or null when none has been extracted. */
export function versionIrHash(convo: Conversation, v: number): string | null {
  return convo.versionIrs.find((e) => e.v === v)?.irHash ?? null;
}

/** The fingerprint a model path must not change (AC-042). */
export function ledgerState(convo: Conversation): string {
  return ledgerFingerprint(ledgerEntries(convo));
}

/**
 * The semantic projection of a conversation (WS-R9, §6.3).
 *
 * Run data — timestamps, latency, model identity, the event log and the model
 * call log — is excluded, exactly as it is excluded from an IR's semantic
 * hash. This is what "leaves the conversation unchanged" means when comparing
 * a cancelled turn with a failed one (AC-036): the file always differs by
 * `updatedAt`, so byte-identity can only be asserted over the semantic part.
 *
 * `versionIrs` is excluded deliberately, not by oversight. WS-R9 calls derived
 * structure semantic, and it is — but each entry is a *hash of a function of*
 * version text that this snapshot already carries, wrapped in run data (when
 * it was extracted, by which boundary). Including it would add nothing a
 * reader could not derive, while making the snapshot depend on whether an
 * optional advisory check happened to have run.
 */
export function semanticSnapshot(convo: Conversation): string {
  return JSON.stringify({
    id: convo.id,
    target: convo.target,
    messages: convo.messages.map((m) => ({ role: m.role, content: m.content })),
    promptVersions: convo.promptVersions.map((p) => ({
      v: p.v,
      text: p.text,
      source: p.source,
      ...(p.action ? { action: p.action } : {}),
    })),
    currentV: convo.currentV,
    candidates: convo.candidates.map((c) => ({
      label: c.label,
      text: c.text,
      fromVersion: c.fromVersion,
      // WS-R9 calls strategy semantic explicitly, and origin is the field that
      // says where an alternative came from — a conversation whose candidates
      // changed provenance is not the same conversation.
      ...(c.strategy ? { strategy: c.strategy } : {}),
      origin: c.origin,
    })),
    // ST-R6: which candidates produced which version. The rationale is left
    // out — it is a deterministic rendering of the strategy already named.
    candidatePromotions: convo.candidatePromotions.map((p) => ({
      v: p.v,
      promotion: p.promotion,
      candidateIds: p.candidateIds,
    })),
    pendingClarification: convo.pendingClarification
      ? { question: convo.pendingClarification.question, options: convo.pendingClarification.options }
      : null,
    // WS-R24 calls a pinned requirement semantic content, so it belongs to the
    // part of a conversation AC-036 compares byte for byte. A cancelled turn
    // that quietly changed the ledger would otherwise compare as unchanged.
    ledger: convo.ledger.map((e) => ({ text: e.text, contentHash: e.contentHash, origin: e.origin })),
    attachments: convo.attachments.map((a) => ({ name: a.name, size: a.size, truncated: a.truncated })),
  });
}

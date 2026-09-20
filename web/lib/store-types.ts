/**
 * The conversation domain types (WS-R6…WS-R9).
 *
 * Split out of `store.ts` so the persistence layer and the public store API
 * can both depend on the shapes without depending on each other. Nothing
 * here knows how a conversation is stored.
 */
import type { ConversationAction } from "forge/dist/conversation/actions.js";
import type { ModelCallRecord } from "forge/dist/model/provider.js";

import type { TurnEvent } from "./turn/events";

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly at: string;
}

export interface PromptVersion {
  readonly v: number;
  readonly text: string;
  /** WS-R7: `merge` joins the set once V2-E can produce one. */
  readonly source: "model" | "manual" | "import" | "restore" | "merge";
  readonly at: string;
  /** The action that produced it (WS-R7). Absent on pre-V2 records. */
  readonly action?: ConversationAction;
  /** The turn that produced it (WS-R7). Absent on pre-V2 records. */
  readonly turnId?: string;
}

/**
 * ST-R7: an open enum whose only v0.1 value is `archetype`.
 *
 * Space is reserved here rather than in the Task IR because a strategy is an
 * overlay — a structure beside the IR — so a future source adds candidates
 * with no IR schema change (FR-035).
 */
export type CandidateOrigin = "archetype";

/** WS-R8: an alternative artifact inside one conversation. */
export interface PromptCandidate {
  readonly id: string;
  readonly label: string;
  readonly text: string;
  /** The version this candidate was derived from, when it was derived. */
  readonly fromVersion: number | null;
  /** Strategy archetype id when a candidate came from an overlay (§9). */
  readonly strategy?: string;
  /** Where the alternative came from (ST-R7). */
  readonly origin: CandidateOrigin;
  /**
   * The deciding rule, rendered by §11.3 and recorded verbatim.
   *
   * ST-R6 says selection is never fully automatic: FORGE presents candidates
   * *with the deciding rule* and the user chooses. Storing the rationale is
   * what makes that reviewable after the fact rather than at the moment.
   */
  readonly rationale?: string;
  /** The archetype's fit score (§11.3) — a deterministic function of the IR. */
  readonly score?: number;
  readonly at: string;
}

/**
 * ST-R6: the record that a user chose (WS-R7's provenance, for candidates).
 *
 * One entry per version that came out of the candidate set, naming which
 * candidates produced it. `select` cites one; `merge` cites the artifacts that
 * were combined. It is a separate append-only list rather than a field on the
 * candidate, because a candidate may be promoted more than once and because
 * nothing already written may be edited (WS-R7, WS-R17).
 */
export interface CandidatePromotion {
  /** The version this promotion produced. */
  readonly v: number;
  readonly promotion: "select" | "merge";
  /** Artifact refs, in the order the user gave them. */
  readonly candidateIds: readonly string[];
  readonly at: string;
}

/**
 * WS-R24: one requirement the user pinned into the ledger.
 *
 * `text` is verbatim user-authored content and nothing in the product rewrites
 * it — not the turn pipeline, not a boundary, not a repair. `origin` is FORGE
 * -assigned rather than model-stated (INV-016), and the ledger admits exactly
 * one origin, which is the shortest way to say that a model cannot author an
 * entry.
 */
export interface PinnedRequirement {
  readonly id: string;
  readonly text: string;
  /** The hash that names the text, so a tampered entry is detectable. */
  readonly contentHash: string;
  readonly origin: "user_input";
  /** The version on screen when the user pinned it. Null when there was none. */
  readonly pinnedFromVersion: number | null;
  readonly at: string;
}

/**
 * WS-R26: the Task IR extracted for one prompt version, stored by hash.
 *
 * Extracted **once** per version and never re-extracted: an advisory layer
 * that re-ran a model call every time someone opened a panel would be both
 * expensive and non-reproducible, and WS-R26 says once.
 */
export interface VersionIr {
  readonly v: number;
  /** The content-addressed object holding the IR. */
  readonly irHash: string;
  readonly boundaryId: string;
  readonly boundaryVersion: string;
  readonly at: string;
}

/** WS-R5: a question that must survive across turns for CLARIFY to be legal. */
export interface PendingClarification {
  readonly id: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly askedInTurn: string;
  readonly at: string;
}

export interface ResolvedClarification {
  readonly question: string;
  readonly answer: string;
  readonly answeredInTurn: string;
  readonly at: string;
}

export interface AttachmentMeta {
  readonly name: string;
  readonly size: number;
  readonly truncated: boolean;
  readonly at: string;
}

export interface Conversation {
  readonly id: string;
  title: string;
  readonly createdAt: string;
  updatedAt: string;
  target: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  attachmentContents: Record<string, string>;
  attachments: AttachmentMeta[];
  promptVersions: PromptVersion[];
  currentV: number;
  /** WS-R8. Empty until the user asks for alternatives. */
  candidates: PromptCandidate[];
  /** ST-R6. Empty until the user promotes or merges one. Append-only. */
  candidatePromotions: CandidatePromotion[];
  /** WS-R5. Null when no question is outstanding. */
  pendingClarification: PendingClarification | null;
  /**
   * WS-R24. The user-pinned requirement ledger — Layer 1 of preservation.
   *
   * Only `pinRequirement` and `unpinRequirement` may change it, and both are
   * reached only from a user action. The turn pipeline asserts it is byte
   * -identical before and after every model call (WS-R27.4, AC-042).
   */
  ledger: PinnedRequirement[];
  /**
   * WS-R26. Per-version Task IRs for the advisory drift layer.
   *
   * Empty unless someone asked for a drift check: Layer 2 is opt-in and never
   * on the critical path (WS-R29), so a conversation that never asks for
   * advice never pays for it.
   */
  versionIrs: VersionIr[];
  /** WS-R10. Append-only: only `appendTurnEvent` may extend it. */
  turnEvents: TurnEvent[];
  /** WS-R14. One record per model call the workspace made. */
  modelCalls: ModelCallRecord[];
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly currentV: number;
  readonly hasPrompt: boolean;
}


/**
 * The conversation domain types (WS-R6…WS-R9).
 *
 * Split out of `store.ts` so the persistence layer and the public store API
 * can both depend on the shapes without depending on each other. Nothing
 * here knows how a conversation is stored.
 */
import type { ConversationAction } from "forge/dist/conversation/actions.js";
import type { DiscoveryState } from "forge/dist/conversation/discovery.js";
import type { TransformationMode } from "forge/dist/conversation/intake.js";
import type { ArtifactKind, OutputShape } from "forge/dist/conversation/stages.js";
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
  /** WS-R38: the transformation mode the generate request named, if any. */
  readonly mode?: TransformationMode;
  /** WS-R40: the output shape the version was written for. Absent means single. */
  readonly shape?: OutputShape;
}

/** WS-R43: `default` sends no reasoning parameter at all. */
export type ReasoningEffort = "default" | "low" | "medium" | "high";
export const REASONING_EFFORTS: readonly ReasoningEffort[] = ["default", "low", "medium", "high"];
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * A verification the user ran (V2-G, persisted since Sprint 2).
 *
 * The evidence text is kept only when the secret scanner found nothing in it:
 * evidence is untrusted, pasted by the user, and FORGE does not write a
 * credential to disk because it arrived in a log. Redacting it instead would
 * change the bytes the verdict's `evidence_hash` names, so the text is simply
 * not kept and `evidenceKept` says so.
 */
export interface VerificationRecord {
  readonly v: number;
  readonly target: string;
  readonly profileId: string;
  readonly semanticId: string | null;
  readonly packageValid: boolean;
  readonly evidenceHash: string;
  readonly evidence: string | null;
  readonly evidenceKept: boolean;
  readonly counts: Readonly<Record<string, number>>;
  readonly at: string;
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

/**
 * RB-R1: the one local repository a conversation is explicitly bound to.
 *
 * `root` is the real path the binding resolved to. It is an absolute host path,
 * so it stays in the operator's own store and never enters a package or a
 * matrix (RB-R3, PK-R7).
 */
export interface RepositoryBinding {
  readonly root: string;
  readonly at: string;
}

/**
 * RG-R3: one recorded human governance decision, as persisted.
 *
 * Declared structurally rather than imported from the governance layer: the
 * store persists decisions, it does not make them, and nothing a model turn can
 * reach may import that layer (AC-053).
 */
export type GovernanceDecisionShape =
  | { readonly kind: "accept"; readonly requirement_id: string }
  | { readonly kind: "supersede"; readonly requirement_id: string; readonly successor_id: string }
  | { readonly kind: "conflict"; readonly requirement_ids: readonly [string, string] };

export interface GovernanceDecisionRecord {
  readonly decision: GovernanceDecisionShape;
  /** FORGE's snapshot of every requirement the decision names (RG-R3). */
  readonly subjects: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
    readonly origin: "user_stated" | "inferred";
  }>;
  readonly at: string;
}

/**
 * LK-R4: a link the user asserted between a requirement and a repository path.
 *
 * Advisory by construction — it is not deterministic evidence — and kept in a
 * collection of its own so it can never be mistaken for an authoritative link.
 */
export interface AdvisoryLinkRecord {
  readonly id: string;
  readonly requirementId: string;
  /** Repository-relative, checked through WorkspaceGuard when asserted. */
  readonly path: string;
  readonly note: string;
  readonly source: "user_asserted";
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
  /** Trust tier assigned at upload (V2-R). Absent on pre-V2-R records. */
  readonly trust?: string;
  /** What the secret scanner removed, by rule and count — never by value (SC-R6). */
  readonly redactions?: ReadonlyArray<{ readonly rule: string; readonly count: number }>;
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
  /**
   * WS-R30/WS-R31. Null until the first DISCOVER turn. While `status` is
   * `open`, no classified action writes a version; only an explicit generate
   * request does.
   */
  discovery: DiscoveryState | null;
  /** RB-R1. Null unless the user explicitly bound a repository. */
  repository: RepositoryBinding | null;
  /** RG-R3. Append-only human decisions; status is derived from them, never stored. */
  governance: GovernanceDecisionRecord[];
  /** LK-R4. User-asserted, advisory. Never merged with deterministic linkage. */
  advisoryLinks: AdvisoryLinkRecord[];
  /** WS-R10. Append-only: only `appendTurnEvent` may extend it. */
  turnEvents: TurnEvent[];
  /** WS-R14. One record per model call the workspace made. */
  modelCalls: ModelCallRecord[];
  /** WS-R39. Set only by a user action. */
  artifactKind: ArtifactKind;
  /** WS-R40. Set only by a user action. */
  outputShape: OutputShape;
  /** WS-R42/WS-R43. The effort requested for this conversation's model calls. */
  reasoningEffort: ReasoningEffort;
  /** Verifications run against this conversation's versions, oldest first. */
  verifications: VerificationRecord[];
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly messageCount: number;
  readonly currentV: number;
  readonly hasPrompt: boolean;
}


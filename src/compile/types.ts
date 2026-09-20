/**
 * Shared types across compiler stages.
 *
 * Kept in one place so that section emitters, legalization and budgeting agree on the
 * shape of what flows between them without importing each other in a cycle.
 */
import type { Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import type { Capability } from "../ir/vocabulary.js";
import type { AgentProfile } from "../profile/schema.js";
import type { LocalSpan, Span, TraceOrigin } from "../trace/span.js";
import type {
  CapabilityLevel,
  DegradationRuleId,
  Materialization,
  SectionKey,
} from "./vocabulary.js";

/** A degradation the compiler applied, recorded so nothing degrades silently (INV-012). */
export interface AppliedDegradation {
  readonly rule_id: DegradationRuleId;
  readonly capability: Capability | null;
  readonly reason: string;
  /** Human-readable description of what changed, surfaced in the artifact and diagnostics. */
  readonly effect: string;
}

/** A capability whose support is `conditional`, carried into the output as a note. */
export interface CapabilityNote {
  readonly capability: Capability;
  readonly level: CapabilityLevel;
  readonly note: string;
  /** True when this capability gates an executable verification step. */
  readonly gates_verification: boolean;
}

/** A context reference the budget stage removed, with the reason (FORGE-C061). */
export interface DroppedContext {
  readonly ref_id: string;
  readonly reason: string;
  readonly est_tokens: number;
}

/**
 * Task content that the target's artifact topology has no section able to render
 * (FORGE-C102, FR-050).
 *
 * Recorded on the result as well as in the diagnostics so a caller can act on the loss
 * structurally rather than by parsing messages.
 */
export interface TopologyGap {
  readonly content_class: string;
  readonly severity: "error" | "warning";
  /** Section keys that would have rendered this class. */
  readonly destinations: readonly string[];
  readonly node_ids: readonly string[];
}

/**
 * The token estimator identity used for this compilation (IR-R14, AOC-7).
 *
 * Recorded because budgeting can drop context, which changes rendered bytes — so the
 * estimator is a semantic input, not a measurement detail. P5 folds this into the
 * package's semantic input tuple; recording it now means the value is already flowing.
 */
export interface TokenizerIdentity {
  readonly id: string;
  readonly version: string;
}

/**
 * The result of lowering + legalization: what the renderer actually renders.
 *
 * In P1 `lower` is the identity (no strategy overlays until P4), so `ir` is the parsed
 * Task IR with `introduced_by` set to each node's own identity.
 */
export interface EffectiveIR {
  readonly ir: TaskIR;
  /** node id → the origin that introduced it. Identity in P1; strategy-aware in P4. */
  readonly introduced_by: ReadonlyMap<string, TraceOrigin>;
  /** Verification entries after legalization, which may differ in `kind` from the IR. */
  readonly verification: readonly LegalizedVerification[];
}

/** A verification entry after legalization; `degraded_from` is set when a rule fired. */
export interface LegalizedVerification {
  readonly id: string;
  readonly kind: TaskIR["verification"][number]["kind"];
  readonly spec: string;
  readonly expected: string;
  readonly satisfies: readonly string[];
  readonly source_ref: string;
  readonly degraded_from: TaskIR["verification"][number]["kind"] | null;
  readonly degraded_by: DegradationRuleId | null;
}

/** Everything a section emitter is allowed to see. Pure input; emitters never mutate. */
export interface SectionInput {
  readonly effective: EffectiveIR;
  readonly profile: AgentProfile;
  readonly rendererId: string;
  readonly sectionKey: SectionKey;
  readonly materialization: ReadonlyMap<string, Materialization>;
  readonly degradations: readonly AppliedDegradation[];
  readonly capabilityNotes: readonly CapabilityNote[];
  /** Instruction nodes whose trust resolved to `semi_trusted` — rendered as advisory. */
  readonly advisoryNodeIds: ReadonlySet<string>;
  readonly droppedContext: readonly DroppedContext[];
  readonly taskSlug: string;
  readonly taskId: string;
}

/**
 * A section emitter. Pure.
 *
 * Returns `null` when the section has nothing to say for this input, so a topology can
 * list a section unconditionally without producing empty headings.
 */
export interface SectionEmitter {
  readonly key: SectionKey;
  emit(input: SectionInput): SectionOutputOrNull;
}

export type SectionOutputOrNull = { readonly text: string; readonly spans: readonly LocalSpan[] } | null;

export interface Artifact {
  readonly path: string;
  readonly content: string;
  readonly content_hash: string;
}

/** The complete output of compiling one IR against one profile. */
export interface CompileResult {
  readonly artifacts: readonly Artifact[];
  readonly spans: readonly Span[];
  readonly diagnostics: readonly Diagnostic[];
  readonly materialization: Readonly<Record<string, Materialization>>;
  readonly degradations: readonly AppliedDegradation[];
  readonly droppedContext: readonly DroppedContext[];
  /** Content the topology cannot render (FORGE-C102). Empty when the topology covers it. */
  readonly topologyGaps: readonly TopologyGap[];
  /** The pinned estimator this compilation budgeted with (IR-R14). */
  readonly tokenizer: TokenizerIdentity;
  /** The strategy overlay applied, if any (P4). Null means identity. */
  readonly strategy: { readonly archetype: string; readonly version: number } | null;
  /** Set when compilation was refused (FORGE-C030 or another error-severity gate). */
  readonly refused: boolean;
}

export type { Materialization, SectionKey, TaskIR, AgentProfile, Diagnostic, Span, LocalSpan };

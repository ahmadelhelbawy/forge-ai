/**
 * Closed vocabularies for the compile domain.
 *
 * These are deliberately NOT in `src/ir/vocabulary.ts`. Materialization, section keys
 * and fidelity are compile-time and adapter concerns; putting them in the IR would
 * break INV-001 and IR-R3 (the IR carries no compile-time decisions).
 */

/**
 * How a context reference reaches the target (docs/architecture.md §7 stage 3).
 *
 * `by_reference` is the DEFAULT for strong-retrieval targets. Pre-injecting file
 * contents into an agent that searches better than we do is a measurable regression,
 * so inlining is a DEGRADATION for targets that cannot retrieve, not a feature.
 */
export const MATERIALIZATIONS = ["by_reference", "by_value", "summary"] as const;
export type Materialization = (typeof MATERIALIZATIONS)[number];

/** How well a target can find things on its own. Primary driver of materialization. */
export const RETRIEVAL_STRENGTHS = ["none", "weak", "strong"] as const;
export type RetrievalStrength = (typeof RETRIEVAL_STRENGTHS)[number];

/** Per-capability support level declared by a profile (AP-R2). */
export const CAPABILITY_LEVELS = ["supported", "conditional", "absent"] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/**
 * The fidelity ladder (AP-R6, INV-014). A profile must never claim more than its
 * topology and overrides can actually deliver; `FORGE-C101` enforces this.
 */
export const FIDELITY_LEVELS = ["full", "native_topology", "compatibility"] as const;
export type Fidelity = (typeof FIDELITY_LEVELS)[number];

/**
 * The closed section catalogue (docs/architecture.md §8.2).
 *
 * Profiles SELECT and ORDER these keys. They cannot define new emitters — that is what
 * keeps "adding an agent is data, not code" true (AP-R1) while keeping rendering
 * first-party and reviewable.
 */
export const SECTION_KEYS = [
  "objective",
  "goals",
  "acceptance",
  "constraints",
  "non_goals",
  "scope",
  "context_plan",
  "context_inline",
  "assumptions",
  "open_questions",
  "task_checklist",
  "verification",
  "stop_conditions",
  "deliverables",
  "capability_notes",
  "advisory",
  "untrusted_appendix",
  "project_conventions",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * Variables a topology path template may use (FR-024, AP-R4).
 *
 * Closed so that no template can produce an absolute path or a traversal. Validation
 * happens on the TEMPLATE, not only on the rendered result, because a template that
 * *could* escape is a defect even when today's values happen not to.
 */
export const PATH_VARS = ["task_slug", "task_id"] as const;
export type PathVar = (typeof PATH_VARS)[number];

/**
 * Named compiler rules that can author output or alter the EffectiveIR.
 *
 * Every one of these produces a `compiler_rule` trace origin, so text FORGE generates
 * about its own decisions is attributable rather than pretending to come from the IR.
 */
export const COMPILER_RULE_IDS = [
  "degrade.command_to_manual",
  "degrade.inline_context",
  "degrade.drop_subagent_guidance",
  "degrade.flatten_multi_turn",
  "budget.drop_context",
  "legalize.capability_note",
  "trust.advisory_demotion",
] as const;
export type CompilerRuleId = (typeof COMPILER_RULE_IDS)[number];

/** The subset of compiler rules that are degradations (FR-016). */
export const DEGRADATION_RULE_IDS = [
  "degrade.command_to_manual",
  "degrade.inline_context",
  "degrade.drop_subagent_guidance",
  "degrade.flatten_multi_turn",
] as const;
export type DegradationRuleId = (typeof DEGRADATION_RULE_IDS)[number];

/**
 * Closed vocabularies for the Task IR.
 *
 * These are shared with the (future) AgentProfile schema so that legalization is a
 * total function over a common enum rather than a string match (spec.md AP-R2).
 *
 * INV-001: nothing in this file may name a vendor, a product, an agent, a concrete
 * tool, or an output filename. The IR says `run_tests`; it never says `Bash` or
 * `pnpm test`. Mapping abstract capability to concrete tool is an adapter concern.
 * Enforced by tests/property/no-vendor-names.test.ts (AC-001).
 */

/**
 * Abstract capabilities a task may require of a target agent (docs/architecture.md §4.4).
 * Deliberately abstract: these describe what must be *possible*, not how.
 */
export const CAPABILITIES = [
  "fs_read",
  "fs_write",
  "shell",
  "run_tests",
  "git_history",
  "git_write",
  "network",
  "package_install",
  "mcp",
  "subagents",
  "planning_mode",
  "multi_turn",
  "vision",
  "long_context",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const OBJECTIVE_KINDS = [
  "debug",
  "feature",
  "refactor",
  "analysis",
  "design",
  "research",
  "migration",
  "review",
] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/**
 * Objective kinds for which manual-only verification is legitimate, so FORGE-C020
 * is reported at `info` rather than `warning` (spec.md §10.2 footnote 1).
 * Declared here because it is a property of the vocabulary, not of the checker.
 */
export const MANUAL_VERIFICATION_OBJECTIVE_KINDS = [
  "analysis",
  "research",
  "design",
  "review",
] as const;

export const GOAL_PRIORITIES = ["must", "should", "could"] as const;
export type GoalPriority = (typeof GOAL_PRIORITIES)[number];

export const CONSTRAINT_KINDS = [
  "architectural",
  "behavioral",
  "stylistic",
  "process",
  "scope",
  "security",
  "performance",
  "compatibility",
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

export const CONSTRAINT_HARDNESS = ["hard", "soft"] as const;
export type ConstraintHardness = (typeof CONSTRAINT_HARDNESS)[number];

export const BLAST_RADII = ["file", "module", "package", "repo", "multi_repo"] as const;
export type BlastRadius = (typeof BLAST_RADII)[number];

export const CONTEXT_ROLES = [
  "definition",
  "example",
  "constraint_source",
  "background",
  "counter_example",
] as const;
export type ContextRole = (typeof CONTEXT_ROLES)[number];

/**
 * Trust tier (spec.md §13.2). This is NOT descriptive metadata -- it changes
 * compiler behavior in three mechanical places (SC-R1):
 *
 *   trusted       may become an authoritative instruction
 *   semi_trusted  ATTRIBUTABLE, NOT SAFE. Renders as advisory; emits C052.
 *   untrusted     never an instruction. C050 refuses compilation.
 */
export const TRUST_TIERS = ["trusted", "semi_trusted", "untrusted"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

/** Ordered least to most privileged, for comparisons. */
export const TRUST_RANK: Readonly<Record<TrustTier, number>> = Object.freeze({
  untrusted: 0,
  semi_trusted: 1,
  trusted: 2,
});

export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const VERIFICATION_KINDS = ["command", "test", "manual", "review"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** Verification kinds requiring the target to execute something (drives legalization). */
export const EXECUTABLE_VERIFICATION_KINDS = ["command", "test"] as const;

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DELIVERABLE_KINDS = [
  "code_change",
  "doc",
  "analysis",
  "design",
  "config",
  "test",
] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/**
 * URI schemes accepted in ContextRef.uri. Retrievers for `web` and `issue` are
 * deferred (spec.md §20); the scheme is reserved so adding them later needs no
 * schema change.
 */
export const CONTEXT_URI_SCHEMES = ["forge", "git", "web", "issue", "session"] as const;
export type ContextUriScheme = (typeof CONTEXT_URI_SCHEMES)[number];

/**
 * Instruction-bearing node kinds (spec.md IR-R5, docs/architecture.md §5.1).
 *
 * These COMMAND the agent: they say what to do, what not to do, and where.
 */
export const INSTRUCTION_BEARING = [
  "objective",
  "goals",
  "constraints",
  "non_goals",
  "verification",
  "deliverables",
  "scope",
] as const;
export type InstructionBearingKind = (typeof INSTRUCTION_BEARING)[number];

/**
 * Influence-bearing node kinds (spec.md IR-R5).
 *
 * These do not command the agent, but they STEER it: an assumption is a premise the
 * agent is told to work from, and an open question tells it what is undecided and what
 * default to proceed under. Both are read as guidance by anything that reads the
 * artifact.
 */
export const INFLUENCE_BEARING = ["assumptions", "open_questions"] as const;
export type InfluenceBearingKind = (typeof INFLUENCE_BEARING)[number];

/**
 * AGENT-STEERING nodes: instruction-bearing ∪ influence-bearing (spec.md §1, SC-R1).
 *
 * This is the set the trust model applies to, and the distinction that matters for
 * security. The narrower "instruction-bearing" reading was a real vulnerability: an
 * assumption sourced from an untrusted page rendered as an unattributed premise at
 * `confidence: high` with no diagnostic at all, because `assumptions` sat outside the
 * checked set. Agents read tokens, not trust labels (intent.md), so "it is only a
 * premise, not an instruction" is a distinction the threat model cannot rely on.
 *
 * Every member MUST carry `source_ref`. A structural test asserts the schema honours
 * this set; adding a member without a `source_ref` field fails the build.
 */
export const AGENT_STEERING = [...INSTRUCTION_BEARING, ...INFLUENCE_BEARING] as const;
export type AgentSteeringKind = (typeof AGENT_STEERING)[number];

/**
 * Strategy archetype schema (FR-031, ST-R2, ST-R3).
 *
 * Archetypes are DATA in `strategies/*.yaml`: an overlay template with
 * typed, bounded parameters plus deterministic fit rules. v0.1 has fixed
 * archetypes only — no free-form or model-invented candidates (ST-R2), no
 * `strategy.propose` boundary (MB-R4).
 *
 * Overlay dimensions (ST-R4): added_constraints, autonomy, change_budget,
 * verification_intensity, context_policy, exploration. `added_verification`
 * renders the intensity dimension as nodes: a scalar intensity that reaches
 * no section would be dead data, while added steps render in the existing
 * verification section through the same node mechanism as constraints.
 */
import { z } from "zod";

import {
  BLAST_RADII,
  CAPABILITIES,
  CONSTRAINT_HARDNESS,
  CONSTRAINT_KINDS,
  OBJECTIVE_KINDS,
  RISK_LEVELS,
  VERIFICATION_KINDS,
  type BlastRadius,
  type Capability,
  type ConstraintHardness,
  type ConstraintKind,
  type ObjectiveKind,
  type RiskLevel,
  type VerificationKind,
} from "../ir/vocabulary.js";
import type { RetrievalStrength } from "../compile/vocabulary.js";

const StatementText = z.string().min(1).max(500);

export const AUTONOMY_LEVELS = ["low", "medium", "high"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const ASK_THRESHOLDS = ["any_ambiguity", "blocking_only", "never"] as const;
export type AskThreshold = (typeof ASK_THRESHOLDS)[number];

export const VERIFICATION_INTENSITIES = ["light", "standard", "thorough"] as const;
export type VerificationIntensity = (typeof VERIFICATION_INTENSITIES)[number];

export const CONTEXT_POLICIES = ["minimal", "standard", "thorough"] as const;
export type ContextPolicy = (typeof CONTEXT_POLICIES)[number];

export const AutonomySchema = z.strictObject({
  decision_authority: z.enum(AUTONOMY_LEVELS),
  ask_threshold: z.enum(ASK_THRESHOLDS),
});
export type StrategyAutonomy = z.infer<typeof AutonomySchema>;

export const ChangeBudgetSchema = z.strictObject({
  max_files: z.number().int().min(1).max(50),
});
export type ChangeBudget = z.infer<typeof ChangeBudgetSchema>;

export const ExplorationSchema = z.strictObject({
  challenge_architecture: z.boolean(),
  require_alternatives: z.number().int().min(0).max(5),
});
export type StrategyExploration = z.infer<typeof ExplorationSchema>;

export const AddedConstraintSchema = z.strictObject({
  kind: z.enum(CONSTRAINT_KINDS),
  hardness: z.enum(CONSTRAINT_HARDNESS),
  statement: StatementText,
});
export type AddedConstraint = z.infer<typeof AddedConstraintSchema>;

export const AddedVerificationSchema = z.strictObject({
  kind: z.enum(VERIFICATION_KINDS),
  spec: StatementText,
  expected: z.string().min(1).max(200),
  /**
   * Goal ids the step satisfies, or ["*"] for every goal of the target IR.
   * Archetype data cannot name goals it has never seen; "*" expands
   * deterministically at apply time, and explicit ids are validated then.
   */
  satisfies: z.array(z.string()).min(1),
});
export type AddedVerification = z.infer<typeof AddedVerificationSchema>;

/** Closed derivation functions for bounded parameters (ST-R3, FR-032). */
export const PARAM_DERIVERS = [
  "from_blast_radius",
  "from_scope_size",
  "from_scope_count",
  "from_risk",
  "from_open_questions",
] as const;
export type ParamDeriver = (typeof PARAM_DERIVERS)[number];

export const StrategyParameterSchema = z.strictObject({
  type: z.literal("int"),
  min: z.number().int(),
  max: z.number().int(),
  derive: z.enum(PARAM_DERIVERS),
}).refine((p) => p.min <= p.max, "parameter min must not exceed max");
export type StrategyParameter = z.infer<typeof StrategyParameterSchema>;

/**
 * One fit rule: `when` maps signal names to accepted values, `weight` is
 * the score contribution when every condition holds (AND across keys).
 * Array signals match on non-empty intersection; numbers also accept
 * `{min,max}` ranges. Profile signals use the `profile.` prefix.
 */
export const FitRuleValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
  z.strictObject({ min: z.number().optional(), max: z.number().optional() }),
]);
export type FitRuleValue = z.infer<typeof FitRuleValueSchema>;

export const FitRuleSchema = z.strictObject({
  when: z.record(z.string(), FitRuleValueSchema),
  weight: z.number().int().min(1).max(10),
});
export type FitRule = z.infer<typeof FitRuleSchema>;

export const OverlayTemplateSchema = z.strictObject({
  added_constraints: z.array(AddedConstraintSchema),
  added_verification: z.array(AddedVerificationSchema).default([]),
  autonomy: AutonomySchema,
  change_budget: ChangeBudgetSchema,
  verification_intensity: z.enum(VERIFICATION_INTENSITIES),
  context_policy: z.enum(CONTEXT_POLICIES),
  exploration: ExplorationSchema,
});
export type OverlayTemplate = z.infer<typeof OverlayTemplateSchema>;

export const StrategyArchetypeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "archetype id must be lowercase snake_case"),
  version: z.number().int().positive(),
  description: z.string().min(1).max(500),
  overlay_template: OverlayTemplateSchema,
  parameters: z.record(z.string(), StrategyParameterSchema).default({}),
  fit_rules: z.array(FitRuleSchema).min(1),
});
export type StrategyArchetype = z.infer<typeof StrategyArchetypeSchema>;

export function parseStrategyArchetype(value: unknown, path: string): StrategyArchetype {
  const parsed = StrategyArchetypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `Invalid strategy archetype ${path}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** Deterministic signals extracted from a Task IR (fit.ts input). */
export interface StrategySignals {
  readonly risk_level: RiskLevel;
  readonly objective_kind: ObjectiveKind;
  readonly blast_radius: BlastRadius;
  readonly hard_constraint_count: number;
  readonly hard_constraint_kinds: readonly ConstraintKind[];
  readonly open_blocking_count: number;
  readonly open_total_count: number;
  readonly verification_kinds: readonly VerificationKind[];
  readonly required_capabilities: readonly Capability[];
  readonly context_ref_count: number;
  readonly has_untrusted_context: boolean;
}

/** Deterministic signals extracted from an AgentProfile. */
export interface ProfileSignals {
  readonly autonomy: AutonomyLevel;
  readonly retrieval: RetrievalStrength;
  /** Capabilities the target supports or conditionally supports. */
  readonly capabilities: readonly Capability[];
}

/** A derived, ready-to-apply overlay: template + tuned parameters. */
export interface DerivedOverlay {
  readonly archetypeId: string;
  /** Attribution id (`st_<archetype>`): first-party, therefore trusted. */
  readonly strategyId: string;
  readonly version: number;
  readonly params: Readonly<Record<string, number>>;
  readonly template: OverlayTemplate;
}

/** One ranked strategy candidate (origin is open for future sources, ST-R7). */
export interface StrategyCandidate {
  readonly overlay: DerivedOverlay;
  readonly score: number;
  readonly matchedRules: readonly { readonly ruleIndex: number; readonly weight: number; readonly detail: string }[];
  readonly rationale: string;
  readonly origin: "archetype";
}

export { BLAST_RADII, CAPABILITIES, CONSTRAINT_HARDNESS, CONSTRAINT_KINDS, OBJECTIVE_KINDS, RISK_LEVELS, VERIFICATION_KINDS };

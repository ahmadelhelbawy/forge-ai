/**
 * Public surface of the Task IR module.
 *
 * This is the boundary that `@forge/ir` will be extracted along the first time a third
 * party writes an adapter (docs/architecture.md §19, AD-7). Keep it deliberate: what
 * is exported here is what external code may depend on.
 */

export {
  IR_VERSION,
  IR_SUPPORTED_MAJOR,
  UnsupportedIrVersionError,
  parseIrVersion,
  isReadableIrVersion,
  compareIrVersions,
  type IrVersion,
} from "./version.js";

export {
  CAPABILITIES,
  OBJECTIVE_KINDS,
  MANUAL_VERIFICATION_OBJECTIVE_KINDS,
  GOAL_PRIORITIES,
  CONSTRAINT_KINDS,
  CONSTRAINT_HARDNESS,
  BLAST_RADII,
  CONTEXT_ROLES,
  TRUST_TIERS,
  TRUST_RANK,
  CONFIDENCE_LEVELS,
  VERIFICATION_KINDS,
  EXECUTABLE_VERIFICATION_KINDS,
  RISK_LEVELS,
  DELIVERABLE_KINDS,
  CONTEXT_URI_SCHEMES,
  INSTRUCTION_BEARING,
  INFLUENCE_BEARING,
  AGENT_STEERING,
  type Capability,
  type ObjectiveKind,
  type GoalPriority,
  type ConstraintKind,
  type ConstraintHardness,
  type BlastRadius,
  type ContextRole,
  type TrustTier,
  type ConfidenceLevel,
  type VerificationKind,
  type RiskLevel,
  type DeliverableKind,
  type ContextUriScheme,
  type InstructionBearingKind,
  type InfluenceBearingKind,
  type AgentSteeringKind,
} from "./vocabulary.js";

export {
  canonicalize,
  canonicalStringify,
  contentHash,
  rawHash,
  isHash,
  SHA256_PATTERN,
  CanonicalizationError,
  type Json,
} from "./canonical.js";

export {
  TaskIRSchema,
  DraftIRSchema,
  ObjectiveSchema,
  GoalSchema,
  ConstraintSchema,
  NonGoalSchema,
  ScopeSchema,
  VerificationSchema,
  DeliverableSchema,
  AssumptionSchema,
  OpenQuestionSchema,
  ContextRefSchema,
  RiskSchema,
  SegmentId,
  parseTaskIR,
  safeParseTaskIR,
  IrShapeError,
  type TaskIR,
  type DraftIR,
  type Objective,
  type Goal,
  type Constraint,
  type NonGoal,
  type Scope,
  type Verification,
  type Deliverable,
  type Assumption,
  type OpenQuestion,
  type ContextRef,
  type Risk,
  type SourceRefValue,
  type SegmentIdValue,
} from "./schema.js";

export {
  AttributionError,
  attributeDraft,
  buildSegmentTable,
  checkSegmentTable,
  contextSegment,
  forgeDerivedSegment,
  userInputSegment,
  type AttributeOptions,
  type InputSegment,
  type SegmentTable,
} from "./attribution.js";

export {
  IR_SEMANTIC_FIELDS,
  CONTEXT_REF_SEMANTIC_FIELDS,
  semanticProjection,
  semanticHash,
  semanticHashMatches,
} from "./projection.js";

export { resolveTrust, isAuthoritative, isStrategyId, isContextRefId } from "./trust.js";

export { checkIntegrity, advisoryNodeIds } from "./integrity.js";

export {
  MIGRATIONS,
  MigrationError,
  migrateIr,
  readIrVersion,
  type Migration,
} from "./migrate.js";

export {
  DIAGNOSTIC_REGISTRY,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_SEVERITIES,
  DIAGNOSTIC_SOURCES,
  diagnostic,
  nodeEvidence,
  measureEvidence,
  hasErrors,
  codesOf,
  EmptyEvidenceError,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticDefinition,
  type DiagnosticSeverity,
  type DiagnosticSource,
  type Evidence,
} from "./diagnostic.js";

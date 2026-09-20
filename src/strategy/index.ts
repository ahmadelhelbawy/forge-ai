/**
 * Strategy engine public surface (P4): archetypes as data, deterministic
 * fit, bounded derivation, structural application, distinctness gate.
 */
export {
  parseStrategyArchetype,
  type AddedConstraint,
  type AddedVerification,
  type DerivedOverlay,
  type FitRule,
  type OverlayTemplate,
  type ParamDeriver,
  type ProfileSignals,
  type StrategyArchetype,
  type StrategyAutonomy,
  type StrategyCandidate,
  type StrategyExploration,
  type StrategyParameter,
} from "./schema.js";
export { AUTONOMY_LEVELS, ASK_THRESHOLDS, CONTEXT_POLICIES, PARAM_DERIVERS, VERIFICATION_INTENSITIES } from "./schema.js";
export { builtinStrategies, loadStrategiesFrom, StrategyNotFoundError, type StrategyRegistry } from "./registry.js";
export { extractProfileSignals, extractSignals } from "./signals.js";
export { deriveParameters } from "./derive.js";
export { FitRuleError, renderRationale, scoreArchetype, type FitMatch } from "./fit.js";
export { applyOverlay, StrategyApplyError, type AppliedOverlay } from "./apply.js";
export { checkDistinctness, DISTINCTNESS_THRESHOLD, overlayDistance } from "./distinctness.js";
export { ArchetypeSource, ARCHETYPE_ORDER, deriveOverlay, resolveArchetype, type StrategySource } from "./source.js";

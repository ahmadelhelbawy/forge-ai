/**
 * The compiler entry point — stages 1..6 (docs/architecture.md §7).
 *
 * Pure and deterministic. No model calls, no filesystem access, no network, no clock.
 * Given the same semantic IR, the same profile version and the same estimator, the
 * rendered artifacts are byte-identical.
 *
 * There is no vendor branching anywhere in this file, and none anywhere downstream of
 * it. Every difference between targets comes from AgentProfile data: which capabilities
 * exist, how well the target searches, and which sections its topology selects into
 * which files.
 */
import { advisoryNodeIds, checkIntegrity } from "../ir/integrity.js";
import { hasErrors, type Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import { verifyCoverage } from "../trace/coverage.js";
import type { Span } from "../trace/span.js";
import {
  checkBlockingQuestions,
  checkConstraintPreservation,
  checkFidelity,
  checkGoalCoverage,
  checkRedundantContext,
  checkScopeBounds,
  checkTopologyCoverage,
  checkVerifiability,
} from "../critic/deterministic/index.js";
import { allocateBudget, checkRenderedBudget } from "./budget.js";
import { legalize } from "./legalize.js";
import { lower } from "./lower.js";
import { materialize } from "./materialize.js";
import { composeArtifact, pathVars } from "./topology.js";
import { DEFAULT_TOKEN_ESTIMATOR, type TokenEstimator } from "./tokenizer.js";
import type { DerivedOverlay } from "../strategy/schema.js";
import { applyOverlay } from "../strategy/apply.js";
import type { Artifact, CompileResult, SectionInput, TopologyGap } from "./types.js";
import type { Materialization } from "./vocabulary.js";

/**
 * Section overrides implemented in the renderer.
 *
 * Empty in P1: FR-022 assigns override implementations to P6. It is exported so
 * `checkFidelity` compares a profile's claim against what actually exists rather than
 * against a hard-coded assumption.
 */
export const REGISTERED_OVERRIDES: ReadonlySet<string> = new Set<string>();

export interface CompileOptions {
  readonly taskSlug?: string;
  readonly taskId?: string;
  readonly estimator?: TokenEstimator;
  /** Strategy overlay to apply (P4). Absent means the identity overlay. */
  readonly overlay?: DerivedOverlay | null;
}

export function compile(
  ir: TaskIR,
  profile: AgentProfile,
  options: CompileOptions = {},
): CompileResult {
  const estimator = options.estimator ?? DEFAULT_TOKEN_ESTIMATOR;
  const tokenizer = { id: estimator.id, version: estimator.version };
  const strategy = options.overlay
    ? { archetype: options.overlay.archetypeId, version: options.overlay.version }
    : null;
  const diagnostics: Diagnostic[] = [];
  const refuse = (
    extra: Partial<CompileResult> = {},
  ): CompileResult => ({
    artifacts: [],
    spans: [],
    diagnostics,
    materialization: {},
    degradations: [],
    droppedContext: [],
    topologyGaps: [],
    tokenizer,
    strategy,
    refused: true,
    ...extra,
  });

  // Profile honesty first: a profile that overclaims must not be used to make promises.
  diagnostics.push(...checkFidelity(profile, REGISTERED_OVERRIDES));

  // P0 semantics on the author's IR: referential integrity and the trust model.
  diagnostics.push(...checkIntegrity(ir));

  // Stage 1 — lower with the overlay (P4). The merged view carries base
  // nodes verbatim plus strategy-added nodes; every stage below consumes
  // the merged view, while the base IR (and its semantic hash) is untouched.
  const applied = options.overlay ? applyOverlay(ir, options.overlay) : null;
  const working = applied?.ir ?? ir;

  // Stage 2 — legalize. Refuses before it degrades.
  const legal = legalize(working, profile);
  diagnostics.push(...legal.diagnostics);

  if (legal.refused || hasErrors(diagnostics)) {
    return refuse({ degradations: legal.degradations });
  }

  // Stage 3 — materialize.
  const decided = materialize(working, profile, { forceInline: legal.forceInline });

  // Stage 4 — budget.
  const budget = allocateBudget(working, profile, estimator);
  diagnostics.push(...budget.diagnostics);

  // An envelope too small for the task's own instructions is FORGE-C060, an error.
  // Rendering anyway would mean emitting a package with every reference stripped and
  // calling it a success — a truncation by another name (INV-003).
  if (hasErrors(diagnostics)) {
    return refuse({ degradations: legal.degradations, droppedContext: budget.dropped });
  }

  const materialization = new Map<string, Materialization>();
  for (const [id, mode] of decided) {
    if (budget.keptContextIds.has(id)) materialization.set(id, mode);
  }

  // The trust model's advisory relocation, computed once and shared with the renderer
  // so C052's claim and the rendered artifact cannot disagree (SC-R1 mechanism 2).
  // Strategy-added nodes resolve trusted (first-party archetype data), so the
  // overlay can never promote semi_trusted or untrusted content by itself.
  const advisory = advisoryNodeIds(working);

  // Can this topology actually carry this task? A profile must not delete content by
  // omission (FR-050, INV-012). Checked BEFORE rendering, so a refusal emits nothing.
  const coverage = checkTopologyCoverage({
    ir: working,
    profile,
    advisory,
    materialization,
    hasEnvironmentNotes: legal.degradations.length > 0 || legal.capabilityNotes.length > 0,
  });
  diagnostics.push(...coverage.diagnostics);
  if (coverage.refused) {
    return refuse({
      degradations: legal.degradations,
      droppedContext: budget.dropped,
      topologyGaps: coverage.gaps,
    });
  }

  // Lower (identity in P1; overlay-aware in P4 — verification comes from legalization).
  const effective = lower(working, legal.verification, applied?.introduced);

  // Stage 5 — render.
  const vars = pathVars(options.taskSlug ?? ir.objective.kind, options.taskId ?? "task");
  const sectionInput: Omit<SectionInput, "sectionKey"> = {
    effective,
    profile,
    rendererId: "generic",
    materialization,
    degradations: legal.degradations,
    capabilityNotes: legal.capabilityNotes,
    advisoryNodeIds: advisory,
    droppedContext: budget.dropped,
    taskSlug: vars.task_slug,
    taskId: vars.task_id,
  };

  const artifacts: Artifact[] = [];
  const spans: Span[] = [];
  for (const entry of profile.output.artifacts) {
    const composed = composeArtifact(entry, sectionInput, vars);
    // A topology may declare a file whose sections all decline to render for this
    // particular task. Writing a zero-byte file into someone's repository is clutter,
    // not output, so the artifact is omitted. Nothing is lost: an omitted artifact
    // contained no spans, so INV-003 and INV-010 are unaffected, and a hard constraint
    // that failed to render anywhere is still caught by FORGE-C002.
    if (composed.artifact.content.trim().length === 0) continue;
    artifacts.push(composed.artifact);
    spans.push(...composed.spans);
  }

  // Stage 6 — verify and diagnose over the merged view: strategy-added
  // hard constraints are preserved exactly like authored ones (INV-003).
  for (const artifact of artifacts) {
    diagnostics.push(...verifyCoverage(artifact.path, artifact.content, spans));
  }
  diagnostics.push(...checkConstraintPreservation(working, spans, effective.introduced_by));
  diagnostics.push(...checkGoalCoverage(working, legal.verification));
  diagnostics.push(...checkVerifiability(working, legal.verification));
  diagnostics.push(...checkRedundantContext(working));
  diagnostics.push(...checkScopeBounds(working));
  diagnostics.push(...checkBlockingQuestions(working));
  diagnostics.push(...checkRenderedBudget(artifacts, profile, estimator));

  return {
    artifacts,
    spans,
    diagnostics,
    materialization: Object.fromEntries(materialization),
    degradations: legal.degradations,
    droppedContext: budget.dropped,
    topologyGaps: coverage.gaps satisfies readonly TopologyGap[],
    tokenizer,
    strategy,
    refused: false,
  };
}

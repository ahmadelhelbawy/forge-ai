/**
 * Stage 4 — Budget (FR-020, INV-003, docs/architecture.md §7).
 *
 * Allocate the token envelope, dropping the lowest-value context first.
 *
 * GOALS AND HARD CONSTRAINTS ARE NEVER DROPPABLE (INV-003). If the non-droppable core
 * alone exceeds the envelope, that is FORGE-C060 — an error — not a truncation. A
 * compiler that silently trimmed an instruction would be worse than one that refused.
 *
 * Every drop emits FORGE-C061 naming the item and the reason (INV-012).
 */
import { diagnostic, measureEvidence, nodeEvidence, type Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import type { DroppedContext } from "./types.js";
import type { TokenEstimator } from "./tokenizer.js";

export interface BudgetResult {
  readonly keptContextIds: ReadonlySet<string>;
  readonly dropped: readonly DroppedContext[];
  readonly diagnostics: readonly Diagnostic[];
  readonly coreTokens: number;
  readonly contextTokens: number;
  readonly envelopeTokens: number;
}

/**
 * Drop order by role: least load-bearing first.
 *
 * `constraint_source` and `definition` sit last because dropping them would remove the
 * evidence behind an instruction the agent is still being asked to honour.
 */
const ROLE_DROP_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  background: 0,
  example: 1,
  counter_example: 2,
  definition: 3,
  constraint_source: 4,
});

/** Text of everything that can never be dropped. */
function coreText(ir: TaskIR): string {
  const parts: string[] = [
    ir.objective.statement,
    ir.objective.success_definition,
    ...ir.goals.flatMap((g) => [g.statement, ...g.acceptance]),
    ...ir.constraints.map((c) => c.statement),
    ...ir.non_goals.map((n) => n.statement),
    ...ir.scope.include,
    ...ir.scope.exclude,
    ...ir.verification.flatMap((v) => [v.spec, v.expected]),
    ...ir.deliverables.map((d) => d.description),
    ...ir.assumptions.map((a) => a.statement),
    ...ir.open_questions.flatMap((q) => [q.question, ...q.options]),
  ];
  return parts.join("\n");
}

/** Estimated cost of one context reference as it will be rendered (pointer form). */
function refText(ref: TaskIR["context_refs"][number]): string {
  return `${ref.uri} ${ref.role} ${ref.justifies.join(" ")} ${ref.content_hash ?? ""}`;
}

export function allocateBudget(
  ir: TaskIR,
  profile: AgentProfile,
  estimator: TokenEstimator,
): BudgetResult {
  const envelope = Math.floor(profile.budget.max_context_tokens * profile.budget.artifact_share);
  const core = estimator.count(coreText(ir));
  const diagnostics: Diagnostic[] = [];
  const dropped: DroppedContext[] = [];

  if (core > envelope) {
    diagnostics.push(
      diagnostic(
        "FORGE-C060",
        `The task's own instructions need about ${core} tokens but ${profile.display_name} ` +
          `allows ${envelope} for a compiled package. Goals and hard constraints cannot be ` +
          `dropped, so this task must be narrowed rather than truncated.`,
        [
          measureEvidence("required_tokens", core, "tokens"),
          measureEvidence("envelope_tokens", envelope, "tokens"),
        ],
      ),
    );
    return {
      keptContextIds: new Set(),
      dropped: ir.context_refs.map((r) => ({
        ref_id: r.id,
        reason: "the task's own instructions already exceed the target's budget",
        est_tokens: estimator.count(refText(r)),
      })),
      diagnostics,
      coreTokens: core,
      contextTokens: 0,
      envelopeTokens: envelope,
    };
  }

  // Rank order is preserved; role priority decides who goes first among equals.
  const candidates = ir.context_refs.map((ref, rank) => ({
    ref,
    rank,
    tokens: estimator.count(refText(ref)),
  }));
  const dropOrder = [...candidates].sort(
    (a, b) =>
      (ROLE_DROP_PRIORITY[a.ref.role] ?? 0) - (ROLE_DROP_PRIORITY[b.ref.role] ?? 0) ||
      b.rank - a.rank,
  );

  const kept = new Set(candidates.map((c) => c.ref.id));
  let contextTokens = candidates.reduce((sum, c) => sum + c.tokens, 0);

  for (const candidate of dropOrder) {
    if (core + contextTokens <= envelope) break;
    kept.delete(candidate.ref.id);
    contextTokens -= candidate.tokens;
    dropped.push({
      ref_id: candidate.ref.id,
      reason: `context budget exceeded; dropped by role priority (${candidate.ref.role}) then rank (${candidate.rank})`,
      est_tokens: candidate.tokens,
    });
    diagnostics.push(
      diagnostic(
        "FORGE-C061",
        `Dropped context reference "${candidate.ref.id}" (${candidate.ref.uri}, role ` +
          `${candidate.ref.role}, rank ${candidate.rank}) to fit ${profile.display_name}'s ` +
          `${envelope}-token envelope.`,
        [
          nodeEvidence(candidate.ref.id),
          measureEvidence("reclaimed_tokens", candidate.tokens, "tokens"),
        ],
      ),
    );
  }

  return {
    keptContextIds: kept,
    dropped,
    diagnostics,
    coreTokens: core,
    contextTokens,
    envelopeTokens: envelope,
  };
}

/** Post-render check that the artifacts actually fit (FORGE-C060). */
export function checkRenderedBudget(
  artifacts: readonly { path: string; content: string }[],
  profile: AgentProfile,
  estimator: TokenEstimator,
): Diagnostic[] {
  const envelope = Math.floor(profile.budget.max_context_tokens * profile.budget.artifact_share);
  const total = artifacts.reduce((sum, a) => sum + estimator.count(a.content), 0);
  if (total <= envelope) return [];
  return [
    diagnostic(
      "FORGE-C060",
      `Rendered package is about ${total} tokens, exceeding ${profile.display_name}'s ` +
        `${envelope}-token envelope.`,
      [
        measureEvidence("rendered_tokens", total, "tokens"),
        measureEvidence("envelope_tokens", envelope, "tokens"),
      ],
    ),
  ];
}

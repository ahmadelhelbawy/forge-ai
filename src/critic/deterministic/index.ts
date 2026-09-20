/**
 * Deterministic diagnostics assigned to P1 (FR-036).
 *
 * Codes implemented here: C001, C002, C011, C020, C070, C080, C101, and C102 (in
 * `topology.ts`, re-exported below).
 * C030/C031 are produced by legalization, C060/C061 by budgeting, C100 by trace
 * coverage — each lives with the stage that has the evidence.
 *
 * P0 codes (C010, C050, C052, C053, C090, C091, C092) come from `checkIntegrity` and
 * are not re-implemented here.
 *
 * The registry knows more codes than any phase implements. A code existing in the
 * catalogue is not a licence to implement its behaviour early.
 *
 * INV-007: every diagnostic below carries evidence. INV-008: nothing here aggregates.
 */
import { diagnostic, measureEvidence, nodeEvidence, type Diagnostic } from "../../ir/diagnostic.js";
import type { TaskIR } from "../../ir/schema.js";
import { MANUAL_VERIFICATION_OBJECTIVE_KINDS } from "../../ir/vocabulary.js";
import type { AgentProfile } from "../../profile/schema.js";
import type { Artifact, LegalizedVerification } from "../../compile/types.js";
import type { Span, TraceOrigin } from "../../trace/span.js";

export {
  checkTopologyCoverage,
  type TopologyCoverageInput,
  type TopologyCoverageResult,
} from "./topology.js";

/**
 * Layer 1 of requirement preservation (V2-D1). It lives beside the other
 * deterministic checks because that is what it is — a pure function over text
 * the user wrote, with no model, no clock and no I/O (WS-R25).
 */
export {
  checkRequirementLedger,
  containsSequence,
  hasPreservationFailure,
  isPresent,
  ledgerFingerprint,
  proposeRequirementCandidates,
  tokenize,
  type LedgerCheckResult,
  type LedgerEntry,
  type LedgerFinding,
} from "./ledger.js";

/** Scope breadth above which a task is worth questioning, absent a filesystem (P2). */
const WIDE_SCOPE_GLOB_COUNT = 8;

/** FORGE-C001 — a goal nothing verifies. */
export function checkGoalCoverage(
  ir: TaskIR,
  verification: readonly LegalizedVerification[],
): Diagnostic[] {
  const satisfied = new Set(verification.flatMap((v) => v.satisfies));
  return ir.goals
    .filter((g) => !satisfied.has(g.id))
    .map((g) =>
      diagnostic(
        "FORGE-C001",
        `Goal "${g.id}" has no verification step. Nothing in this package says how anyone ` +
          `would know it was achieved.`,
        [nodeEvidence(g.id)],
      ),
    );
}

/**
 * FORGE-C020 — a goal verified only by human judgement.
 *
 * Reported at `info` rather than `warning` for analysis-shaped objectives, where manual
 * verification is the legitimate answer rather than a gap (spec.md §10.2 footnote 1).
 */
export function checkVerifiability(
  ir: TaskIR,
  verification: readonly LegalizedVerification[],
): Diagnostic[] {
  const manualOnlyIsFine = (MANUAL_VERIFICATION_OBJECTIVE_KINDS as readonly string[]).includes(
    ir.objective.kind,
  );
  const severity = manualOnlyIsFine ? "info" : "warning";

  return ir.goals
    .filter((g) => {
      const steps = verification.filter((v) => v.satisfies.includes(g.id));
      return steps.length > 0 && steps.every((v) => v.kind === "manual" || v.kind === "review");
    })
    .map((g) =>
      diagnostic(
        "FORGE-C020",
        `Goal "${g.id}" is verified only by manual review. Nothing here can be checked ` +
          `mechanically.`,
        [nodeEvidence(g.id)],
        severity,
      ),
    );
}

/**
 * FORGE-C002 — a hard constraint that never reached the artifacts.
 *
 * This is the enforcement point for INV-003. Relocation is not a drop: a semi-trusted
 * constraint rendered in the advisory section still carries its own `ir_node` origin
 * and therefore still has a span. Strategy-added constraints carry `strategy`
 * origins (PV-R4, FR-018) and count identically — but precisely: a strategy
 * span satisfies a constraint only when it carries the exact origin recorded
 * for that node in `introduced_by`. Any strategy span would otherwise satisfy
 * any constraint, which is coverage theater, not coverage.
 */
export function checkConstraintPreservation(
  ir: TaskIR,
  spans: readonly Span[],
  introducedBy: ReadonlyMap<string, TraceOrigin> = new Map(),
): Diagnostic[] {
  const rendered = new Set<string>();
  for (const s of spans) {
    if (s.origin.kind === "ir_node") rendered.add(s.origin.node_id);
  }
  const strategySpans = spans.filter((s) => s.origin.kind === "strategy");
  return ir.constraints
    .filter((c) => {
      if (c.hardness !== "hard" || rendered.has(c.id)) return false;
      const expected = introducedBy.get(c.id);
      return !(
        expected !== undefined &&
        expected.kind === "strategy" &&
        strategySpans.some(
          (s) =>
            s.origin.kind === "strategy" &&
            s.origin.strategy_id === expected.strategy_id &&
            s.origin.overlay_path === expected.overlay_path,
        )
      );
    })
    .map((c) =>
      diagnostic(
        "FORGE-C002",
        `Hard constraint "${c.id}" (${c.statement}) has no span in any rendered artifact. ` +
          `A hard constraint can never be dropped by budgeting, degradation, or rendering.`,
        [nodeEvidence(c.id)],
      ),
    );
}

/** FORGE-C011 — two references carrying the same content or the same location. */
export function checkRedundantContext(ir: TaskIR): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byHash = new Map<string, string>();
  const byUri = new Map<string, string>();

  for (const ref of ir.context_refs) {
    if (ref.content_hash !== null) {
      const first = byHash.get(ref.content_hash);
      if (first !== undefined) {
        out.push(
          diagnostic(
            "FORGE-C011",
            `Context references "${first}" and "${ref.id}" have identical content. One of ` +
              `them is spending budget for nothing.`,
            [nodeEvidence(first), nodeEvidence(ref.id)],
          ),
        );
      } else {
        byHash.set(ref.content_hash, ref.id);
      }
    }

    const firstUri = byUri.get(ref.uri);
    if (firstUri !== undefined) {
      out.push(
        diagnostic(
          "FORGE-C011",
          `Context references "${firstUri}" and "${ref.id}" point at the same location ` +
            `(${ref.uri}).`,
          [nodeEvidence(firstUri), nodeEvidence(ref.id)],
        ),
      );
    } else {
      byUri.set(ref.uri, ref.id);
    }
  }

  return out;
}

/**
 * FORGE-C070 — scope broad enough to be worth questioning.
 *
 * P1 implements the half that needs no filesystem: a repository-wide blast radius
 * combined with hard architectural constraints, or an unusually broad include list.
 * Counting matched files requires WorkspaceGuard and lands in P2.
 */
export function checkScopeBounds(ir: TaskIR): Diagnostic[] {
  const out: Diagnostic[] = [];
  const architectural = ir.constraints.filter(
    (c) => c.hardness === "hard" && c.kind === "architectural",
  );

  if ((ir.scope.blast_radius === "repo" || ir.scope.blast_radius === "multi_repo") && architectural.length > 0) {
    out.push(
      diagnostic(
        "FORGE-C070",
        `Scope allows changes across the whole ${ir.scope.blast_radius.replace("_", " ")} while ` +
          `${architectural.length} hard architectural constraint(s) must hold. That combination ` +
          `is hard to honour and hard to review.`,
        [nodeEvidence("scope"), ...architectural.map((c) => nodeEvidence(c.id))],
      ),
    );
  }

  if (ir.scope.include.length > WIDE_SCOPE_GLOB_COUNT) {
    out.push(
      diagnostic(
        "FORGE-C070",
        `Scope lists ${ir.scope.include.length} include patterns. Broad scope makes it hard to ` +
          `tell whether a change stayed inside it.`,
        [nodeEvidence("scope"), measureEvidence("include_globs", ir.scope.include.length, "patterns")],
      ),
    );
  }

  return out;
}

/** FORGE-C080 — a blocking question is still open. */
export function checkBlockingQuestions(ir: TaskIR): Diagnostic[] {
  return ir.open_questions
    .filter((q) => q.blocking)
    .map((q) =>
      diagnostic(
        "FORGE-C080",
        `Open question "${q.id}" is marked blocking and is still unanswered: ${q.question}`,
        [nodeEvidence(q.id)],
      ),
    );
}

/**
 * FORGE-C101 — a profile claiming more than it can deliver (INV-014, AP-R6).
 *
 * THE LADDER, as resolved in this pass. Revision 2 enforced `native_topology` by
 * requiring two or more declared artifacts, which created a contradiction with AP-R8:
 * `hermes-agent` and `claude-design` are single-artifact BY NATURE (one AGENTS.md with
 * SKILL.md deferred; one design brief) and were forced to under-claim `compatibility` to
 * keep INV-014 true. The file count was also a poor proxy — `claude-code` declares two
 * artifacts and emits one for most tasks, because its second file carries only
 * conventions that many tasks do not have.
 *
 * File COUNT is therefore not the distinction. ARITY IS NOT FIDELITY:
 *
 *   compatibility    one portable, generic artifact. FORGE claims the target can READ
 *                    it, not that it matches any native convention.
 *                    Mechanically: exactly one declared artifact.
 *   native_topology  the artifact paths and section placement follow the target's own
 *                    convention, at whatever arity that convention has. Generic prose.
 *                    Mechanically: the topology compiles the contract fixture; the claim
 *                    itself is a human one, carried by `verified_against` and
 *                    `limits.known_gaps` (AP-R6). Stated as a declared claim rather than
 *                    dressed up in a check that does not test it.
 *   full             native topology PLUS registered section overrides producing
 *                    idiomatic content. Mechanically: every declared override exists in
 *                    the renderer.
 */
export function checkFidelity(
  profile: AgentProfile,
  registeredOverrides: ReadonlySet<string>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const declaredOverrides = Object.keys(profile.output.overrides);

  if (profile.fidelity === "full") {
    const missing = declaredOverrides.filter((key) => !registeredOverrides.has(key));
    if (declaredOverrides.length === 0) {
      out.push(
        diagnostic(
          "FORGE-C101",
          `Profile "${profile.id}" claims fidelity "full" but registers no section overrides. ` +
            `Full fidelity means idiomatic output the generic emitters cannot produce.`,
          [nodeEvidence(profile.id)],
        ),
      );
    } else if (missing.length > 0) {
      out.push(
        diagnostic(
          "FORGE-C101",
          `Profile "${profile.id}" claims fidelity "full" and declares override(s) ` +
            `${missing.join(", ")} that are not registered in the renderer.`,
          [nodeEvidence(profile.id)],
        ),
      );
    }
  }

  // `compatibility` is a claim of PORTABILITY: one generic artifact any target can read.
  // A bespoke multi-file layout is not that, whether or not it is idiomatic — so the
  // profile is describing itself incorrectly and must say `native_topology`.
  if (profile.fidelity === "compatibility" && profile.output.artifacts.length > 1) {
    out.push(
      diagnostic(
        "FORGE-C101",
        `Profile "${profile.id}" claims fidelity "compatibility" but declares ` +
          `${profile.output.artifacts.length} artifacts. Compatibility means ONE portable ` +
          `artifact; a bespoke multi-file layout is "native_topology".`,
        [
          nodeEvidence(profile.id),
          measureEvidence("declared_artifacts", profile.output.artifacts.length, "files"),
        ],
      ),
    );
  }

  if (profile.fidelity !== "full" && declaredOverrides.length > 0) {
    out.push(
      diagnostic(
        "FORGE-C101",
        `Profile "${profile.id}" declares section override(s) ${declaredOverrides.join(", ")} ` +
          `but claims fidelity "${profile.fidelity}". Overrides are only meaningful at "full".`,
        [nodeEvidence(profile.id)],
      ),
    );
  }

  return out;
}

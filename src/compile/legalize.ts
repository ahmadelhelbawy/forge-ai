/**
 * Stage 2 — Legalization (FR-015, FR-016, INV-012, docs/architecture.md §7).
 *
 * Reconcile what the task requires against what the target can actually do.
 *
 *   supported   → nothing to do
 *   conditional → record a note; FORGE-C031 at `info` when it gates a verification step
 *   absent      → a registered degradation rule applies (soft)      → C031 warning
 *                 no rule exists (hard-required)                    → C030 error, REFUSE
 *
 * REFUSES BEFORE IT DEGRADES. A hard gap stops compilation; only soft gaps reach the
 * registry. Nothing is ever silently dropped (INV-012): every degradation produces both
 * a diagnostic and text in the artifact carrying a `compiler_rule` origin.
 */
import { diagnostic, nodeEvidence, type Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import { EXECUTABLE_VERIFICATION_KINDS, type Capability } from "../ir/vocabulary.js";
import type { AgentProfile } from "../profile/schema.js";
import {
  CAPABILITIES_GATING_VERIFICATION,
  DEGRADATION_RULES,
  degradationFor,
} from "./degradations.js";
import type { AppliedDegradation, CapabilityNote, LegalizedVerification } from "./types.js";

export interface LegalizeResult {
  readonly verification: readonly LegalizedVerification[];
  readonly degradations: readonly AppliedDegradation[];
  readonly capabilityNotes: readonly CapabilityNote[];
  readonly diagnostics: readonly Diagnostic[];
  /** True when a hard capability gap refuses compilation (FORGE-C030). */
  readonly refused: boolean;
  /** Set by `degrade.inline_context`; consumed by materialization (stage 3). */
  readonly forceInline: boolean;
}

const isExecutable = (kind: string): boolean =>
  (EXECUTABLE_VERIFICATION_KINDS as readonly string[]).includes(kind);

export function legalize(ir: TaskIR, profile: AgentProfile): LegalizeResult {
  const diagnostics: Diagnostic[] = [];
  const degradations: AppliedDegradation[] = [];
  const capabilityNotes: CapabilityNote[] = [];
  const appliedRules = new Set<string>();
  let refused = false;
  let forceInline = false;

  const hasExecutableVerification = ir.verification.some((v) => isExecutable(v.kind));

  const applyDegradation = (ruleId: keyof typeof DEGRADATION_RULES, capability: Capability | null) => {
    const rule = DEGRADATION_RULES[ruleId];
    if (appliedRules.has(rule.id)) return;
    appliedRules.add(rule.id);
    degradations.push({
      rule_id: rule.id,
      capability,
      reason: `${profile.display_name} ${rule.trigger}`,
      effect: rule.effect,
    });
    if (rule.id === "degrade.inline_context") forceInline = true;
  };

  for (const capability of ir.required_capabilities) {
    const declaration = profile.capabilities[capability];
    const gates =
      CAPABILITIES_GATING_VERIFICATION.includes(capability) && hasExecutableVerification;

    if (declaration.level === "supported") continue;

    if (declaration.level === "conditional") {
      const note =
        declaration.note ?? `may be unavailable depending on how ${profile.display_name} is configured`;
      capabilityNotes.push({
        capability,
        level: "conditional",
        note,
        gates_verification: gates,
      });
      if (gates) {
        diagnostics.push(
          diagnostic(
            "FORGE-C031",
            `Capability "${capability}" is conditional on ${profile.display_name} (${note}) and ` +
              `gates an executable verification step. The step is preserved; the dependency is ` +
              `recorded in the runtime contract.`,
            [nodeEvidence(capability)],
            "info",
          ),
        );
      }
      continue;
    }

    // absent
    const rule = degradationFor(capability);
    if (rule === null) {
      refused = true;
      diagnostics.push(
        diagnostic(
          "FORGE-C030",
          `${profile.display_name} cannot provide required capability "${capability}", and no ` +
            `degradation rule covers its absence. Compilation refused rather than producing a ` +
            `package the target cannot execute.`,
          [nodeEvidence(capability)],
        ),
      );
      continue;
    }

    applyDegradation(rule.id, capability);
    diagnostics.push(
      diagnostic(
        "FORGE-C031",
        `${profile.display_name} cannot provide "${capability}". Applied ${rule.id}: ${rule.effect}.`,
        [nodeEvidence(capability)],
      ),
    );
  }

  // A target that cannot search at all must receive content rather than pointers,
  // independently of whether `fs_read` was listed as required (AD-2, AP-R3).
  if (profile.retrieval.autonomous_search === "none" && ir.context_refs.length > 0) {
    const alreadyApplied = appliedRules.has("degrade.inline_context");
    applyDegradation("degrade.inline_context", null);
    if (!alreadyApplied) {
      diagnostics.push(
        diagnostic(
          "FORGE-C031",
          `${profile.display_name} performs no autonomous search, so context references are ` +
            `marked for inlining rather than left as pointers (degrade.inline_context).`,
          [nodeEvidence("scope")],
        ),
      );
    }
  }

  const commandsDegraded = appliedRules.has("degrade.command_to_manual");
  const verification: LegalizedVerification[] = ir.verification.map((v) => {
    if (commandsDegraded && isExecutable(v.kind)) {
      return {
        id: v.id,
        kind: "manual" as const,
        spec: v.spec,
        expected: v.expected,
        satisfies: v.satisfies,
        source_ref: v.source_ref,
        degraded_from: v.kind,
        degraded_by: "degrade.command_to_manual" as const,
      };
    }
    return {
      id: v.id,
      kind: v.kind,
      spec: v.spec,
      expected: v.expected,
      satisfies: v.satisfies,
      source_ref: v.source_ref,
      degraded_from: null,
      degraded_by: null,
    };
  });

  return { verification, degradations, capabilityNotes, diagnostics, refused, forceInline };
}

/**
 * Diagnostics — coded findings with mandatory evidence.
 *
 * INV-007: every diagnostic carries a code, a severity, and at least one piece of
 * evidence. This is enforced by the `diagnostic()` factory, not by convention: a
 * finding without evidence cannot be constructed.
 *
 * INV-008: there is no composite score here and there never will be. Diagnostics and
 * measured quantities with units are the only evaluation output FORGE produces.
 *
 * The registry below transcribes spec.md §10.2 in full. It is the catalogue of codes
 * the specification defines, which is not the same as the set implemented so far --
 * plan.md tracks implementation per phase. P0 implements C010, C050, C052, C053,
 * C090, C091 and C092.
 */

export const DIAGNOSTIC_SEVERITIES = ["error", "warning", "info"] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

/** Whether a finding is computed deterministically or proposed by a model boundary. */
export const DIAGNOSTIC_SOURCES = ["deterministic", "judged"] as const;
export type DiagnosticSource = (typeof DIAGNOSTIC_SOURCES)[number];

/**
 * `code` is typed as `string` here rather than `DiagnosticCode`: the code union is
 * derived from the registry's keys, so referencing it in the constraint the registry
 * is checked against would be circular. `as const` still gives each entry its literal
 * type, and `tests/contract/diagnostic-catalogue.test.ts` asserts key and `code`
 * agree — a claim this comment made for some time before the test existed.
 */
export interface DiagnosticDefinition {
  readonly code: string;
  readonly name: string;
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
}

/** The full catalogue defined by spec.md §10.2. */
export const DIAGNOSTIC_REGISTRY = Object.freeze({
  "FORGE-C001": { code: "FORGE-C001", name: "uncovered_goal", severity: "error", source: "deterministic" },
  "FORGE-C002": { code: "FORGE-C002", name: "dropped_constraint", severity: "error", source: "deterministic" },
  "FORGE-C010": { code: "FORGE-C010", name: "orphan_context", severity: "error", source: "deterministic" },
  "FORGE-C011": { code: "FORGE-C011", name: "redundant_context", severity: "warning", source: "deterministic" },
  "FORGE-C020": { code: "FORGE-C020", name: "unverifiable_goal", severity: "warning", source: "deterministic" },
  "FORGE-C030": { code: "FORGE-C030", name: "capability_gap_hard", severity: "error", source: "deterministic" },
  "FORGE-C031": { code: "FORGE-C031", name: "capability_degraded", severity: "warning", source: "deterministic" },
  "FORGE-C040": { code: "FORGE-C040", name: "unsupported_assumption", severity: "warning", source: "judged" },
  "FORGE-C041": { code: "FORGE-C041", name: "residual_ambiguity", severity: "warning", source: "judged" },
  "FORGE-C050": { code: "FORGE-C050", name: "untrusted_influence", severity: "error", source: "deterministic" },
  "FORGE-C051": { code: "FORGE-C051", name: "injection_suspicion", severity: "warning", source: "judged" },
  "FORGE-C052": { code: "FORGE-C052", name: "semi_trusted_instruction", severity: "warning", source: "deterministic" },
  "FORGE-C053": { code: "FORGE-C053", name: "untrusted_role_violation", severity: "error", source: "deterministic" },
  "FORGE-C060": { code: "FORGE-C060", name: "budget_overflow", severity: "error", source: "deterministic" },
  "FORGE-C061": { code: "FORGE-C061", name: "context_dropped", severity: "info", source: "deterministic" },
  "FORGE-C070": { code: "FORGE-C070", name: "unbounded_scope", severity: "warning", source: "deterministic" },
  "FORGE-C080": { code: "FORGE-C080", name: "blocking_question_unanswered", severity: "error", source: "deterministic" },
  "FORGE-C090": { code: "FORGE-C090", name: "dangling_reference", severity: "error", source: "deterministic" },
  "FORGE-C091": { code: "FORGE-C091", name: "duplicate_id", severity: "error", source: "deterministic" },
  "FORGE-C092": { code: "FORGE-C092", name: "hash_mismatch", severity: "error", source: "deterministic" },
  "FORGE-C100": { code: "FORGE-C100", name: "untraced_span", severity: "error", source: "deterministic" },
  "FORGE-C101": { code: "FORGE-C101", name: "fidelity_overclaim", severity: "error", source: "deterministic" },
  "FORGE-C102": { code: "FORGE-C102", name: "topology_gap", severity: "error", source: "deterministic" },
  // Workspace codes (spec.md §10.2, W-series). The turn runtime does not own
  // the diagnostic system — it emits instances of codes catalogued here, so
  // there is one namespace and one factory rather than a second, parallel set
  // of findings that render differently and carry no evidence.
  "FORGE-W001": { code: "FORGE-W001", name: "classification_degraded", severity: "warning", source: "deterministic" },
  "FORGE-W002": { code: "FORGE-W002", name: "action_unsupported_by_state", severity: "warning", source: "deterministic" },
  "FORGE-W003": { code: "FORGE-W003", name: "response_envelope_degraded", severity: "warning", source: "deterministic" },
  "FORGE-W004": { code: "FORGE-W004", name: "read_only_write_blocked", severity: "error", source: "deterministic" },
  // Requirement preservation (spec.md §22.8). Two codes, two epistemic
  // statuses: W005 is the deterministic guarantee and W006 is advice. They are
  // separate codes precisely so no surface can render them as one list
  // (WS-R28), and so W006 can never be mistaken for a statement W005 makes.
  "FORGE-W005": { code: "FORGE-W005", name: "pinned_requirement_dropped", severity: "error", source: "deterministic" },
  "FORGE-W006": { code: "FORGE-W006", name: "semantic_drift", severity: "warning", source: "judged" },
  // Candidates (spec.md §10.2, §22.2). A candidate dropped because it only
  // reworded another is still a drop, and INV-012 admits no silent ones —
  // the user asked for N alternatives and must be told why they got fewer.
  "FORGE-W007": { code: "FORGE-W007", name: "candidate_duplicate_rejected", severity: "warning", source: "deterministic" },
  // Requirement classification (spec.md §10.2, INV-016). Warning rather than
  // error on purpose: `--strict` promotes warnings to failures, so an error here
  // would make previously-succeeding runs exit non-zero, and the one genuine
  // FORGE loss in the P1.6 gate was over-blocking. Promote once the
  // false-positive rate has been measured rather than assumed.
  "FORGE-W008": { code: "FORGE-W008", name: "stated_requirement_demoted", severity: "warning", source: "deterministic" },
} as const satisfies Record<string, DiagnosticDefinition>);

export type DiagnosticCode = keyof typeof DIAGNOSTIC_REGISTRY;

export const DIAGNOSTIC_CODES = Object.keys(DIAGNOSTIC_REGISTRY) as readonly DiagnosticCode[];

/**
 * Evidence. Every variant points at something a reader can independently check:
 * a node that exists, a byte range that exists, or a counted quantity with a unit.
 */
export type Evidence =
  | { readonly kind: "node"; readonly node_id: string }
  | {
      readonly kind: "span";
      readonly artifact_path: string;
      readonly start: number;
      readonly end: number;
      readonly quote: string;
    }
  | { readonly kind: "measure"; readonly label: string; readonly value: number; readonly unit: string };

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly name: string;
  readonly severity: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly message: string;
  readonly evidence: readonly Evidence[];
}

export class EmptyEvidenceError extends Error {
  constructor(code: string) {
    super(
      `Diagnostic ${code} was constructed with no evidence. INV-007 requires every ` +
        `diagnostic to cite a node, a span, or a measured quantity.`,
    );
    this.name = "EmptyEvidenceError";
  }
}

/**
 * The only supported way to construct a Diagnostic.
 *
 * `severityOverride` exists for the one documented case where severity is
 * context-dependent (C020 is `info` for analysis-shaped objectives, spec.md §10.2
 * footnote 1). It is deliberately explicit rather than inferred.
 */
export function diagnostic(
  code: DiagnosticCode,
  message: string,
  evidence: readonly Evidence[],
  severityOverride?: DiagnosticSeverity,
): Diagnostic {
  if (evidence.length === 0) throw new EmptyEvidenceError(code);
  const def = DIAGNOSTIC_REGISTRY[code];
  return Object.freeze({
    code: def.code,
    name: def.name,
    severity: severityOverride ?? def.severity,
    source: def.source,
    message,
    evidence: Object.freeze([...evidence]),
  });
}

export const nodeEvidence = (node_id: string): Evidence => ({ kind: "node", node_id });

export const measureEvidence = (label: string, value: number, unit: string): Evidence => ({
  kind: "measure",
  label,
  value,
  unit,
});

/** True when any diagnostic in the list would refuse compilation. */
export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** Sorted, stable summary used by tests and by `--json` output. */
export function codesOf(diagnostics: readonly Diagnostic[]): DiagnosticCode[] {
  return diagnostics.map((d) => d.code).sort();
}

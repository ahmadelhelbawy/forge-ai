/**
 * The requirement traceability matrix (V2-H, `FR-058`, `spec.md` §22.10
 * TM-R1–TM-R4).
 *
 *   requirement × provenance × lifecycle × files × tests × obligations
 *               × evidence × verdict
 *
 * A **join**, not an inference. Every column is copied from an input that
 * already held it: the V2-F manifest and IR (identity, origin, nodes), the
 * governance log (status, successor), the compiler's trace spans (where a node
 * landed), the package's `verification.json` (obligations), a V2-G verdict
 * report (verdicts), the deterministic linkage (files, tests) and the advisory
 * links. Nothing here calls a model, reads a file or looks at a clock; a column
 * whose input is absent is shown absent, never filled in.
 *
 * The verification layer is not imported (`AC-050`): the caller hands the
 * verdicts in as data, with the report's own caveat.
 *
 * **Advisory links cannot reach an authoritative column.** They arrive in their
 * own input, leave in their own field, and are re-stamped `advisory: true`
 * here; and an "authoritative" link without `rg_term` or `test_naming` evidence
 * is dropped rather than shown. A mislabelled input cannot make the matrix lie.
 */
import { canonicalStringify } from "../ir/canonical.js";
import type { Diagnostic } from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";
import type { LedgerEntry } from "../critic/deterministic/ledger.js";
import {
  governRequirements,
  type GovernanceRecord,
  type RequirementSource,
  type RequirementStatus,
} from "./governance.js";
import type { RequirementOrigin } from "./identity.js";
import type { AdvisoryLink, AuthoritativeLink, LinkageResult } from "./linkage.js";

export const MATRIX_VERSION = 1;

/** One trace span as `trace.json` and `CompileResult` carry it. Only `ir_node` origins are joined. */
export interface MatrixSpan {
  readonly artifact_path: string;
  readonly start: number;
  readonly end: number;
  readonly origin: { readonly kind: string; readonly node_id?: string };
}

/** One `verification.json` entry (PK-R5). */
export interface MatrixObligation {
  readonly id: string;
  readonly kind: string;
  readonly spec: string;
  readonly expected: string;
  readonly satisfies: readonly string[];
}

/** The part of a V2-G verdict report the matrix joins, handed in as data. */
export interface MatrixVerdicts {
  readonly package_valid: boolean;
  readonly package_semantic_id: string | null;
  readonly caveat: string;
  readonly verdicts: ReadonlyArray<{
    readonly obligation_id: string;
    readonly verdict: string;
    readonly records: ReadonlyArray<unknown>;
  }>;
}

export interface MatrixInput {
  readonly ledger: readonly LedgerEntry[];
  /** The version's Task IR; null when it has not been extracted (TM-R1). */
  readonly ir: TaskIR | null;
  readonly log: readonly GovernanceRecord[];
  readonly package_semantic_id: string | null;
  readonly spans: readonly MatrixSpan[] | null;
  readonly obligations: readonly MatrixObligation[] | null;
  readonly verdicts: MatrixVerdicts | null;
  /** Null when no repository is bound. */
  readonly linkage: LinkageResult | null;
  readonly advisory: readonly AdvisoryLink[];
}

export interface MatrixObligationCell {
  readonly id: string;
  readonly kind: string;
  readonly spec: string;
  readonly expected: string;
  /** Null when no valid verdict report was supplied. */
  readonly verdict: string | null;
  readonly accepted_records: number;
}

export interface MatrixRow {
  readonly id: string;
  readonly text: string;
  readonly origin: RequirementOrigin;
  readonly status: RequirementStatus;
  readonly pinned: boolean;
  readonly superseded_by: string | null;
  readonly active: boolean;
  readonly conflicts_with: readonly string[];
  readonly sources: readonly RequirementSource[];
  readonly artifact_spans: ReadonlyArray<{
    readonly artifact_path: string;
    readonly start: number;
    readonly end: number;
    readonly node_id: string;
  }>;
  /** Authoritative only (LK-R1). */
  readonly files: readonly AuthoritativeLink[];
  /** Authoritative only (LK-R1). */
  readonly tests: readonly AuthoritativeLink[];
  /** Advisory only, always `advisory: true` (LK-R4). */
  readonly advisory_links: readonly AdvisoryLink[];
  readonly obligations: readonly MatrixObligationCell[];
}

export interface TraceabilityMatrix {
  readonly matrix_version: number;
  readonly package_semantic_id: string | null;
  readonly ir_extracted: boolean;
  readonly repository_bound: boolean;
  readonly verdicts_supplied: boolean;
  /** True when a verdict report was supplied for a package that failed validation (EV-R3). */
  readonly verdicts_rejected: boolean;
  /** The `EV-R5` caveat, repeated whenever a verdict is shown (TM-R3). */
  readonly caveat: string | null;
  readonly rows: readonly MatrixRow[];
  /** Governance findings (R001, R002) then linkage findings (R003). */
  readonly diagnostics: readonly Diagnostic[];
  /** Canonical JSON of everything above: byte-identical for fixed inputs. */
  readonly json: string;
}

const hasDeterministicEvidence = (link: AuthoritativeLink): boolean =>
  link.advisory === false && link.evidence.some((e) => e.type === "rg_term" || e.type === "test_naming");

export function buildTraceabilityMatrix(input: MatrixInput): TraceabilityMatrix {
  const registry = governRequirements({ ledger: input.ledger, ir: input.ir, log: input.log });
  const verdictsUsable = input.verdicts !== null && input.verdicts.package_valid;
  const verdictBy = new Map(
    verdictsUsable ? input.verdicts!.verdicts.map((v) => [v.obligation_id, v] as const) : [],
  );

  const rows: MatrixRow[] = registry.requirements.map((r) => {
    const nodeIds = new Set(r.sources.flatMap((s) => (s.kind === "ir_node" ? [s.node_id] : [])));
    const artifact_spans = (input.spans ?? [])
      .filter((s) => s.origin.kind === "ir_node" && s.origin.node_id !== undefined && nodeIds.has(s.origin.node_id))
      .map((s) => ({ artifact_path: s.artifact_path, start: s.start, end: s.end, node_id: s.origin.node_id! }))
      .sort((a, b) => a.artifact_path.localeCompare(b.artifact_path) || a.start - b.start || a.end - b.end);
    const links = (input.linkage?.authoritative ?? [])
      .filter((l) => l.requirement_id === r.id && hasDeterministicEvidence(l))
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path));
    const advisory_links = input.advisory
      .filter((l) => l.requirement_id === r.id)
      .map((l): AdvisoryLink => ({ advisory: true, requirement_id: l.requirement_id, path: l.path, source: l.source, note: l.note }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.note.localeCompare(b.note));
    const obligations = (input.obligations ?? [])
      .filter((o) => o.satisfies.some((id) => nodeIds.has(id)))
      .map((o): MatrixObligationCell => {
        const v = verdictBy.get(o.id);
        return {
          id: o.id,
          kind: o.kind,
          spec: o.spec,
          expected: o.expected,
          verdict: v?.verdict ?? null,
          accepted_records: v?.records.length ?? 0,
        };
      });
    return {
      id: r.id,
      text: r.text,
      origin: r.origin,
      status: r.status,
      pinned: r.pinned,
      superseded_by: r.superseded_by,
      active: r.active,
      conflicts_with: r.conflicts_with,
      sources: r.sources,
      artifact_spans,
      files: links.filter((l) => l.kind === "file"),
      tests: links.filter((l) => l.kind === "test"),
      advisory_links,
      obligations,
    };
  });

  const body = {
    matrix_version: MATRIX_VERSION,
    package_semantic_id: input.package_semantic_id,
    ir_extracted: input.ir !== null,
    repository_bound: input.linkage !== null,
    verdicts_supplied: input.verdicts !== null,
    verdicts_rejected: input.verdicts !== null && !input.verdicts.package_valid,
    caveat: verdictsUsable ? input.verdicts!.caveat : null,
    rows,
    diagnostics: [...registry.diagnostics, ...(input.linkage?.diagnostics ?? [])],
  };
  return Object.freeze({ ...body, json: `${canonicalStringify(body)}\n` });
}

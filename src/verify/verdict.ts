/**
 * The deterministic verdict (`FR-053`, `EV-R2`, `EV-R4`–`EV-R6`, `AC-047`).
 *
 * One verdict per obligation, from a fixed table, over a **validated** package
 * and untrusted evidence. There is no judgement here: no model, no score
 * (`INV-008`), no heuristic about what a test "probably" meant. The rule table
 * is `spec.md` §11.1 and `tests/property/verify-verdict.test.ts` runs it
 * exhaustively.
 *
 * The order of operations is the security property:
 *
 *   1. validate the package (`EV-R3`) — an invalid one yields **no verdicts**;
 *   2. parse the evidence as a whole (`EV-R5`) — a malformed file is refused;
 *   3. accept or reject each record (`EV-R2`, `EV-R5`);
 *   4. apply the table to what was accepted (`EV-R4`).
 *
 * Nothing in this module runs anything (`INV-004`, `AC-020`). It reads bytes it
 * was handed and hashes the caller supplied.
 */
import { rawHash } from "../ir/canonical.js";
import { diagnostic, measureEvidence, nodeEvidence, type Diagnostic } from "../ir/diagnostic.js";
import type { ProfileRegistry } from "../profile/registry.js";
import { validatePackage } from "./contract.js";
import { EVIDENCE_FORMAT_VERSION, isSafeLogPath, parseEvidence, type EvidenceRecord } from "./evidence.js";
import type { Obligation } from "./obligations.js";

export const VERDICTS = ["VERIFIED", "FAILED", "UNVERIFIED", "REVIEW_REQUIRED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REPORT_CAVEAT =
  "VERIFIED means the supplied evidence, taken at its word, shows the expected exit code. " +
  "Evidence is unsigned, so FORGE cannot detect a fabricated record whose hashes were recomputed. " +
  "FORGE executed nothing to produce this report.";

export interface RecordRef {
  /** Position in the evidence file — the citation a FAILED verdict carries. */
  readonly index: number;
  readonly runner: string;
  readonly exit_code: number | null;
  readonly stdout_hash: string | null;
  readonly stderr_hash: string | null;
  readonly repo_commit: string | null;
}

export interface ObligationVerdict {
  readonly obligation_id: string;
  readonly kind: string;
  readonly spec: string;
  readonly satisfies: readonly string[];
  readonly degraded_from: string | null;
  readonly expected_exit_code: number | null;
  readonly verdict: Verdict;
  /** The accepted records this verdict rests on. Rejected records are never here. */
  readonly records: readonly RecordRef[];
}

export interface VerdictReport {
  readonly package_valid: boolean;
  /** The validated id, or — for an invalid package — the id it claimed, labelled as such. */
  readonly package_semantic_id: string | null;
  readonly verdicts: readonly ObligationVerdict[];
  readonly diagnostics: readonly Diagnostic[];
  /** The report as written: pretty JSON with a trailing newline, byte-stable (`EV-R6`). */
  readonly json: string;
}

export interface VerifyInput {
  /** The package, path → bytes. `run.json` may be present; it is never read. */
  readonly files: ReadonlyMap<string, string>;
  /** The evidence file's bytes, exactly as supplied — hashed into the report. */
  readonly evidence: string;
  /**
   * sha256 of each log file the evidence names, as the caller read it; `null`
   * when the file could not be read. A named log absent from this map was not
   * supplied, and the record naming it is rejected.
   */
  readonly logHashes: ReadonlyMap<string, string | null>;
  readonly registry?: ProfileRegistry;
}

const count = (verdicts: readonly ObligationVerdict[], v: Verdict): number =>
  verdicts.filter((x) => x.verdict === v).length;

function render(report: Omit<VerdictReport, "json">, evidenceHash: string | null): string {
  const body = {
    report_format_version: EVIDENCE_FORMAT_VERSION,
    executed_by_forge: false,
    caveat: REPORT_CAVEAT,
    package_valid: report.package_valid,
    package_semantic_id: report.package_semantic_id,
    evidence_hash: evidenceHash,
    // Counts per verdict, never a combined figure (INV-008).
    counts: Object.fromEntries(VERDICTS.map((v) => [v, count(report.verdicts, v)])),
    verdicts: report.verdicts,
    diagnostics: report.diagnostics,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

const refOf = (r: EvidenceRecord, index: number): RecordRef =>
  Object.freeze({
    index,
    runner: r.runner,
    exit_code: r.exit_code,
    stdout_hash: r.stdout_hash,
    stderr_hash: r.stderr_hash,
    repo_commit: r.repo_commit,
  });

/** Why a record is unusable for this obligation, or null when it is usable (`EV-R5`). */
function rejection(
  r: EvidenceRecord,
  obligation: Obligation,
  logHashes: ReadonlyMap<string, string | null>,
): string | null {
  if (r.kind !== obligation.kind) {
    return `it claims kind "${r.kind}" but ${obligation.id} is "${obligation.kind}"`;
  }
  if (obligation.executable && r.exit_code === null) return "it has no exit code";
  for (const [stream, path, recorded] of [
    ["stdout", r.logs?.stdout, r.stdout_hash],
    ["stderr", r.logs?.stderr, r.stderr_hash],
  ] as const) {
    if (path === undefined) continue;
    if (!isSafeLogPath(path)) return `its ${stream} log path escapes the evidence directory`;
    const actual = logHashes.get(path);
    if (actual === undefined || actual === null) return `its ${stream} log ${path} was not supplied`;
    if (actual !== recorded) return `its ${stream} log ${path} does not match the recorded ${stream}_hash`;
  }
  return null;
}

/**
 * Validate, then evaluate. Throws `EvidenceShapeError` for a malformed evidence
 * file — only after the package validated, so a tampered package is reported
 * as such whatever the evidence looks like.
 */
export function verifyPackage(input: VerifyInput): VerdictReport {
  const validation = validatePackage(input.files, input.registry);
  if (!validation.ok) {
    const diagnostics = validation.problems.map((problem) =>
      diagnostic(
        "FORGE-V004",
        `Package rejected before any evidence was read: ${problem}.`,
        [measureEvidence("package validation problems", validation.problems.length, "count")],
      ),
    );
    const base = { package_valid: false, package_semantic_id: validation.claimedSemanticId, verdicts: [], diagnostics };
    return Object.freeze({ ...base, json: render(base, null) });
  }

  const contract = validation.contract;
  const evidence = parseEvidence(input.evidence);
  const diagnostics: Diagnostic[] = [];
  const byId = new Map(contract.obligations.map((o) => [o.id, o]));
  const accepted = new Map<string, Array<{ record: EvidenceRecord; index: number }>>();

  // Records, in file order (EV-R2, EV-R5).
  evidence.records.forEach((r, index) => {
    const obligation = byId.get(r.obligation_id);
    const cite = [nodeEvidence(r.obligation_id), measureEvidence("evidence record", index, "index")];
    if (r.package_semantic_id !== contract.semanticId) {
      diagnostics.push(
        diagnostic(
          "FORGE-V003",
          `Evidence record #${index} (${r.obligation_id}) is for package ${r.package_semantic_id.slice(0, 19)}…, ` +
            `not this one (${contract.semanticId.slice(0, 19)}…); it is ignored.`,
          cite,
        ),
      );
      return;
    }
    if (!obligation) {
      diagnostics.push(
        diagnostic("FORGE-V005", `Evidence record #${index} names obligation "${r.obligation_id}", which this package does not declare.`, cite),
      );
      return;
    }
    const why = rejection(r, obligation, input.logHashes);
    if (why) {
      diagnostics.push(diagnostic("FORGE-V005", `Evidence record #${index} for ${obligation.id} is rejected: ${why}.`, cite));
      return;
    }
    const list = accepted.get(obligation.id) ?? [];
    list.push({ record: r, index });
    accepted.set(obligation.id, list);
  });

  // The table (EV-R4), in declaration order.
  const verdicts = contract.obligations.map((o): ObligationVerdict => {
    const records = accepted.get(o.id) ?? [];
    let verdict: Verdict;
    if (!o.executable) {
      verdict = "REVIEW_REQUIRED";
    } else if (records.length === 0) {
      verdict = "UNVERIFIED";
      diagnostics.push(
        diagnostic("FORGE-V001", `${o.id} (${o.kind}) has no accepted evidence; it is unverified.`, [nodeEvidence(o.id)]),
      );
    } else {
      const failing = records.find(({ record }) => record.exit_code !== o.expected_exit_code);
      if (failing) {
        verdict = "FAILED";
        diagnostics.push(
          diagnostic(
            "FORGE-V002",
            `${o.id} (${o.kind}) failed: evidence record #${failing.index} (runner ${failing.record.runner}) ` +
              `reports exit ${failing.record.exit_code}, expected ${o.expected_exit_code}.`,
            [
              nodeEvidence(o.id),
              measureEvidence(`exit code, evidence record #${failing.index}`, failing.record.exit_code ?? -1, "exit code"),
            ],
          ),
        );
      } else {
        verdict = "VERIFIED";
      }
    }
    return Object.freeze({
      obligation_id: o.id,
      kind: o.kind,
      spec: o.spec,
      satisfies: o.satisfies,
      degraded_from: o.degraded_from,
      expected_exit_code: o.expected_exit_code,
      verdict,
      records: Object.freeze(records.map(({ record, index }) => refOf(record, index))),
    });
  });

  const base = {
    package_valid: true,
    package_semantic_id: contract.semanticId,
    verdicts: Object.freeze(verdicts),
    diagnostics: Object.freeze(diagnostics),
  };
  return Object.freeze({ ...base, json: render(base, rawHash(input.evidence)) });
}

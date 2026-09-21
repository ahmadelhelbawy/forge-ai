/**
 * Requirement governance, repository binding and traceability in the workspace
 * (V2-H, `spec.md` §22.10).
 *
 * The single workspace entry point to the V2-H core layers. It is imported only
 * by the routes that carry an explicit user action, and never by the turn
 * runtime (`AC-053`, asserted in `tests/contract/requirement-boundaries.test.ts`):
 * a model turn has no path to bind a repository, record a decision or assert a
 * link. Like `web/lib/verify.ts`, it decides nothing itself.
 *
 * No filesystem access happens here. Binding and every read go through the
 * core's `openRepository`, which returns a `WorkspaceGuard` (`INV-011`).
 */
import { randomUUID } from "node:crypto";

import {
  GovernanceDecisionSchema,
  governRequirements,
  recordDecision,
  type GovernanceRecord,
  type RequirementRegistry,
} from "forge/dist/requirement/governance.js";
import { checkAdvisoryPath, linkRequirements, type AdvisoryLink } from "forge/dist/requirement/linkage.js";
import { buildTraceabilityMatrix, type TraceabilityMatrix } from "forge/dist/requirement/traceability.js";
import { openRepository, parseRepositoryRoots } from "forge/dist/requirement/binding.js";
import type { LedgerEntry } from "forge/dist/critic/deterministic/ledger.js";
import type { WorkspaceGuard } from "forge/dist/context/workspace.js";
import type { TaskIR } from "forge/dist/ir/schema.js";

import { packageVersion } from "./package";
import { storedIr } from "./preservation";
import { ledgerEntries } from "./store";
import type {
  AdvisoryLinkRecord,
  Conversation,
  GovernanceDecisionRecord,
  RepositoryBinding,
} from "./store-types";
import { REPORT_CAVEAT, verifyVersion } from "./verify";

function allowedRoots(): string[] {
  return parseRepositoryRoots(process.env["FORGE_REPO_ROOTS"]);
}

/** RB-R1: bind explicitly. Refuses (and records nothing) unless RB-R2 admits the path. */
export function bindRepository(convo: Conversation, path: string): RepositoryBinding {
  const guard = openRepository(path, allowedRoots());
  const binding: RepositoryBinding = Object.freeze({ root: guard.root, at: new Date().toISOString() });
  convo.repository = binding;
  return binding;
}

/** RB-R1: revoke. The bind event stays in the log; the binding does not. */
export function unbindRepository(convo: Conversation): boolean {
  const was = convo.repository !== null;
  convo.repository = null;
  return was;
}

/**
 * The guard for the bound repository, or null when none is bound. The
 * allowlist is re-checked on every use (RB-R2), so narrowing it revokes access.
 */
export function boundRepository(convo: Conversation): WorkspaceGuard | null {
  if (convo.repository === null) return null;
  return openRepository(convo.repository.root, allowedRoots());
}

/* -------------------------------------------------------------------------- */
/* Governance (RG-R1–RG-R6)                                                    */
/* -------------------------------------------------------------------------- */


/** A refused user action, with the HTTP status its route should answer. */
export class RequirementActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "RequirementActionError";
  }
}

/** The current version's cached IR, or null. Never extracts: no model call (TM-R1). */
function currentIr(convo: Conversation): TaskIR | null {
  return convo.currentV > 0 ? storedIr(convo, convo.currentV) : null;
}

function governanceLog(convo: Conversation): GovernanceRecord[] {
  return convo.governance.map((g) => ({ decision: g.decision, subjects: g.subjects })) as GovernanceRecord[];
}

/** RG-R2: every requirement the conversation knows, with its derived status. */
export function requirementRegistry(convo: Conversation): RequirementRegistry {
  return governRequirements({
    ledger: ledgerEntries(convo) as readonly LedgerEntry[],
    ir: currentIr(convo),
    log: governanceLog(convo),
  });
}

/**
 * RG-R3: record one explicit human decision. Refused decisions record nothing.
 * The snapshot is built by the core from FORGE's registry; the request can name
 * only ids, and a request carrying anything else is refused whole (RG-R6).
 */
export function decideRequirement(convo: Conversation, candidate: unknown): GovernanceDecisionRecord {
  const parsed = GovernanceDecisionSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new RequirementActionError(400, `Not a governance decision: ${parsed.error.issues[0]?.message ?? "invalid"}.`);
  }
  let record: GovernanceRecord;
  try {
    record = recordDecision(
      { ledger: ledgerEntries(convo) as readonly LedgerEntry[], ir: currentIr(convo), log: governanceLog(convo) },
      parsed.data,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "GovernanceRefusal") {
      throw new RequirementActionError(409, error.message, (error as Error & { reason: string }).reason);
    }
    throw error;
  }
  const stored: GovernanceDecisionRecord = Object.freeze({
    decision: record.decision,
    subjects: record.subjects,
    at: new Date().toISOString(),
  });
  convo.governance.push(stored);
  return stored;
}

/* -------------------------------------------------------------------------- */
/* Advisory links (LK-R4)                                                      */
/* -------------------------------------------------------------------------- */

const MAX_NOTE_LENGTH = 500;

function advisoryLinks(convo: Conversation): AdvisoryLink[] {
  return convo.advisoryLinks.map((l) => ({
    advisory: true as const,
    requirement_id: l.requirementId,
    path: l.path,
    source: l.source,
    note: l.note,
  }));
}

/** Assert a link. Needs a bound repository; the path passes its guard like any read. */
export function addAdvisoryLink(
  convo: Conversation,
  input: { requirementId?: unknown; path?: unknown; note?: unknown },
): AdvisoryLinkRecord {
  if (typeof input.requirementId !== "string" || typeof input.path !== "string" || input.path.trim() === "") {
    throw new RequirementActionError(400, "An advisory link needs a requirementId and a path.");
  }
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > MAX_NOTE_LENGTH) throw new RequirementActionError(413, `A note is at most ${MAX_NOTE_LENGTH} characters.`);
  const guard = boundRepository(convo);
  if (guard === null) throw new RequirementActionError(409, "Bind a repository before asserting a link into it.");
  if (!requirementRegistry(convo).requirements.some((r) => r.id === input.requirementId)) {
    throw new RequirementActionError(404, `${input.requirementId} is not a requirement of this conversation.`);
  }
  let path: string;
  try {
    path = checkAdvisoryPath(guard, input.path.trim());
  } catch (error) {
    const reason = error instanceof Error && error.name === "GuardDeniedError" ? (error as Error & { reason: string }).reason : "read-error";
    throw new RequirementActionError(400, `WorkspaceGuard refused that path (${reason}).`, reason);
  }
  if (convo.advisoryLinks.some((l) => l.requirementId === input.requirementId && l.path === path)) {
    throw new RequirementActionError(409, "That link is already asserted.");
  }
  const link: AdvisoryLinkRecord = Object.freeze({
    id: randomUUID(),
    requirementId: input.requirementId,
    path,
    note,
    source: "user_asserted",
    at: new Date().toISOString(),
  });
  convo.advisoryLinks.push(link);
  return link;
}

export function removeAdvisoryLink(convo: Conversation, linkId: string): boolean {
  const at = convo.advisoryLinks.findIndex((l) => l.id === linkId);
  if (at === -1) return false;
  convo.advisoryLinks.splice(at, 1);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Traceability matrix (TM-R1–TM-R4)                                           */
/* -------------------------------------------------------------------------- */

/**
 * The matrix for the current version. A join over what already exists: the
 * cached IR (never extracted here), the package built from it, the verdicts of
 * pasted evidence, the bound repository's linkage and the advisory links.
 */
export async function traceabilityFor(
  convo: Conversation,
  options: { target: string; evidence?: string | null },
): Promise<TraceabilityMatrix> {
  const ir = currentIr(convo);
  const ledger = ledgerEntries(convo) as readonly LedgerEntry[];
  let package_semantic_id: string | null = null;
  let spans = null;
  let obligations = null;
  let verdicts = null;
  if (ir !== null) {
    const built = await packageVersion(convo, convo.currentV, options.target);
    const file = (path: string): unknown =>
      JSON.parse(built.package.files.find((f) => f.path === path)?.content ?? "null");
    package_semantic_id = (file("package.json") as { semantic_id: string }).semantic_id;
    spans = (file("trace.json") as { spans: [] }).spans;
    obligations = (file("verification.json") as { entries: [] }).entries;
    if (options.evidence) {
      const { report } = await verifyVersion(convo, convo.currentV, options.target, options.evidence);
      verdicts = {
        package_valid: report.package_valid,
        package_semantic_id: report.package_semantic_id,
        caveat: REPORT_CAVEAT,
        verdicts: report.verdicts,
      };
    }
  }
  const registry = governRequirements({ ledger, ir, log: governanceLog(convo) });
  const guard = boundRepository(convo);
  const linkage =
    guard === null
      ? null
      : linkRequirements(
          registry.requirements.map((r) => ({ id: r.id, text: r.text })),
          guard,
          ir === null ? {} : { scope: { include: ir.scope.include, exclude: ir.scope.exclude } },
        );
  return buildTraceabilityMatrix({
    ledger,
    ir,
    log: governanceLog(convo),
    package_semantic_id,
    spans,
    obligations,
    verdicts,
    linkage,
    advisory: advisoryLinks(convo),
  });
}

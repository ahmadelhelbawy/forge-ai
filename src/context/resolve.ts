/**
 * Context resolution orchestrator (FR-025–FR-030, CE-R1–CE-R8).
 *
 * Pipeline: per-node query derivation → candidate generation (ripgrep, glob,
 * git-history, explicit) → WorkspaceGuard reads → term-evidence confirmation
 * → role assignment → trust assignment → rank → justified ContextRefs.
 *
 * Guarantees:
 * - Every retained ref justifies itself (INV-006): `justifies` is the union
 *   of node ids whose query discovered the file or whose terms its content
 *   matches. Scope-only and evidence-free candidates are dropped, recorded
 *   in the run — never silently, never as refs.
 * - Scores, drops, redactions and provenance live in the RUN record
 *   (IR-R4, INV-013). The refs themselves carry only semantic fields, so
 *   resolution output is hash-stable and safe to merge into a Task IR.
 * - Redaction is recorded, never silent (SC-R6): files with secret findings
 *   are retained only as pointers to REDACTED content (content_hash covers
 *   the redacted bytes), and each redaction appears in `run.redactions`
 *   with rule + count, never values.
 * - `maxPasses` reserves the CE-R8 multi-pass refinement slot. Only 1 is
 *   supported in v0.1; anything else throws rather than half-running.
 */

import { ContextRefSchema, type ContextRef, type TaskIR } from "../ir/schema.js";
import { normalizeText, deriveQuery, type NodeQuery } from "./query.js";
import { rankCandidates, DEFAULT_WEIGHTS, type RankWeights } from "./rank.js";
import { assignRole } from "./roles.js";
import { assignTrust, isDocumentationPath, type SourceClass } from "./trust.js";
import { matchGlob, GuardDeniedError, type GuardFile, type WorkspaceGuard } from "./workspace.js";
import { explicitSearch, type ExplicitRequest } from "./retrievers/explicit.js";
import { gitHistorySearch } from "./retrievers/git-history.js";
import { globSearch } from "./retrievers/glob.js";
import { ripgrepSearch } from "./retrievers/ripgrep.js";
import type { CandidateHit, RetrieverId } from "./retrievers/types.js";

export interface ResolveOptions {
  readonly weights?: RankWeights;
  /** Keep at most this many refs; excess drops are recorded. Default: 50. */
  readonly maxRefs?: number;
  readonly explicit?: readonly ExplicitRequest[];
  /**
   * CE-R8 reservation: a future bounded multi-pass refinement loop goes here
   * without a schema change. v0.1 performs exactly one pass.
   */
  readonly maxPasses?: number;
}

export interface ScoreRecord {
  readonly refId: string;
  readonly relPath: string;
  readonly score: number;
  readonly lexical: number;
  readonly role: number;
  readonly git: number;
  readonly prox: number;
}

export interface DropRecord {
  readonly relPath: string;
  readonly reason: "guard-denied" | "binary" | "unjustified" | "over-cap";
  readonly detail: string;
}

export interface RedactionRecord {
  readonly relPath: string;
  readonly rules: readonly { readonly rule: string; readonly count: number }[];
}

export interface ResolutionRun {
  readonly scores: readonly ScoreRecord[];
  readonly dropped: readonly DropRecord[];
  readonly redactions: readonly RedactionRecord[];
  /** Retrieval provenance per ref: which retriever found it, for which nodes. */
  readonly provenance: readonly {
    readonly refId: string;
    readonly foundVia: readonly RetrieverId[];
    readonly matchedTerms: readonly string[];
  }[];
  readonly notes: readonly string[];
  readonly lowConfidenceRoles: readonly { readonly relPath: string; readonly role: string }[];
}

export interface ResolvedContext {
  readonly refs: readonly ContextRef[];
  readonly run: ResolutionRun;
}

export const DEFAULT_MAX_REFS = 50;

/** Every node query's terms, each term pointing at the nodes that own it. */
function queryTermIndex(queries: readonly NodeQuery[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const query of queries) {
    for (const term of query.terms) {
      const nodes = index.get(term) ?? new Set<string>();
      nodes.add(query.nodeId);
      index.set(term, nodes);
    }
  }
  return index;
}

function contentTerms(content: string, index: Map<string, Set<string>>): {
  matchedNodes: Set<string>;
  matchedTerms: Set<string>;
} {
  const matchedNodes = new Set<string>();
  const matchedTerms = new Set<string>();
  const words = new Set(normalizeText(content).split(/[^a-z0-9]+/).filter((w) => w.length > 0));
  // Substring match (not just whole-word): content holds `AuthProvider`,
  // normalized words hold `authprovider`; the query term `auth` must match.
  // Whole-word matching would miss every CamelCase compound.
  for (const [term, nodes] of index) {
    for (const word of words) {
      if (word.includes(term)) {
        matchedTerms.add(term);
        for (const node of nodes) matchedNodes.add(node);
        break;
      }
    }
  }
  return { matchedNodes, matchedTerms };
}

function scopeProximity(relPath: string, include: readonly string[], exclude: readonly string[]): number {
  if (exclude.some((g) => matchGlob(g, relPath))) return 0;
  if (include.some((g) => matchGlob(g, relPath))) return 1;
  const top = relPath.split("/")[0] ?? "";
  if (include.some((g) => g.split("/")[0] === top)) return 0.5;
  return 0;
}

interface MergedCandidate {
  foundVia: Set<RetrieverId>;
  rgNodes: Set<string>;
  explicitNodes: Set<string>;
  viaScopeGlob: boolean;
  gitRecency: number | null;
  sourceClass: SourceClass;
}

interface ScoredCandidate {
  relPath: string;
  matchedNodes: string[];
  matchedTerms: string[];
  foundVia: RetrieverId[];
  role: ContextRef["role"];
  trust: ContextRef["trust"];
  contentHash: string;
  gitRecency: number | null;
}

export function resolveContext(
  ir: TaskIR,
  guard: WorkspaceGuard,
  options: ResolveOptions = {},
): ResolvedContext {
  if (options.maxPasses !== undefined && options.maxPasses !== 1) {
    throw new Error(
      `maxPasses=${options.maxPasses} is not supported in v0.1: multi-pass refinement is deferred (CE-R8). Use maxPasses: 1.`,
    );
  }
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const maxRefs = options.maxRefs ?? DEFAULT_MAX_REFS;
  const notes: string[] = [];
  const dropped: DropRecord[] = [];
  const redactions: RedactionRecord[] = [];
  const lowConfidenceRoles: { readonly relPath: string; readonly role: string }[] = [];

  const queries = [
    ...ir.goals.map((g) =>
      deriveQuery({ id: g.id, kind: "goal", texts: [g.statement, ...g.acceptance] }),
    ),
    ...ir.constraints.map((c) => deriveQuery({ id: c.id, kind: "constraint", texts: [c.statement] })),
  ];
  const termIndex = queryTermIndex(queries);
  const justifiableIds = new Set<string>([...ir.goals.map((g) => g.id), ...ir.constraints.map((c) => c.id)]);

  // 1. Candidate generation. Discovery is never access: every path below is
  //    re-checked by the guard on read.
  const ripgrep = ripgrepSearch(guard.root, queries);
  const glob = globSearch(guard, ir.scope.include, ir.scope.exclude);
  const git = gitHistorySearch(guard.root, ir.scope.include);
  const explicit = explicitSearch(guard, options.explicit ?? [], justifiableIds);
  notes.push(...ripgrep.notes, ...glob.notes, ...git.notes, ...explicit.result.notes);
  for (const rejection of explicit.rejections) {
    dropped.push({ relPath: rejection.path, reason: "guard-denied", detail: rejection.reason });
  }

  // 2. Merge candidates across retrievers.
  const merged = new Map<string, MergedCandidate>();
  const merge = (hit: CandidateHit): void => {
    const entry = merged.get(hit.relPath) ?? {
      foundVia: new Set<RetrieverId>(),
      rgNodes: new Set<string>(),
      explicitNodes: new Set<string>(),
      viaScopeGlob: false,
      gitRecency: null as number | null,
      sourceClass: "working-tree" as SourceClass,
    };
    for (const via of hit.foundVia) entry.foundVia.add(via);
    if (hit.foundVia.includes("ripgrep")) for (const n of hit.matchedNodeIds) entry.rgNodes.add(n);
    if (hit.foundVia.includes("explicit")) for (const n of hit.matchedNodeIds) entry.explicitNodes.add(n);
    entry.viaScopeGlob = entry.viaScopeGlob || hit.viaScopeGlob;
    if (hit.gitRecency !== null) {
      entry.gitRecency = entry.gitRecency === null ? hit.gitRecency : Math.max(entry.gitRecency, hit.gitRecency);
    }
    if (hit.sourceClass === "git-history") entry.sourceClass = "git-history";
    if (hit.sourceClass === "explicit") entry.sourceClass = "explicit";
    if (hit.sourceClass === "project-docs") entry.sourceClass = "project-docs";
    merged.set(hit.relPath, entry);
  };
  for (const hit of [...ripgrep.hits, ...glob.hits, ...git.hits, ...explicit.result.hits]) merge(hit);

  // 3. Guarded read + evidence confirmation + role + trust per candidate.
  const scored: ScoredCandidate[] = [];
  for (const [relPath, entry] of [...merged.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let read: GuardFile;
    try {
      read = guard.readText(relPath);
    } catch (error) {
      const reason = error instanceof GuardDeniedError ? error.reason : "read-error";
      dropped.push({ relPath, reason: "guard-denied", detail: `WorkspaceGuard denied: ${reason}.` });
      continue;
    }
    if (read.content.indexOf(String.fromCharCode(0)) !== -1) {
      dropped.push({ relPath, reason: "binary", detail: "NUL byte in content; binary files are not context." });
      continue;
    }
    if (read.findings.length > 0) {
      redactions.push({
        relPath,
        rules: read.findings.map((f) => ({ rule: f.rule, count: f.count })),
      });
    }
    const confirmed = contentTerms(read.content, termIndex);
    const matchedNodes = new Set<string>([...entry.rgNodes, ...entry.explicitNodes, ...confirmed.matchedNodes]);
    if (matchedNodes.size === 0) {
      dropped.push({
        relPath,
        reason: "unjustified",
        detail: "in scope or recently touched, but matches no node query — justifies nothing (INV-006).",
      });
      continue;
    }
    const matchedTerms = [...confirmed.matchedTerms].sort();
    const sourceClass: SourceClass =
      entry.sourceClass === "explicit" || entry.sourceClass === "git-history"
        ? entry.sourceClass
        : isDocumentationPath(relPath)
          ? "project-docs"
          : "working-tree";
    const trust = assignTrust(sourceClass);
    const assignment = assignRole({
      relPath,
      trust,
      sourceClass,
      queryTerms: [...termIndex.keys()],
      content: read.content,
    });
    if (!assignment.confident) {
      lowConfidenceRoles.push({ relPath, role: assignment.role });
      notes.push(`role: ${relPath} → ${assignment.role} (low confidence; recorded, not guessed).`);
    }
    scored.push({
      relPath,
      matchedNodes: [...matchedNodes].sort(),
      matchedTerms,
      foundVia: [...entry.foundVia].sort() as RetrieverId[],
      role: assignment.role,
      trust,
      contentHash: read.contentHash,
      gitRecency: entry.gitRecency,
    });
  }

  // 4. Rank. Lexical strength is measured against the union of all node
  //    terms so scores are comparable across candidates.
  const totalTerms = termIndex.size;
  const ranked = rankCandidates(
    scored.map((s) => ({
      item: s,
      relPath: s.relPath,
      input: {
        lexical: totalTerms === 0 ? 0 : s.matchedTerms.length / totalTerms,
        role: s.role,
        git: s.gitRecency,
        proximity: scopeProximity(s.relPath, ir.scope.include, ir.scope.exclude),
      },
    })),
    weights,
  );

  // 5. Cap + assign ctx ids in rank order + schema-validate every ref.
  const kept = ranked.slice(0, maxRefs);
  for (const extra of ranked.slice(maxRefs)) {
    dropped.push({ relPath: extra.relPath, reason: "over-cap", detail: `ranked below maxRefs=${maxRefs}.` });
  }
  const refs: ContextRef[] = kept.map((entry, index) => {
    const ref = {
      id: `ctx${index + 1}`,
      uri: `forge://${entry.item.relPath}`,
      role: entry.item.role,
      trust: entry.item.trust,
      justifies: entry.item.matchedNodes,
      content_hash: entry.item.contentHash,
    };
    return ContextRefSchema.parse(ref);
  });

  return {
    refs,
    run: {
      scores: kept.map((entry, index) => ({
        refId: (refs[index] as ContextRef).id,
        relPath: entry.item.relPath,
        score: entry.score,
        lexical: entry.parts.lex,
        role: entry.parts.role,
        git: entry.parts.git,
        prox: entry.parts.prox,
      })),
      dropped,
      redactions,
      provenance: kept.map((entry, index) => ({
        refId: (refs[index] as ContextRef).id,
        foundVia: entry.item.foundVia,
        matchedTerms: entry.item.matchedTerms,
      })),
      notes,
      lowConfidenceRoles,
    },
  };
}

/**
 * Deterministic requirement → file/test linkage (V2-H, `FR-057`, `spec.md`
 * §22.10 LK-R1–LK-R4).
 *
 * The smallest useful answer to "where does this requirement live?": a
 * repository-relative path, whether it is a test, and the evidence that put it
 * there. Every authoritative link can be re-derived from the repository by the
 * published rule below, which is the whole point — a link a reader cannot
 * re-derive is an opinion, and opinions are advisory (LK-R4).
 *
 * Built from parts the context engine already has, rather than beside them:
 * the context query tokenizer (`FR-025`), the ripgrep, glob-walk and git-history
 * retrievers, `isTestPath`, and — for every byte read — `WorkspaceGuard`
 * (`INV-011`), which applies the path jail, ignore files, deny globs and the
 * secret scan before content is representable. Term matching runs over the
 * **redacted** content, so a term that occurs only inside a credential matches
 * nothing, and no content ever leaves this module: a link carries a path and
 * the requirement's own terms.
 *
 * No symbol graph, no index, no embeddings, no model. File-level evidence is
 * the rung this phase stands on; the next rung needs evidence this one failed.
 */
import { tokenize as queryTokens } from "../context/query.js";
import { isTestPath } from "../context/roles.js";
import { gitHistorySearch } from "../context/retrievers/git-history.js";
import { ripgrepSearch } from "../context/retrievers/ripgrep.js";
import { GuardDeniedError, matchGlob, type WorkspaceGuard } from "../context/workspace.js";
import { diagnostic, measureEvidence, type Diagnostic } from "../ir/diagnostic.js";

/** The evidence vocabulary (LK-R1). The first two create links; the last two only corroborate. */
export const LINK_EVIDENCE_TYPES = ["rg_term", "test_naming", "scope_glob", "git_history"] as const;

export type LinkEvidence =
  | {
      readonly type: "rg_term";
      readonly matched_terms: readonly string[];
      readonly matched: number;
      readonly of: number;
      readonly required: number;
    }
  | { readonly type: "test_naming"; readonly matched_terms: readonly string[] }
  | { readonly type: "scope_glob"; readonly glob: string }
  | { readonly type: "git_history"; readonly commit_position: number };

/** A link backed by deterministic evidence. `advisory` is the literal `false`. */
export interface AuthoritativeLink {
  readonly advisory: false;
  readonly requirement_id: string;
  readonly path: string;
  readonly kind: "file" | "test";
  readonly evidence: readonly LinkEvidence[];
}

/**
 * A link no rule derived — asserted by a user, or ever proposed by a model.
 * `advisory` is the literal `true`, and it never appears in `LinkageResult`: it
 * lives in its own collection (LK-R4), because a flag on a shared list is one
 * rendering bug away from looking authoritative.
 */
export interface AdvisoryLink {
  readonly advisory: true;
  readonly requirement_id: string;
  readonly path: string;
  readonly source: "user_asserted" | "model";
  readonly note: string;
}

export interface LinkageExclusion {
  readonly path: string;
  /** A WorkspaceGuard deny reason, `binary`, or `over-cap`. Never content. */
  readonly reason: string;
}

export interface LinkageRedaction {
  readonly path: string;
  readonly rules: readonly { readonly rule: string; readonly count: number }[];
}

/** Deliberately holds no advisory collection: the type makes mixing them a compile error. */
export interface LinkageResult {
  readonly authoritative: readonly AuthoritativeLink[];
  readonly excluded: readonly LinkageExclusion[];
  readonly redacted: readonly LinkageRedaction[];
  readonly notes: readonly string[];
  /** `FORGE-R003` per refused or redacted file (LK-R3). */
  readonly diagnostics: readonly Diagnostic[];
}

export interface LinkableRequirement {
  readonly id: string;
  readonly text: string;
}

export interface LinkageOptions {
  /** The IR's scope, for `scope_glob` and for bounding `git_history`. */
  readonly scope?: { readonly include: readonly string[]; readonly exclude: readonly string[] };
  readonly maxLinksPerRequirement?: number;
}

export const DEFAULT_MAX_LINKS_PER_REQUIREMENT = 25;

const SUFFIXES = ["ing", "ed", "es", "s"] as const;
const TEST_WORDS: ReadonlySet<string> = new Set(["test", "spec"]);

/** The published suffix rule (LK-R1): strip the first suffix that leaves ≥ 3 characters. */
export function reduceTerm(term: string): string {
  for (const suffix of SUFFIXES) {
    if (term.endsWith(suffix) && term.length - suffix.length >= 3) return term.slice(0, -suffix.length);
  }
  return term;
}

function reducedSet(text: string): Set<string> {
  return new Set(queryTokens(text).map(reduceTerm));
}

/** A requirement's terms: its context query terms, reduced, sorted, de-duplicated. */
export function requirementTerms(text: string): string[] {
  return [...reducedSet(text)].sort();
}

/** `max(min(2, n), ⌈0.6·n⌉)` of `n` terms must match for `rg_term` (LK-R1). */
export function requiredMatches(n: number): number {
  return Math.max(Math.min(2, n), Math.ceil(0.6 * n));
}

function readError(error: unknown): string {
  return error instanceof GuardDeniedError ? error.reason : "read-error";
}

export function linkRequirements(
  requirements: readonly LinkableRequirement[],
  guard: WorkspaceGuard,
  options: LinkageOptions = {},
): LinkageResult {
  const cap = options.maxLinksPerRequirement ?? DEFAULT_MAX_LINKS_PER_REQUIREMENT;
  const notes: string[] = [];
  const excluded = new Map<string, LinkageExclusion>();
  const redacted = new Map<string, LinkageRedaction>();
  const exclude = (path: string, reason: string): void => {
    const key = `${path}\u0000${reason}`;
    if (!excluded.has(key)) excluded.set(key, { path, reason });
  };

  // Discovery. Never access: every path is read through the guard below.
  const terms = new Map(requirements.map((r) => [r.id, requirementTerms(r.text)]));
  const queries = requirements
    .filter((r) => (terms.get(r.id) ?? []).length > 0)
    .map((r) => ({ nodeId: r.id, kind: "goal" as const, terms: terms.get(r.id)! }));
  const rg = ripgrepSearch(guard.root, queries);
  notes.push(...rg.notes);
  const rgCandidates = new Map<string, string[]>();
  for (const hit of rg.hits) {
    for (const id of hit.matchedNodeIds) rgCandidates.set(id, [...(rgCandidates.get(id) ?? []), hit.relPath]);
  }
  let testPaths: string[] = [];
  try {
    testPaths = guard.walk(".").filter(isTestPath);
  } catch (error) {
    notes.push(`test_naming unavailable: the guarded walk refused (${readError(error)}).`);
  }
  const include = options.scope?.include ?? [];
  const git = gitHistorySearch(guard.root, include.length > 0 ? include : ["."]);
  notes.push(...git.notes);
  const gitPosition = new Map(
    git.hits.filter((h) => h.gitRecency !== null).map((h) => [h.relPath, Math.round(1 / h.gitRecency!) - 1]),
  );

  // Guarded reads, cached per path: one read per file however many requirements look at it.
  const contents = new Map<string, Set<string> | null>();
  const tokensOf = (path: string): Set<string> | null => {
    if (contents.has(path)) return contents.get(path)!;
    let tokens: Set<string> | null = null;
    try {
      const file = guard.readText(path);
      if (file.content.includes(String.fromCharCode(0))) {
        exclude(path, "binary");
      } else {
        tokens = reducedSet(file.content);
        if (file.findings.length > 0) {
          redacted.set(file.relPath, { path: file.relPath, rules: file.findings.map((f) => ({ rule: f.rule, count: f.count })) });
        }
      }
    } catch (error) {
      exclude(path, readError(error));
    }
    contents.set(path, tokens);
    return tokens;
  };

  const authoritative: AuthoritativeLink[] = [];
  for (const requirement of requirements) {
    const wanted = terms.get(requirement.id) ?? [];
    if (wanted.length === 0) {
      notes.push(`linkage: ${requirement.id} has no searchable terms; it links nothing.`);
      continue;
    }
    const required = requiredMatches(wanted.length);
    const byName = new Map<string, string[]>();
    for (const path of testPaths) {
      const nameTokens = reducedSet(path);
      const matched = wanted.filter((t) => nameTokens.has(t) && !TEST_WORDS.has(t));
      if (matched.length >= Math.min(2, wanted.length)) byName.set(path, matched);
    }
    const candidates = [...new Set([...(rgCandidates.get(requirement.id) ?? []), ...byName.keys()])].sort();

    const links: AuthoritativeLink[] = [];
    for (const path of candidates) {
      const content = tokensOf(path);
      if (content === null) continue;
      const evidence: LinkEvidence[] = [];
      const matched = wanted.filter((t) => content.has(t));
      if (matched.length >= required) {
        evidence.push({ type: "rg_term", matched_terms: matched, matched: matched.length, of: wanted.length, required });
      }
      const named = byName.get(path);
      if (named) evidence.push({ type: "test_naming", matched_terms: named });
      // Absence of evidence produces no link (LK-R1).
      if (evidence.length === 0) continue;
      // Corroboration only: attached to a link that already exists.
      const glob = include.find((g) => matchGlob(g, path));
      if (glob !== undefined && !(options.scope?.exclude ?? []).some((g) => matchGlob(g, path))) {
        evidence.push({ type: "scope_glob", glob });
      }
      const position = gitPosition.get(path);
      if (position !== undefined) evidence.push({ type: "git_history", commit_position: position });
      links.push({ advisory: false, requirement_id: requirement.id, path, kind: isTestPath(path) ? "test" : "file", evidence });
    }
    authoritative.push(...links.slice(0, cap));
    for (const extra of links.slice(cap)) exclude(extra.path, "over-cap");
  }

  const exclusions = [...excluded.values()].sort((a, b) => a.path.localeCompare(b.path) || a.reason.localeCompare(b.reason));
  const redactions = [...redacted.values()].sort((a, b) => a.path.localeCompare(b.path));
  const diagnostics: Diagnostic[] = [];
  for (const e of exclusions.filter((x) => x.reason !== "over-cap")) {
    diagnostics.push(
      diagnostic(
        "FORGE-R003",
        `Linkage excluded ${e.path}: WorkspaceGuard refused it (${e.reason}). It is linked to nothing (LK-R3).`,
        [measureEvidence("excluded_files", 1, "file")],
      ),
    );
  }
  for (const r of redactions) {
    diagnostics.push(
      diagnostic(
        "FORGE-R003",
        `Linkage read ${r.path} with content redacted by the secret scanner (${r.rules
          .map((x) => `${x.rule} x${x.count}`)
          .join(", ")}); terms were matched on the redacted text only (LK-R3, SC-R6).`,
        [measureEvidence("redactions", r.rules.reduce((sum, x) => sum + x.count, 0), "occurrences")],
      ),
    );
  }
  return Object.freeze({
    authoritative: Object.freeze(authoritative),
    excluded: Object.freeze(exclusions),
    redacted: Object.freeze(redactions),
    notes: Object.freeze(notes),
    diagnostics: Object.freeze(diagnostics),
  });
}

/**
 * Check a path a user asserts as an advisory link (LK-R4): it must pass the
 * bound repository's guard like any read. Returns the normalised relative path;
 * throws `GuardDeniedError` otherwise. Nothing read is returned.
 */
export function checkAdvisoryPath(guard: WorkspaceGuard, requested: string): string {
  return guard.readText(requested).relPath;
}

/**
 * Deterministic role assignment (FR-028, docs/architecture.md §10.4).
 *
 * A documented rule table maps (path, trust, query evidence, content) to a
 * ContextRole. Where the table is low-confidence it says so explicitly — the
 * caller emits an informational diagnostic rather than guessing silently.
 *
 * Rule order is load-bearing and tested: a test-path match wins over a
 * symbol-declaration match, because a test that MENTIONS a symbol is not its
 * definition, while a path under a test glob is explicitly an example.
 */

import type { ContextRole, TrustTier } from "../ir/vocabulary.js";
import { isDocumentationPath, type SourceClass } from "./trust.js";
import { matchGlob } from "./workspace.js";

export const TEST_GLOBS: readonly string[] = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/test/**",
  "**/tests/**",
  "**/__tests__/**",
];

export function isTestPath(relPath: string): boolean {
  return TEST_GLOBS.some((g) => matchGlob(g, relPath));
}

export interface RoleInput {
  readonly relPath: string;
  readonly trust: TrustTier;
  readonly sourceClass: SourceClass;
  /** Union of normalized query terms (from all matched nodes) to look for. */
  readonly queryTerms: readonly string[];
  /** Redacted file content. Never raw bytes when secrets are present. */
  readonly content: string;
}

export interface RoleAssignment {
  readonly role: ContextRole;
  /** False when no rule fired confidently — the caller records, not guesses. */
  readonly confident: boolean;
  /** Which rule fired, for the run record. Stable strings. */
  readonly reason:
    | "git-history"
    | "test-path"
    | "untrusted-docs-restricted"
    | "documentation-source"
    | "symbol-declaration"
    | "background-default";
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Declaration patterns across the languages FORGE v0.1 targets. A term counts
 * as DECLARED when it is the defined name — `function login`, `class
 * AuthProvider`, `interface Session`, `const createSession`, `def refresh` —
 * not when it merely appears. Matching is case-insensitive on whole words so
 * `authprovider` in a query finds `AuthProvider` in the file.
 */
const DECLARATION_KINDS = "function|class|interface|type|enum|const|let|var|def|trait|struct";

export function declaresSymbol(content: string, term: string): boolean {
  const pattern = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:${DECLARATION_KINDS})\\s+${escapeRegExp(term)}\\b`,
    "i",
  );
  return pattern.test(content);
}

export function assignRole(input: RoleInput): RoleAssignment {
  if (input.sourceClass === "git-history") {
    return { role: "background", confident: true, reason: "git-history" };
  }
  if (isTestPath(input.relPath)) {
    return { role: "example", confident: true, reason: "test-path" };
  }
  if (isDocumentationPath(input.relPath)) {
    // SC-R1 mechanism 3: an untrusted ref may not hold `constraint_source`
    // (C053). Restrict first, then assign.
    if (input.trust === "untrusted") {
      return { role: "background", confident: true, reason: "untrusted-docs-restricted" };
    }
    return { role: "constraint_source", confident: true, reason: "documentation-source" };
  }
  for (const term of input.queryTerms) {
    if (declaresSymbol(input.content, term)) {
      return { role: "definition", confident: true, reason: "symbol-declaration" };
    }
  }
  // Terms matched (the file was retrieved for a reason) but no rule fires:
  // background with low confidence, recorded by the caller (FR-028).
  return { role: "background", confident: false, reason: "background-default" };
}

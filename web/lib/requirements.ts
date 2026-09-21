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
import { openRepository, parseRepositoryRoots } from "forge/dist/requirement/binding.js";
import type { WorkspaceGuard } from "forge/dist/context/workspace.js";

import type { Conversation, RepositoryBinding } from "./store-types";

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

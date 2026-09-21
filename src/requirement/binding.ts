/**
 * Repository binding (V2-H, `FR-056`, `spec.md` §22.10 RB-R1–RB-R3).
 *
 * Binding gives the served workspace filesystem reach it has never had, so this
 * module adds no filesystem access of its own. Both the requested path and each
 * allowed root are opened through `WorkspaceGuard.open`, which already resolves
 * a directory through symlinks exactly once; containment is then a comparison of
 * two real paths. Every later read goes through the guard this returns
 * (`INV-011`): path jail, symlink-escape check, ignore files, deny globs and
 * `scanSecrets`, in the order the guard already enforces.
 *
 * The allowlist is the operator's (RB-R2). A served workspace that could bind
 * any directory it was handed would be a file browser for whoever can reach the
 * port; with no allowlist configured, nothing binds.
 */
import { delimiter, isAbsolute, relative, sep } from "node:path";

import { GuardDeniedError, WorkspaceGuard, type GuardConfig } from "../context/workspace.js";

export type BindingRefusalReason =
  | "not-configured"
  | "not-absolute"
  | "traversal"
  | "missing"
  | "not-a-directory"
  | "outside-allowlist";

export class RepositoryBindingRefused extends Error {
  constructor(
    readonly reason: BindingRefusalReason,
    message: string,
  ) {
    super(`Repository binding refused (${reason}): ${message}`);
    this.name = "RepositoryBindingRefused";
  }
}

/** `FORGE_REPO_ROOTS`, split on the platform path delimiter. Empty entries are dropped. */
export function parseRepositoryRoots(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(delimiter).map((s) => s.trim()).filter((s) => s.length > 0);
}

function openDirectory(path: string): WorkspaceGuard | null {
  try {
    return WorkspaceGuard.open(path);
  } catch (error) {
    if (error instanceof GuardDeniedError) return null;
    throw error;
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Open a repository for binding, or refuse with the reason. The returned guard
 * is the only way anything reads from it.
 */
export function openRepository(
  requested: string,
  allowedRoots: readonly string[],
  config: GuardConfig = {},
): WorkspaceGuard {
  if (allowedRoots.length === 0) {
    throw new RepositoryBindingRefused(
      "not-configured",
      "no repository roots are allowed. The operator enables binding by listing parent directories in FORGE_REPO_ROOTS.",
    );
  }
  if (!isAbsolute(requested)) {
    throw new RepositoryBindingRefused("not-absolute", "the repository path must be absolute.");
  }
  // Refused as written, before resolution: a path that spells an escape is not
  // made acceptable by happening to resolve somewhere allowed.
  if (requested.replace(/\\/g, "/").split("/").includes("..")) {
    throw new RepositoryBindingRefused("traversal", "the repository path may not contain '..'.");
  }
  let guard: WorkspaceGuard;
  try {
    guard = WorkspaceGuard.open(requested, config);
  } catch (error) {
    if (error instanceof GuardDeniedError) {
      throw new RepositoryBindingRefused(
        error.reason === "not-a-file" ? "not-a-directory" : "missing",
        error.reason === "not-a-file" ? "the path is not a directory." : "the path does not exist.",
      );
    }
    throw error;
  }
  const allowed = allowedRoots
    .filter((root) => isAbsolute(root))
    .map(openDirectory)
    .filter((g): g is WorkspaceGuard => g !== null);
  if (!allowed.some((root) => inside(root.root, guard.root))) {
    throw new RepositoryBindingRefused(
      "outside-allowlist",
      "the path resolves outside every allowed root in FORGE_REPO_ROOTS.",
    );
  }
  return guard;
}

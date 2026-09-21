/**
 * Writing a package to disk, relocatably (`FR-046`, `PK-R7`).
 *
 * Two properties, both enforced rather than intended.
 *
 * **No absolute paths.** `PK-R7` calls this portability, and it is also
 * privacy: an absolute path in an exported package discloses a username and a
 * directory layout to whoever receives it. Nothing assembled here contains one,
 * and `verifyRelocatable` asserts it over the bytes rather than trusting that.
 *
 * **No escape from the output directory.** Artifact paths come from a profile's
 * topology, which is repository data a contributor edits (`PS-R5`). A topology
 * declaring `../../.ssh/config` must not be able to write there, so every path
 * is checked before anything is created. This is the same reasoning as
 * `WorkspaceGuard`'s path jail, applied on the way out instead of the way in.
 *
 * `run.json` is written **last**, after every semantic file, so a crash during
 * export leaves a package that is visibly incomplete rather than one that looks
 * finished and is not.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import type { ExecutionPackage, PackageFile } from "./assemble.js";

export class UnsafePackagePathError extends Error {
  constructor(path: string) {
    super(
      `Refusing to write package file ${JSON.stringify(path)}: it escapes the output ` +
        `directory. Artifact paths come from a profile topology, which is editable ` +
        `repository data, so this is checked rather than assumed (PK-R7).`,
    );
    this.name = "UnsafePackagePathError";
  }
}

/** Absolute paths, drive letters, and `..` traversal are all refused. */
function safeJoin(root: string, relative: string): string {
  if (relative.startsWith("/") || /^[a-zA-Z]:/.test(relative)) throw new UnsafePackagePathError(relative);
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) throw new UnsafePackagePathError(relative);
  return target;
}

export interface ExportResult {
  readonly root: string;
  readonly paths: readonly string[];
}

export function exportPackage(pkg: ExecutionPackage, outDir: string): ExportResult {
  const root = resolve(outDir);
  const write = (f: PackageFile): string => {
    const target = safeJoin(root, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content, "utf8");
    return f.path;
  };
  // Validate every path before creating anything, so a refusal leaves no
  // half-written directory behind.
  for (const f of [...pkg.files, pkg.run]) safeJoin(root, f.path);

  const paths = pkg.files.map(write);
  // Last (PK-R3): an interrupted export is then visibly incomplete.
  write(pkg.run);
  return { root, paths: [...paths, pkg.run.path] };
}

/**
 * Assert the package's own bytes contain no absolute path (`PK-R7`).
 *
 * Checked over content rather than over the paths, because the leak that
 * matters is a `/home/someone/...` string inside a JSON field — a filesystem
 * scope, a diagnostic message, an artifact body — not the filenames, which this
 * module controls.
 */
export function verifyRelocatable(pkg: ExecutionPackage): readonly string[] {
  const problems: string[] = [];
  const absolute = /(^|["\s:])(\/(?:home|Users|root|var|tmp|opt)\/|[A-Za-z]:\\)/;
  for (const f of [...pkg.files, pkg.run]) {
    const match = absolute.exec(f.content);
    if (match) problems.push(`${f.path} contains an absolute path near ${JSON.stringify(match[0])}`);
  }
  return problems;
}

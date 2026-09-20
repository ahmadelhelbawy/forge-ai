/**
 * Path-jail suite (SC-R3, SC-R4, AC-015) plus the INV-011 filesystem-gateway
 * scan (AC-011).
 *
 * Jail tests run against isolated temp workspaces. The checked-in
 * `fixtures/repos/small` workspace covers the ignore-rule matrix
 * (.gitignore allow/deny/negation, .forgeignore, deny globs).
 */
import { readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SecretInlineError } from "../../src/context/secrets.js";

import { GuardDeniedError, WorkspaceGuard } from "../../src/context/workspace.js";
import { makeWorkspace, SMALL_REPO } from "../helpers/context.js";

function deniedReason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GuardDeniedError);
    return (error as GuardDeniedError).reason;
  }
  throw new Error("expected a GuardDeniedError");
}

describe("WorkspaceGuard path jail (AC-015)", () => {
  it("denies absolute paths", () => {
    const guard = WorkspaceGuard.open(makeWorkspace({ "a.ts": "x\n" }));
    expect(deniedReason(() => guard.readText("/etc/passwd"))).toBe("absolute-path");
  });

  it("denies parent traversal", () => {
    const guard = WorkspaceGuard.open(makeWorkspace({ "a.ts": "x\n" }));
    expect(deniedReason(() => guard.readText("../outside.ts"))).toBe("traversal");
    expect(deniedReason(() => guard.readText("sub/../../outside.ts"))).toBe("traversal");
  });

  it("denies symlink escapes", () => {
    const outside = makeWorkspace({ "secret.txt": "outside\n" });
    const root = makeWorkspace({ "a.ts": "x\n" });
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    const guard = WorkspaceGuard.open(root);
    expect(deniedReason(() => guard.readText("link.txt"))).toBe("symlink-escape");
  });

  it("denies missing files and directories distinctly", () => {
    const guard = WorkspaceGuard.open(makeWorkspace({ "a.ts": "x\n", "sub/b.ts": "y\n" }));
    expect(deniedReason(() => guard.readText("nope.ts"))).toBe("missing");
    expect(deniedReason(() => guard.readText("sub"))).toBe("not-a-file");
  });

  it("denies gitignored files and honors negation", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    expect(deniedReason(() => guard.readText("debug.log"))).toBe("ignored");
    expect(deniedReason(() => guard.readText("node_modules/stub/index.js"))).toBe("ignored");
    // `!keep.log` re-includes: readable.
    expect(guard.readText("keep.log").relPath).toBe("keep.log");
  });

  it("denies .forgeignore entries", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    expect(deniedReason(() => guard.readText("scratch/notes.txt"))).toBe("ignored");
  });

  it("denies secret-adjacent paths by glob", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    expect(deniedReason(() => guard.readText(".env"))).toBe("denied-glob");
  });

  it("walk skips denied entries and caps runaway listings", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const listed = guard.walk(".");
    expect(listed).not.toContain(".env");
    expect(listed).not.toContain("debug.log");
    expect(listed).not.toContain("scratch/notes.txt");
    expect(listed).toContain("keep.log");
    expect(listed).toContain("src/auth.ts");
    expect(listed).toEqual([...listed].sort());
    const capped = WorkspaceGuard.open(SMALL_REPO, { maxWalkFiles: 1 });
    expect(deniedReason(() => capped.walk("."))).toBe("walk-limit");
  });

  it("refuses inline reads of secret-bearing files (SC-R6)", () => {
    const guard = WorkspaceGuard.open(
      makeWorkspace({ "src/k.ts": 'export const k = "AKIAIOSFODNN7EXAMPLE"; // login key\n' }),
    );
    // Representable redacted, but never inlinable.
    expect(guard.readText("src/k.ts").findings).toHaveLength(1);
    expect(() => guard.readInline("src/k.ts")).toThrow(SecretInlineError);
  });
});

describe("filesystem gateway scan (AC-011, INV-011)", () => {
  /**
   * Context reads flow through WorkspaceGuard alone. First-party config
   * reads (CLI inputs, profile YAML, cassettes, prompt template) are NOT
   * context and are allowlisted per file with the reason inline. Anything
   * else importing `fs` fails this test — add the guard, not an exception.
   */
  const CONFIG_READS: Record<string, string> = {
    "src/context/workspace.ts": "the guard itself",
    "src/cli/index.ts": "reads the user-supplied IR file; writes artifacts",
    "src/cli/task.ts": "writes artifacts to --out",
    "src/cli/context.ts": "reads the user-supplied IR file",
    "src/cli/ir.ts": "reads the user-supplied IR file (shared helper)",
    "src/profile/registry.ts": "reads profile YAML",
    "src/strategy/registry.ts": "reads strategy archetype YAML",
    "src/model/cassette.ts": "reads/writes replay cassettes",
    "src/intent/extract.ts": "reads the versioned prompt template",
    // V2-C store (PS-R1). First-party store I/O under an operator-configured
    // root, never workspace context: no user string reaches a path segment.
    // Object filenames come from a hash that `objects.ts` validates before
    // touching the filesystem (see tests/store/objects.test.ts, which asserts
    // a traversal attempt is refused); run-log filenames come from the clock;
    // the index filename is a constant.
    "src/store/objects.ts": "writes/reads content-addressed objects in the store",
    "src/store/runlog.ts": "appends to the store's own run log",
    "src/store/index-store.ts": "builds the derivable index file",
  };

  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...tsFiles(abs));
      else if (entry.name.endsWith(".ts")) out.push(abs);
    }
    return out;
  }

  it("no src module outside the allowlist imports node:fs", () => {
    const root = join(SMALL_REPO, "..", "..", "..");
    const offenders: string[] = [];
    for (const file of tsFiles(join(root, "src"))) {
      const content = readFileSync(file, "utf8");
      if (/from\s+["']node:fs/.test(content) || /require\(["'](?:node:)?fs["']\)/.test(content)) {
        const rel = file.slice(root.length + 1);
        if (!(rel in CONFIG_READS)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no src/context module besides the guard imports node:fs", () => {
    const root = join(SMALL_REPO, "..", "..", "..");
    const offenders: string[] = [];
    for (const file of tsFiles(join(root, "src", "context"))) {
      const content = readFileSync(file, "utf8");
      if (/from\s+["']node:fs/.test(content)) offenders.push(file.slice(root.length + 1));
    }
    expect(offenders).toEqual(["src/context/workspace.ts"]);
  });
});

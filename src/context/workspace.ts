/**
 * WorkspaceGuard — the SOLE filesystem gateway for context (INV-011).
 *
 * Nothing else in `src/` performs filesystem access FOR CONTEXT. (CLI input
 * files, profile YAML, and cassettes are first-party configuration, not
 * context — see the note on `profile/registry.ts`.) Fixed order, fail-closed:
 *
 *   resolve absolute → realpath → assert workspace-root prefix (symlink
 *   escapes denied) → ignore rules → deny globs → read → secret scan →
 *   trust assignment → representable as context.
 *
 * Content is not representable until every step has passed. Secret-bearing
 * content is representable only in REDACTED form; `readInline` refuses it
 * outright (SC-R6: a secret that would be inlined is a hard error).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  type Dirent,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { SecretInlineError, scanSecrets, type SecretFinding } from "./secrets.js";
import { assignTrust, type SourceClass } from "./trust.js";

/** Why a read was refused. Stable strings — tests and CLI match on them. */
export type DenyReason =
  | "absolute-path"
  | "traversal"
  | "outside-root"
  | "symlink-escape"
  | "ignored"
  | "denied-glob"
  | "missing"
  | "not-a-file"
  | "walk-limit";

export class GuardDeniedError extends Error {
  constructor(
    readonly path: string,
    readonly reason: DenyReason,
  ) {
    super(`WorkspaceGuard denied ${JSON.stringify(path)}: ${reason}.`);
    this.name = "GuardDeniedError";
  }
}

export interface GuardConfig {
  /** Extra deny globs beyond the built-in set (matched against `/`-joined rel paths). */
  readonly denyGlobs?: readonly string[];
  /** Skip `.gitignore`/`.forgeignore` (tests only — production always honors them). */
  readonly honorIgnoreFiles?: boolean;
  /** Cap for `walk()` results; excess is an error, never a silent truncation. */
  readonly maxWalkFiles?: number;
}

/**
 * Built-in deny set (SC-R4). Secrets-adjacent paths are unreadable as context
 * no matter what asks: `.env*`, key/certificate extensions, the `.git`
 * object store (which contains every version of every file ever committed),
 * and common credential filenames.
 */
export const BUILTIN_DENY_GLOBS: readonly string[] = [
  "**/.git/**",
  ".git",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/*.cert",
  "**/*.crt",
  "**/*.pfx",
  "**/*.p12",
  "**/*.keystore",
  "**/credentials.json",
  "**/secrets.yaml",
  "**/secrets.yml",
  "**/secrets.json",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/*.kdbx",
];

/** A file that survived every gate, in its representable (redacted) form. */
export interface GuardFile {
  /** Workspace-relative, `/`-separated. */
  readonly relPath: string;
  /** `forge://<relPath>` — the ContextRef URI. */
  readonly uri: string;
  /** Redacted UTF-8 content. Never the raw bytes when secrets are present. */
  readonly content: string;
  readonly findings: readonly SecretFinding[];
  /** `sha256:<hex>` over the REDACTED bytes — what is representable is what is hashed. */
  readonly contentHash: string;
  readonly trustHint: SourceClass;
}

/* -------------------------------------------------------------------------- */
/* Ignore files                                                                */
/* -------------------------------------------------------------------------- */

interface IgnoreRule {
  readonly negate: boolean;
  readonly dirOnly: boolean;
  readonly anchored: boolean;
  readonly pattern: RegExp;
  /** The literal directory path for dir-only rules (beneath-directory matching). */
  readonly literalBase: string | null;
}

function globToRegExp(glob: string): RegExp {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        // "**/" matches zero or more directories; trailing "**" matches all.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i += 1;
    } else if ("\\.+^${}()|[]".includes(ch)) {
      out += `\\${ch}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Parse one gitignore-style file into rules. Supports the working subset:
 * blank lines, `#` comments, `*`/`?`/`**`, trailing-`/` dir-only, leading-`/`
 * anchoring, and `!` negation with last-match-wins. Anything outside the
 * subset is treated as a literal filename — fail-closed toward ignoring,
 * never toward exposing.
 */
export function parseIgnoreFile(content: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "" || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    const body = negate ? line.slice(1).trim() : line.trim();
    if (body === "" || body.includes("***")) continue;
    const dirOnly = body.endsWith("/");
    const stripped = dirOnly ? body.slice(0, -1) : body;
    const anchored = stripped.startsWith("/") || stripped.includes("/");
    const core = anchored && stripped.startsWith("/") ? stripped.slice(1) : stripped;
    // A dir-only rule with wildcards cannot name a literal base; such rules
    // match directory names only, and descent handles the rest.
    const literalBase = dirOnly && !/[ *?[]/.test(core) ? core : null;
    rules.push({ negate, dirOnly, anchored, pattern: globToRegExp(core), literalBase });
  }
  return rules;
}

/** Last matching rule wins; negation re-includes. Matches gitignore order semantics. */
export function isIgnored(rules: readonly IgnoreRule[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  const segments = relPath.split("/");
  // Parent directories of the path (the path itself when it is a directory).
  const dirs = isDir ? segments : segments.slice(0, -1);
  for (const rule of rules) {
    let hit: boolean;
    if (rule.dirOnly && rule.literalBase !== null) {
      hit = rule.anchored
        ? relPath === rule.literalBase || relPath.startsWith(`${rule.literalBase}/`)
        : dirs.some((segment) => segment === rule.literalBase);
    } else if (rule.dirOnly) {
      hit = dirs.some((segment) => rule.pattern.test(segment));
    } else {
      hit = rule.anchored
        ? rule.pattern.test(relPath)
        : segments.some((segment, index) => {
            return (
              rule.pattern.test(segment) || rule.pattern.test(segments.slice(index).join("/"))
            );
          });
    }
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

/** Match a rel path against one `**`-capable glob. */
export function matchGlob(glob: string, relPath: string): boolean {
  // Leading "**/" also matches the bare path (`**/.env*` matches `.env`).
  const stripped = glob.startsWith("**/") ? glob.slice(3) : null;
  if (globToRegExp(glob).test(relPath)) return true;
  if (stripped !== null && globToRegExp(stripped).test(relPath)) return true;
  // A bare directory glob (`secrets`) matches everything beneath it.
  if (!glob.includes("*") && !glob.includes("?") && (relPath === glob || relPath.startsWith(`${glob}/`))) {
    return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* The guard                                                                   */
/* -------------------------------------------------------------------------- */

export class WorkspaceGuard {
  readonly root: string;
  private readonly denyGlobs: readonly string[];
  private readonly ignoreRules: readonly IgnoreRule[];
  private readonly maxWalkFiles: number;

  private constructor(
    root: string,
    denyGlobs: readonly string[],
    ignoreRules: readonly IgnoreRule[],
    maxWalkFiles: number,
  ) {
    this.root = root;
    this.denyGlobs = denyGlobs;
    this.ignoreRules = ignoreRules;
    this.maxWalkFiles = maxWalkFiles;
  }

  /** Open a workspace root. The root itself is resolved through symlinks once. */
  static open(root: string, config: GuardConfig = {}): WorkspaceGuard {
    const absolute = resolve(root);
    let real: string;
    try {
      real = realpathSync(absolute);
    } catch {
      throw new GuardDeniedError(root, "missing");
    }
    if (!statSync(real).isDirectory()) throw new GuardDeniedError(root, "not-a-file");
    const denyGlobs = [...BUILTIN_DENY_GLOBS, ...(config.denyGlobs ?? [])];
    const honor = config.honorIgnoreFiles ?? true;
    const ignoreRules: IgnoreRule[] = [];
    if (honor) {
      for (const name of [".gitignore", ".forgeignore"]) {
        const file = join(real, name);
        if (existsSync(file)) {
          ignoreRules.push(...parseIgnoreFile(readFileSync(file, "utf8")));
        }
      }
    }
    return new WorkspaceGuard(real, denyGlobs, ignoreRules, config.maxWalkFiles ?? 5000);
  }

  /** Resolve a user-supplied path to an absolute path inside the root. Throws on escape. */
  private resolveInside(requested: string): { absolute: string; rel: string } {
    if (isAbsolute(requested)) throw new GuardDeniedError(requested, "absolute-path");
    const normalized = requested.replace(/\\/g, "/");
    if (normalized.split("/").includes("..")) throw new GuardDeniedError(requested, "traversal");
    if (normalized === "" || normalized === ".") throw new GuardDeniedError(requested, "missing");
    const absolute = resolve(this.root, normalized);
    // realpath follows symlinks: a link pointing outside fails the prefix check.
    let real: string;
    try {
      real = realpathSync(absolute);
    } catch {
      throw new GuardDeniedError(requested, "missing");
    }
    const rel = relative(this.root, real);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new GuardDeniedError(requested, "symlink-escape");
    }
    if (rel === "") throw new GuardDeniedError(requested, "missing");
    return { absolute: real, rel: rel.split(sep).join("/") };
  }

  private checkLists(requested: string, rel: string, isDir: boolean): void {
    if (isIgnored(this.ignoreRules, rel, isDir)) throw new GuardDeniedError(requested, "ignored");
    for (const glob of this.denyGlobs) {
      if (matchGlob(glob, rel)) throw new GuardDeniedError(requested, "denied-glob");
    }
  }

  /**
   * Read a file for context. Returns the REDACTED representable form plus
   * secret findings (rule + count, never values). Throws GuardDeniedError
   * when any gate fails.
   */
  readText(requested: string, trustHint: SourceClass = "working-tree"): GuardFile {
    const { rel } = this.resolveInside(requested);
    this.checkLists(requested, rel, false);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(join(this.root, rel.split("/").join(sep)));
    } catch {
      throw new GuardDeniedError(requested, "missing");
    }
    if (!st.isFile()) throw new GuardDeniedError(requested, "not-a-file");
    const raw = readFileSync(join(this.root, rel.split("/").join(sep)), "utf8");
    const scan = scanSecrets(raw);
    return {
      relPath: rel,
      uri: `forge://${rel}`,
      content: scan.redacted,
      findings: scan.findings,
      contentHash: `sha256:${createHash("sha256").update(scan.redacted, "utf8").digest("hex")}`,
      trustHint,
    };
  }

  /**
   * Read a file for INLINING. Refuses with SecretInlineError when secrets are
   * present (SC-R6) — the mechanism the future by_value path will call. No
   * P2 artifact carries bodies, so this fires only through direct API use,
   * tested here.
   */
  readInline(requested: string): string {
    const file = this.readText(requested);
    if (file.findings.length > 0) throw new SecretInlineError(file.relPath, file.findings);
    return file.content;
  }

  /**
   * List representable files under a (possibly glob) path, for the glob
   * retriever. Deterministic lexical order. Denied/ignored entries are
   * skipped (walk is discovery, not access — but every returned path remains
   * subject to the full gate on read).
   */
  walk(requested = "."): string[] {
    const out: string[] = [];
    const queue: string[] =
      requested === "." || requested === "" ? [""] : [requested.replace(/\\/g, "/")];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      const abs = current === "" ? this.root : join(this.root, current.split("/").join(sep));
      let entries: Dirent[];
      try {
        entries = readdirSync(abs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = current === "" ? entry.name : `${current}/${entry.name}`;
        if (seen.has(rel)) continue;
        seen.add(rel);
        const isDir = entry.isDirectory() && !entry.isSymbolicLink();
        if (isIgnored(this.ignoreRules, rel, isDir)) continue;
        if (this.denyGlobs.some((g) => matchGlob(g, rel))) continue;
        if (entry.isDirectory()) {
          // Symlinked directories are never descended into: their targets are
          // checked per-file on read instead (fail-closed discovery).
          if (!entry.isSymbolicLink()) queue.push(rel);
          continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        out.push(rel);
        if (out.length > this.maxWalkFiles) {
          throw new GuardDeniedError(requested, "walk-limit");
        }
      }
    }
    return out.sort();
  }

  /** Test + debug helper: a volatile run id that never enters semantic state. */
  static runId(): string {
    return randomUUID();
  }
}

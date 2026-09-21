/**
 * `PK-R8` / `AC-045`: a package is readable by a stranger.
 *
 * "Consuming a package requires only JSON parsing and the published JSON
 * Schema. No FORGE runtime is needed to read one." That is the claim that keeps
 * the open-source promise honest — a package must not be a blob only its author
 * can open — and it is the easiest claim in the repository to believe falsely,
 * because every other test has FORGE in scope.
 *
 * So this file **imports nothing from `src/`**. It reads an exported directory
 * and the published schemas from disk, with `node:fs`, `node:crypto` and
 * `JSON.parse`. A guard below asserts the absence of FORGE imports over this
 * file's own source, so the property cannot decay into a convenience import
 * during a later edit.
 *
 * The package under test is produced by `web/scripts/…`-style fixture setup?
 * No — by the CLI, in a temp directory, through `execFile`. Building it in
 * process would mean importing the assembler, which is the thing this test is
 * not allowed to do.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = fileURLToPath(import.meta.url);

let packageDir: string;

/** Every file in the exported directory, as package-relative POSIX paths. */
function walk(root: string, base = root): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, base));
    else found.push(relative(base, full).split(sep).join("/"));
  }
  return found.sort();
}

const read = (name: string): string => readFileSync(join(packageDir, name), "utf8");
const parse = <T>(name: string): T => JSON.parse(read(name)) as T;

beforeAll(() => {
  packageDir = join(mkdtempSync(join(tmpdir(), "forge-portable-")), "pkg");
  execFileSync(
    "npx",
    [
      "tsx", join(REPO_ROOT, "src", "cli", "index.ts"),
      "package",
      "--ir", join(REPO_ROOT, "fixtures", "ir", "auth-debug.json"),
      "--target", "claude-code",
      "--out", packageDir,
    ],
    { cwd: REPO_ROOT, stdio: "pipe" },
  );
}, 120_000);

describe("a package is consumable with JSON parsing alone (PK-R8)", () => {
  it("this test imports no FORGE module", () => {
    const source = readFileSync(SELF, "utf8");
    // Any import reaching into the implementation would make the claim vacuous.
    expect(source).not.toMatch(/from\s+["'].*\/src\//);
    expect(source).not.toMatch(/from\s+["']forge/);
  });

  it("parses every file with JSON.parse and nothing else", () => {
    for (const name of walk(packageDir)) {
      if (!name.endsWith(".json")) continue;
      expect(() => JSON.parse(readFileSync(join(packageDir, name), "utf8")), `${name}`).not.toThrow();
    }
  });

  it("contains the layout spec.md §11 declares (PK-R1)", () => {
    const files = walk(packageDir);
    for (const required of [
      "package.json", "task-ir.json", "strategy.json", "requirements.json",
      "trace.json", "provenance.json", "runtime-contract.json",
      "verification.json", "diagnostics.json", "run.json",
    ]) {
      expect(files, `missing ${required}`).toContain(required);
    }
    expect(files.some((f) => f.startsWith("artifacts/"))).toBe(true);
  });

  /**
   * The point of `PK-R2`'s hash list: a recipient detects tampering without
   * FORGE and without recompiling. Verified here the way a stranger would —
   * `sha256` over the file's bytes, no canonicalization required.
   */
  it("lets a stranger verify every content hash with sha256 over the bytes", () => {
    const manifest = parse<{ files: Array<{ path: string; content_hash: string }> }>("package.json");
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const entry of manifest.files) {
      const bytes = readFileSync(join(packageDir, entry.path));
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      expect(digest, `${entry.path} does not match its declared hash`).toBe(entry.content_hash);
    }
  });

  it("lists no file it does not ship, and ships no unlisted semantic file", () => {
    const manifest = parse<{ files: Array<{ path: string }> }>("package.json");
    const listed = new Set(manifest.files.map((f) => f.path));
    const onDisk = new Set(walk(packageDir));
    for (const path of listed) expect(onDisk, `listed but absent: ${path}`).toContain(path);
    for (const path of onDisk) {
      // `package.json` cannot list itself, and `run.json` is volatile by design.
      if (path === "package.json" || path === "run.json") continue;
      expect(listed, `shipped but unlisted: ${path}`).toContain(path);
    }
  });

  /**
   * Structural validation against the published schemas, using only their
   * `required` and `type` keywords — which is all these schemas use at the top
   * level. A full JSON Schema implementation would be a dependency bought to
   * test a property this covers.
   */
  it("satisfies the required fields of every published schema", () => {
    const schemaDir = join(REPO_ROOT, "schema", "package");
    for (const schemaFile of readdirSync(schemaDir)) {
      const stem = schemaFile.replace(/\.schema\.json$/, "");
      const target = `${stem}.json`;
      const schema = JSON.parse(readFileSync(join(schemaDir, schemaFile), "utf8")) as {
        required?: string[];
        properties?: Record<string, { type?: string }>;
      };
      const value = parse<Record<string, unknown>>(target);
      for (const key of schema.required ?? []) {
        expect(Object.keys(value), `${target} is missing required "${key}"`).toContain(key);
      }
      for (const [key, definition] of Object.entries(schema.properties ?? {})) {
        if (!(key in value) || definition.type === undefined) continue;
        const actual = Array.isArray(value[key]) ? "array" : value[key] === null ? "null" : typeof value[key];
        if (definition.type === "integer") continue;
        expect([definition.type, "null"], `${target}.${key} has type ${actual}`).toContain(actual);
      }
    }
  });

  it("declares without granting, in the file itself (PK-R4, INV-004)", () => {
    const contract = parse<Record<string, unknown>>("runtime-contract.json");
    expect(contract["declares_only"]).toBe(true);
    expect(contract["grants"]).toBeNull();
    const verification = parse<Record<string, unknown>>("verification.json");
    expect(verification["executed_by_forge"]).toBe(false);
  });

  it("leaks no absolute path from the machine that built it (PK-R7)", () => {
    for (const name of walk(packageDir)) {
      const content = readFileSync(join(packageDir, name), "utf8");
      expect(content, `${name} leaks a host path`).not.toMatch(
        /(^|["\s:])(\/(?:home|Users|root|var|tmp|opt)\/|[A-Za-z]:\\)/,
      );
    }
  });

  it("carries a requirement manifest with derived ids (FR-052)", () => {
    const manifest = parse<{ requirements: Array<{ id: string; origin: string }> }>("requirements.json");
    expect(manifest.requirements.length).toBeGreaterThan(0);
    for (const requirement of manifest.requirements) {
      expect(requirement.id).toMatch(/^req-[0-9a-f]{12}$/);
      expect(["user_stated", "inferred"]).toContain(requirement.origin);
    }
  });
});

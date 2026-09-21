/**
 * Deterministic requirement → file/test linkage (V2-H, `FR-057`, `spec.md`
 * §22.10 LK-R1–LK-R4, `AC-055`, `AC-056`).
 *
 * The claim linkage makes is small and must be exactly true: every
 * authoritative link can be re-derived from the repository by a published rule,
 * and nothing else is ever authoritative. So the tests are mostly about what
 * must NOT link — an in-scope file with no evidence, an ignored or denied file,
 * a symlink out — and about the output being the same bytes every time.
 */
import { execFileSync } from "node:child_process";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WorkspaceGuard } from "../../src/context/workspace.js";
import {
  LINK_EVIDENCE_TYPES,
  checkAdvisoryPath,
  linkRequirements,
  reduceTerm,
  requirementTerms,
} from "../../src/requirement/linkage.js";
import { requirementId } from "../../src/requirement/identity.js";
import { makeWorkspace } from "../helpers/context.js";

const FAKE_KEY = "AKIA" + "Q7XJ4MZ2KD9PL3WB";

const HASHING = "Passwords are hashed with bcrypt before storage";
const LOCKOUT = "The login endpoint returns 429 after five failed attempts";
const ABSENT = "Invoices are exported as quarterly spreadsheets";

const req = (text: string) => ({ id: requirementId(text), text });

function repo(): string {
  return makeWorkspace({
    "src/auth/password.ts":
      "import bcrypt from 'bcrypt';\n// Passwords are hashed before storage.\nexport function hashPassword(pw: string) { return bcrypt.hash(pw, 12); }\n",
    "src/auth/login.ts":
      "// The login endpoint answers 429 once failed attempts pass five.\nexport const MAX_FAILED_ATTEMPTS = 5;\nexport function login() { return 429; }\n",
    "src/auth/README.md": "Auth module. Nothing about the requirements lives here.\n",
    "tests/password-hashing.test.ts": "import { hashPassword } from '../src/auth/password';\n",
    "tests/misc.test.ts": "// bcrypt passwords storage hashed\n",
    "src/config.ts": `// bcrypt password storage hashed\nexport const key = "${FAKE_KEY}";\n`,
    "ignored/hashing.ts": "passwords hashed bcrypt storage\n",
    ".gitignore": "ignored/\n",
    ".env": `PASSWORDS_HASHED_BCRYPT_STORAGE=${FAKE_KEY}\n`,
    "certs/storage.pem": "passwords hashed bcrypt storage\n",
  });
}

describe("LK-R1 — the published term rule", () => {
  it("reduces terms by the first suffix that leaves three characters", () => {
    expect(reduceTerm("hashed")).toBe("hash");
    expect(reduceTerm("passwords")).toBe("password");
    expect(reduceTerm("uses")).toBe("use");
    expect(reduceTerm("hashing")).toBe("hash");
    expect(reduceTerm("bcrypt")).toBe("bcrypt");
    expect(requirementTerms(HASHING)).toEqual(["bcrypt", "hash", "password", "storage"]);
  });
});

describe("LK-R1 — authoritative links are deterministic evidence", () => {
  const root = repo();
  const guard = WorkspaceGuard.open(root);
  const result = linkRequirements([req(HASHING), req(LOCKOUT), req(ABSENT)], guard, {
    scope: { include: ["src/auth/**"], exclude: [] },
  });
  const linksFor = (text: string) => result.authoritative.filter((l) => l.requirement_id === requirementId(text));

  it("links a real requirement to the file that implements it, citing the matched terms", () => {
    const link = linksFor(HASHING).find((l) => l.path === "src/auth/password.ts");
    expect(link).toBeDefined();
    expect(link!.kind).toBe("file");
    expect(link!.advisory).toBe(false);
    const rg = link!.evidence.find((e) => e.type === "rg_term");
    expect(rg).toMatchObject({ type: "rg_term", of: 4, required: 3 });
    expect(rg && "matched_terms" in rg ? rg.matched_terms : []).toEqual(["bcrypt", "hash", "password", "storage"]);
  });

  it("links a test by its name, and marks it a test", () => {
    const link = linksFor(HASHING).find((l) => l.path === "tests/password-hashing.test.ts");
    expect(link).toMatchObject({ kind: "test", advisory: false });
    expect(link!.evidence.map((e) => e.type)).toContain("test_naming");
    // tests/misc.test.ts matches by content alone — still a test, via rg_term.
    expect(linksFor(HASHING).find((l) => l.path === "tests/misc.test.ts")).toMatchObject({ kind: "test" });
  });

  it("attaches scope_glob only as corroboration, never as a link on its own", () => {
    const link = linksFor(HASHING).find((l) => l.path === "src/auth/password.ts")!;
    expect(link.evidence).toContainEqual({ type: "scope_glob", glob: "src/auth/**" });
    // In scope, no terms: no link.
    expect(result.authoritative.some((l) => l.path === "src/auth/README.md")).toBe(false);
  });

  it("fabricates nothing for a requirement with no evidence", () => {
    expect(linksFor(ABSENT)).toEqual([]);
  });

  it("gives every authoritative link rg_term or test_naming evidence and advisory:false", () => {
    expect(result.authoritative.length).toBeGreaterThan(2);
    for (const link of result.authoritative) {
      expect(link.advisory).toBe(false);
      expect(link.evidence.some((e) => e.type === "rg_term" || e.type === "test_naming")).toBe(true);
      for (const e of link.evidence) expect(LINK_EVIDENCE_TYPES).toContain(e.type);
    }
    expect("advisory" in result).toBe(false);
  });

  it("links the lockout requirement to login.ts", () => {
    expect(linksFor(LOCKOUT).map((l) => l.path)).toContain("src/auth/login.ts");
  });
});

describe("RB-R3 / LK-R3 — ignored, denied, escaping and secret-bearing files", () => {
  it("never links an ignored, denied or symlinked-out file", () => {
    const root = repo();
    const outside = makeWorkspace({ "hashing.ts": "passwords hashed bcrypt storage\n" });
    // Named like a test, so the guard's own walk discovers it — and its read refuses it.
    symlinkSync(join(outside, "hashing.ts"), join(root, "tests", "password-hashing-escape.test.ts"));
    const result = linkRequirements([req(HASHING)], WorkspaceGuard.open(root));
    const paths = result.authoritative.map((l) => l.path);
    for (const bad of ["ignored/hashing.ts", ".env", "certs/storage.pem", "tests/password-hashing-escape.test.ts"]) {
      expect(paths).not.toContain(bad);
    }
    const escape = result.excluded.find((e) => e.path === "tests/password-hashing-escape.test.ts");
    expect(escape?.reason).toBe("symlink-escape");
  });

  it("links a secret-bearing file on its redacted content and never carries the value", () => {
    const result = linkRequirements([req(HASHING)], WorkspaceGuard.open(repo()));
    expect(result.authoritative.map((l) => l.path)).toContain("src/config.ts");
    const json = JSON.stringify(result);
    expect(json).not.toContain(FAKE_KEY);
    const r003 = result.diagnostics.filter((d) => d.code === "FORGE-R003");
    expect(r003.some((d) => d.message.includes("src/config.ts") && d.message.includes("aws-access-key"))).toBe(true);
    for (const d of r003) expect(d.message).not.toContain(FAKE_KEY);
  });
});

describe("LK-R2 — reproducible", () => {
  it("is byte-identical across repeated runs over the same repository", () => {
    const root = repo();
    const run = () =>
      JSON.stringify(
        linkRequirements([req(HASHING), req(LOCKOUT)], WorkspaceGuard.open(root), {
          scope: { include: ["src/**"], exclude: [] },
        }),
      );
    const first = run();
    expect(run()).toBe(first);
    expect(run()).toBe(first);
  });

  it("caps links per requirement and records the excess", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) files[`src/f${String(i).padStart(2, "0")}.ts`] = "passwords hashed bcrypt storage\n";
    const result = linkRequirements([req(HASHING)], WorkspaceGuard.open(makeWorkspace(files)), { maxLinksPerRequirement: 25 });
    expect(result.authoritative).toHaveLength(25);
    expect(result.excluded.filter((e) => e.reason === "over-cap")).toHaveLength(5);
  });

  it("corroborates with git history position when the repository has commits", () => {
    const root = repo();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stdio: "ignore" });
    git("init", "-q");
    git("add", "src/auth/password.ts");
    git("commit", "-q", "-m", "one");
    const result = linkRequirements([req(HASHING)], WorkspaceGuard.open(root), {
      scope: { include: ["src/auth/**"], exclude: [] },
    });
    const link = result.authoritative.find((l) => l.path === "src/auth/password.ts")!;
    expect(link.evidence).toContainEqual({ type: "git_history", commit_position: 0 });
    // git_history never creates a link: README is committed-adjacent and unlinked.
    expect(result.authoritative.some((l) => l.path === "src/auth/README.md")).toBe(false);
  });
});

describe("LK-R4 — advisory paths are checked through the guard", () => {
  it("accepts a readable repository path and refuses escapes and denied files", () => {
    const root = repo();
    writeFileSync(join(root, "notes.md"), "notes\n");
    const guard = WorkspaceGuard.open(root);
    expect(checkAdvisoryPath(guard, "./notes.md")).toBe("notes.md");
    expect(() => checkAdvisoryPath(guard, "../etc/passwd")).toThrow(/traversal/);
    expect(() => checkAdvisoryPath(guard, "/etc/passwd")).toThrow(/absolute-path/);
    expect(() => checkAdvisoryPath(guard, ".env")).toThrow(/denied-glob/);
  });
});

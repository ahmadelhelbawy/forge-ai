/**
 * Repository binding (V2-H, `FR-056`, `spec.md` §22.10 RB-R1–RB-R3, `AC-054`).
 *
 * Binding is the phase's real cost: it gives the served workspace filesystem
 * reach it has never had. These tests hold the three lines that keep that reach
 * bounded — an operator allowlist, the existing WorkspaceGuard for every read,
 * and a conversation that works exactly as before when nothing is bound.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { GuardDeniedError } from "../../src/context/workspace.js";
import {
  RepositoryBindingRefused,
  openRepository,
  parseRepositoryRoots,
} from "../../src/requirement/binding.js";
import {
  bindRepository,
  boundRepository,
  unbindRepository,
} from "../../web/lib/requirements";
import { loadConversation, newConversation, saveConversation, semanticSnapshot } from "../../web/lib/store";

const FAKE_KEY = "AKIA" + "Q7XJ4MZ2KD9PL3WB";

function makeRoots(): { allowed: string; repo: string; outside: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "forge-v2h-bind-")));
  const allowed = join(base, "allowed");
  const repo = join(allowed, "repo");
  const outside = join(base, "outside");
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(repo, "src", "auth.ts"), `export const key = "${FAKE_KEY}";\n`);
  writeFileSync(join(outside, "secret.txt"), "outside the allowlist\n");
  return { allowed, repo, outside };
}

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryBindingRefused);
    return (error as RepositoryBindingRefused).reason;
  }
  throw new Error("expected a RepositoryBindingRefused");
}

describe("RB-R2 — bindable roots are an operator allowlist", () => {
  it("parses the allowlist and refuses everything when it is unset", () => {
    expect(parseRepositoryRoots(undefined)).toEqual([]);
    expect(parseRepositoryRoots(`/a${delimiter}${delimiter}/b`)).toEqual(["/a", "/b"]);
    const { repo } = makeRoots();
    expect(refusal(() => openRepository(repo, []))).toBe("not-configured");
  });

  it("binds a directory inside an allowed root, at its real path", () => {
    const { allowed, repo } = makeRoots();
    expect(openRepository(repo, [allowed]).root).toBe(realpathSync(repo));
  });

  it("refuses a relative path, a missing path, a file, and a path outside the allowlist", () => {
    const { allowed, repo, outside } = makeRoots();
    expect(refusal(() => openRepository("repo", [allowed]))).toBe("not-absolute");
    expect(refusal(() => openRepository(join(allowed, "nope"), [allowed]))).toBe("missing");
    expect(refusal(() => openRepository(join(repo, "src", "auth.ts"), [allowed]))).toBe("not-a-directory");
    expect(refusal(() => openRepository(outside, [allowed]))).toBe("outside-allowlist");
  });

  it("refuses a ../ escape, even one that would resolve inside another allowed tree", () => {
    const { allowed, repo } = makeRoots();
    expect(refusal(() => openRepository(`${repo}/../../outside`, [allowed]))).toBe("traversal");
    expect(refusal(() => openRepository(`${repo}/..`, [allowed]))).toBe("traversal");
  });

  it("refuses a symlink inside the allowlist that points outside it", () => {
    const { allowed, outside } = makeRoots();
    symlinkSync(outside, join(allowed, "sneaky"));
    expect(refusal(() => openRepository(join(allowed, "sneaky"), [allowed]))).toBe("outside-allowlist");
  });
});

describe("RB-R3 — every read from a bound repository is a guarded read", () => {
  it("denies traversal, symlink escapes and denied files through the bound guard", () => {
    const { allowed, repo, outside } = makeRoots();
    writeFileSync(join(repo, ".env"), `API_KEY=${FAKE_KEY}\n`);
    symlinkSync(join(outside, "secret.txt"), join(repo, "link.txt"));
    const guard = openRepository(repo, [allowed]);
    const reason = (fn: () => unknown): string => {
      try {
        fn();
      } catch (error) {
        expect(error).toBeInstanceOf(GuardDeniedError);
        return (error as GuardDeniedError).reason;
      }
      throw new Error("expected a denial");
    };
    expect(reason(() => guard.readText("../outside/secret.txt"))).toBe("traversal");
    expect(reason(() => guard.readText("link.txt"))).toBe("symlink-escape");
    expect(reason(() => guard.readText(".env"))).toBe("denied-glob");
    // A readable file comes back redacted, never with the credential.
    expect(guard.readText("src/auth.ts").content).not.toContain(FAKE_KEY);
  });

  it("keeps the workspace entry point and the core layer off node:fs", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const paths = [
      join(root, "web", "lib", "requirements.ts"),
      ...readdirSync(join(root, "src", "requirement")).map((f) => join(root, "src", "requirement", f)),
    ];
    for (const path of paths) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/from\s+["']node:fs/);
    }
  });
});

describe("RB-R1 — explicit, per conversation, revocable, persisted", () => {
  let roots: ReturnType<typeof makeRoots>;
  beforeEach(() => {
    process.env["FORGE_DATA_DIR"] = join(mkdtempSync(join(tmpdir(), "forge-v2h-store-")), "data");
    roots = makeRoots();
    process.env["FORGE_REPO_ROOTS"] = roots.allowed;
  });

  it("binds one conversation, persists it, and leaves another unbound", () => {
    const bound = newConversation({ title: "bound" });
    const other = newConversation({ title: "other" });
    bindRepository(bound, roots.repo);
    saveConversation(bound);
    saveConversation(other);

    const reloaded = loadConversation(bound.id)!;
    expect(reloaded.repository?.root).toBe(realpathSync(roots.repo));
    expect(boundRepository(reloaded)?.root).toBe(realpathSync(roots.repo));
    expect(loadConversation(other.id)!.repository).toBeNull();
    expect(boundRepository(loadConversation(other.id)!)).toBeNull();
  });

  it("revokes: an unbind is persisted and the guard is gone", () => {
    const convo = newConversation({ title: "revocable" });
    bindRepository(convo, roots.repo);
    saveConversation(convo);
    const loaded = loadConversation(convo.id)!;
    unbindRepository(loaded);
    saveConversation(loaded);
    const after = loadConversation(convo.id)!;
    expect(after.repository).toBeNull();
    expect(boundRepository(after)).toBeNull();
  });

  it("re-checks the allowlist on use, so narrowing it revokes access", () => {
    const convo = newConversation({ title: "narrowed" });
    bindRepository(convo, roots.repo);
    process.env["FORGE_REPO_ROOTS"] = roots.outside;
    expect(() => boundRepository(convo)).toThrow(/outside every allowed root/);
  });

  it("refuses an escape at the workspace entry point and records nothing", () => {
    const convo = newConversation({ title: "escape" });
    // web/ loads the core from forge/dist, so the class differs; the reason does not.
    expect(() => bindRepository(convo, `${roots.repo}/../../outside`)).toThrow(/traversal/);
    expect(() => bindRepository(convo, roots.outside)).toThrow(/outside every allowed root/);
    expect(convo.repository).toBeNull();
  });

  it("changes nothing about an unbound conversation's semantic state", () => {
    const convo = newConversation({ title: "plain" });
    saveConversation(convo);
    const reloaded = loadConversation(convo.id)!;
    expect(reloaded.repository).toBeNull();
    expect(reloaded.governance).toEqual([]);
    expect(reloaded.advisoryLinks).toEqual([]);
    expect(semanticSnapshot(reloaded)).toBe(semanticSnapshot(convo));
  });

  it("never writes the planted credential into the store", () => {
    const convo = newConversation({ title: "secret" });
    bindRepository(convo, roots.repo);
    saveConversation(convo);
    const dataDir = process.env["FORGE_DATA_DIR"]!;
    const dump = (dir: string): string =>
      readdirSync(dir, { withFileTypes: true })
        .map((e) => (e.isDirectory() ? dump(join(dir, e.name)) : e.name.endsWith(".sqlite") ? "" : readFileSync(join(dir, e.name), "utf8")))
        .join("\n");
    expect(dump(dataDir)).not.toContain(FAKE_KEY);
  });
});

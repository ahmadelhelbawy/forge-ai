/**
 * Retriever tests (FR-025): ripgrep, glob, git-history, and explicit files.
 *
 * Retrieval runs against isolated temp workspaces (never repository state),
 * except one case that exercises the checked-in `fixtures/repos/small`
 * workspace through the real guard.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { deriveQuery } from "../../src/context/query.js";
import { explicitSearch } from "../../src/context/retrievers/explicit.js";
import { gitHistorySearch } from "../../src/context/retrievers/git-history.js";
import { globSearch } from "../../src/context/retrievers/glob.js";
import { ripgrepSearch } from "../../src/context/retrievers/ripgrep.js";
import { WorkspaceGuard } from "../../src/context/workspace.js";
import { makeWorkspace, SMALL_REPO } from "../helpers/context.js";

const FILES = {
  "src/auth.ts": "export interface AuthProvider {\n  refresh(token: string): unknown;\n}\n",
  "src/session.ts": "import { AuthProvider } from './auth.js';\nexport function login(user: string): string {\n  return user;\n}\n",
  "docs/AUTH.md": "Session refresh must reuse the existing AuthProvider interface.\n",
  "unrelated.txt": "grocery list: apples, oats\n",
};

function authQuery() {
  return deriveQuery({
    id: "g1",
    kind: "goal",
    texts: ["Fix session loss during token refresh without changing the AuthProvider interface"],
  });
}

describe("ripgrepSearch", () => {
  it("attributes files to the querying node", () => {
    const root = makeWorkspace(FILES);
    const { hits, notes } = ripgrepSearch(root, [authQuery()]);
    const byPath = new Map(hits.map((h) => [h.relPath, h]));
    expect(byPath.get("src/auth.ts")?.matchedNodeIds).toEqual(["g1"]);
    expect(byPath.get("src/session.ts")?.matchedNodeIds).toEqual(["g1"]);
    expect(byPath.get("docs/AUTH.md")?.matchedNodeIds).toEqual(["g1"]);
    expect(byPath.has("unrelated.txt")).toBe(false);
    expect(notes.length).toBeGreaterThan(0);
  });

  it("records term-less queries instead of failing", () => {
    const root = makeWorkspace(FILES);
    const { hits, notes } = ripgrepSearch(root, [
      { nodeId: "g9", kind: "goal", terms: [] },
    ]);
    expect(hits).toEqual([]);
    expect(notes.join(" ")).toContain("g9");
  });

  it("merges node attribution across queries", () => {
    const root = makeWorkspace(FILES);
    const { hits } = ripgrepSearch(root, [
      authQuery(),
      deriveQuery({ id: "c1", kind: "constraint", texts: ["login handling must stay minimal"] }),
    ]);
    const session = hits.find((h) => h.relPath === "src/session.ts");
    expect(session?.matchedNodeIds).toEqual(["c1", "g1"]);
  });
});

describe("globSearch", () => {
  it("lists in-scope files minus excludes, through the guard", () => {
    const root = makeWorkspace(FILES);
    const guard = WorkspaceGuard.open(root);
    const { hits } = globSearch(guard, ["src/**", "docs/**"], ["**/*.md"]);
    expect(hits.map((h) => h.relPath).sort()).toEqual(["src/auth.ts", "src/session.ts"]);
    expect(hits.every((h) => h.viaScopeGlob)).toBe(true);
  });

  it("marks documentation paths as project-docs", () => {
    const root = makeWorkspace(FILES);
    const guard = WorkspaceGuard.open(root);
    const { hits } = globSearch(guard, ["docs/**"], []);
    expect(hits[0]?.sourceClass).toBe("project-docs");
  });
});

describe("gitHistorySearch", () => {
  function initRepo(): string {
    const root = makeWorkspace({
      "src/a.ts": "first\n",
      "src/b.ts": "first\n",
    });
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
      GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
    };
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-qm", "first"], { cwd: root, env });
    execFileSync("git", ["commit", "-qm", "second", "--allow-empty"], { cwd: root, env });
    return root;
  }

  it("scores touched files by commit position, not wall-clock", () => {
    const root = initRepo();
    const { hits } = gitHistorySearch(root, ["src/**"]);
    const byPath = new Map(hits.map((h) => [h.relPath, h]));
    expect(byPath.get("src/a.ts")?.gitRecency).toBe(1);
    expect(byPath.get("src/b.ts")?.gitRecency).toBe(1);
    expect(hits.every((h) => h.sourceClass === "git-history")).toBe(true);
  });

  it("reports a non-repository honestly", () => {
    const root = makeWorkspace(FILES);
    const { hits, notes } = gitHistorySearch(root, ["src/**"]);
    expect(hits).toEqual([]);
    expect(notes.join(" ").toLowerCase()).toContain("unavailable");
  });
});

describe("explicitSearch", () => {
  it("accepts guard-readable files with valid justifies", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const { result, rejections } = explicitSearch(
      guard,
      [{ path: "src/auth.ts", justifies: ["g1"] }],
      new Set(["g1", "c1"]),
    );
    expect(rejections).toEqual([]);
    expect(result.hits[0]).toMatchObject({
      relPath: "src/auth.ts",
      matchedNodeIds: ["g1"],
      sourceClass: "explicit",
    });
  });

  it("rejects unknown justification ids before they become C010", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const { result, rejections } = explicitSearch(
      guard,
      [{ path: "src/auth.ts", justifies: ["g99"] }],
      new Set(["g1"]),
    );
    expect(result.hits).toEqual([]);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toContain("g99");
  });

  it("rejects unjustified explicit files (FR-026)", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const { rejections } = explicitSearch(guard, [{ path: "src/auth.ts", justifies: [] }], new Set(["g1"]));
    expect(rejections).toHaveLength(1);
  });

  it("does not let explicit selection bypass deny globs", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const { result, rejections } = explicitSearch(
      guard,
      [{ path: ".env", justifies: ["g1"] }],
      new Set(["g1"]),
    );
    expect(result.hits).toEqual([]);
    expect(rejections[0]?.reason).toContain("denied");
  });
});

/**
 * Resolution tests (INV-006, AC-007): every retained ref justifies itself
 * with resolvable node ids; everything else is dropped with a recorded
 * reason. Scores stay in the run layer — resolving twice yields identical
 * refs, and no ref carries a score.
 */
import { describe, expect, it } from "vitest";

import { resolveContext } from "../../src/context/resolve.js";
import { WorkspaceGuard } from "../../src/context/workspace.js";
import { makeTestIR, makeWorkspace } from "../helpers/context.js";

const FILES = {
  "src/auth.ts": "export interface AuthProvider {\n  refresh(token: string): unknown;\n}\n",
  "src/session.ts": "import { AuthProvider } from './auth.js';\nexport function login(user: string): string {\n  return user;\n}\n",
  "docs/AUTH.md": "Session refresh must reuse the existing AuthProvider interface.\n",
  "notes/unrelated.txt": "grocery list: apples, oats\n",
};

function testIr() {
  return makeTestIR({
    goals: [
      { id: "g1", statement: "Fix session loss during token refresh" },
      { id: "g2", statement: "Keep the AuthProvider interface unchanged" },
    ],
    constraints: [{ id: "c1", statement: "Follow the error-handling convention in the shared error module" }],
    scopeInclude: ["src/**", "docs/**", "notes/**"],
  });
}

describe("resolveContext", () => {
  it("retains only justified refs with resolvable ids", () => {
    const guard = WorkspaceGuard.open(makeWorkspace(FILES));
    const { refs, run } = resolveContext(testIr(), guard);
    expect(refs.length).toBeGreaterThan(0);
    const justifiable = new Set(["g1", "g2", "c1"]);
    for (const ref of refs) {
      expect(ref.justifies.length).toBeGreaterThan(0);
      for (const id of ref.justifies) expect(justifiable.has(id)).toBe(true);
      expect(ref.uri).toBe(`forge://${ref.uri.slice("forge://".length)}`);
      expect(ref.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    // The grocery list is in scope but matches nothing: dropped, recorded.
    expect(run.dropped.filter((d) => d.reason === "unjustified").map((d) => d.relPath)).toContain(
      "notes/unrelated.txt",
    );
  });

  it("is deterministic: two resolutions are identical", () => {
    const root = makeWorkspace(FILES);
    const ir = testIr();
    const a = resolveContext(ir, WorkspaceGuard.open(root));
    const b = resolveContext(ir, WorkspaceGuard.open(root));
    expect(a.refs).toEqual(b.refs);
    expect(a.run.scores.map((s) => s.score)).toEqual(b.run.scores.map((s) => s.score));
  });

  it("keeps scores out of the semantic refs", () => {
    const guard = WorkspaceGuard.open(makeWorkspace(FILES));
    const { refs, run } = resolveContext(testIr(), guard);
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual(["content_hash", "id", "justifies", "role", "trust", "uri"]);
    }
    expect(run.scores).toHaveLength(refs.length);
  });

  it("records redactions with rule + count, never values", () => {
    const guard = WorkspaceGuard.open(
      makeWorkspace({
        "src/keys.ts": 'export const key = "AKIAIOSFODNN7EXAMPLE"; // session key\n',
      }),
    );
    const ir = makeTestIR({ goals: [{ id: "g1", statement: "Rotate the session key" }], scopeInclude: ["src/**"] });
    const { refs, run } = resolveContext(ir, guard);
    expect(refs).toHaveLength(1);
    expect(run.redactions).toHaveLength(1);
    expect(run.redactions[0]?.rules).toEqual([{ rule: "aws-access-key", count: 1 }]);
    expect(JSON.stringify(run.redactions)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("drops deny-globbed discoveries with a recorded reason", () => {
    // NOTE: ripgrep skips hidden files, so `.env` is never lexically
    // discovered (the guard still denies it on explicit request — see the
    // explicit-search tests). A non-hidden deny-globbed file exercises the
    // discover-then-deny path.
    const guard = WorkspaceGuard.open(
      makeWorkspace({
        "src/a.ts": "session login\n",
        "notes/keys.pem": "session login\n-----BEGIN PRIVATE KEY-----\n",
      }),
    );
    const ir = makeTestIR({ scopeInclude: ["**"] });
    const { refs, run } = resolveContext(ir, guard);
    expect(refs.map((r) => r.uri)).not.toContain("forge://notes/keys.pem");
    expect(run.dropped.find((d) => d.relPath === "notes/keys.pem")?.reason).toBe("guard-denied");
  });

  it("caps refs with recorded over-cap drops", () => {
    const guard = WorkspaceGuard.open(makeWorkspace(FILES));
    const { refs, run } = resolveContext(testIr(), guard, { maxRefs: 1 });
    expect(refs).toHaveLength(1);
    expect(run.dropped.some((d) => d.reason === "over-cap")).toBe(true);
  });

  it("rejects multi-pass requests loudly (CE-R8)", () => {
    const guard = WorkspaceGuard.open(makeWorkspace(FILES));
    expect(() => resolveContext(testIr(), guard, { maxPasses: 2 })).toThrow(/maxPasses/);
  });

  it("accepts explicit files and records rejections", () => {
    const guard = WorkspaceGuard.open(makeWorkspace(FILES));
    const { refs, run } = resolveContext(testIr(), guard, {
      explicit: [
        { path: "docs/AUTH.md", justifies: ["g2"] },
        { path: "docs/AUTH.md", justifies: ["g99"] },
      ],
    });
    const explicit = refs.find((r) => r.uri === "forge://docs/AUTH.md");
    expect(explicit?.justifies).toContain("g2");
    expect(run.dropped.some((d) => d.detail.includes("g99"))).toBe(true);
  });
});

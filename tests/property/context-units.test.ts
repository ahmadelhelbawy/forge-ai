/**
 * Unit tests for query derivation, role assignment, and ranking
 * (FR-025–FR-028, CE-R2, architecture §10.3–§10.4).
 *
 * Pure functions: no filesystem, no clock, no network.
 */
import { describe, expect, it } from "vitest";

import { deriveQuery, normalizeText, tokenize } from "../../src/context/query.js";
import { DEFAULT_WEIGHTS, rankCandidates, ROLE_PRIORS, scoreCandidate } from "../../src/context/rank.js";
import { assignRole, declaresSymbol, isTestPath } from "../../src/context/roles.js";

const ZWSP = String.fromCharCode(0x200b);

describe("tokenize", () => {
  it("splits CamelCase and keeps the compound", () => {
    expect(tokenize("Do not change the AuthProvider interface")).toEqual([
      "auth",
      "authprovider",
      "change",
      "interface",
      "provider",
    ]);
  });

  it("drops stopwords and short tokens", () => {
    expect(tokenize("Fix it")).toEqual(["fix"]);
  });

  it("is deterministic and sorted", () => {
    const a = tokenize("refresh session token refresh");
    expect(a).toEqual(["refresh", "session", "token"]);
    expect(tokenize("refresh session token refresh")).toEqual(a);
  });

  it("neutralizes zero-width smuggling", () => {
    expect(normalizeText(`ses${ZWSP}sion`)).toBe("session");
    expect(tokenize(`ses${ZWSP}sion refresh`)).toContain("session");
  });
});

describe("deriveQuery", () => {
  it("merges statement and acceptance, sorted and deduplicated", () => {
    const q = deriveQuery({
      id: "g1",
      kind: "goal",
      texts: ["Identify session loss during token refresh", "The refresh path is named"],
    });
    expect(q.nodeId).toBe("g1");
    expect(q.terms).toEqual([...q.terms].sort());
    expect(new Set(q.terms).size).toBe(q.terms.length);
    expect(q.terms).toContain("session");
  });

  it("yields no terms when nothing carries signal", () => {
    expect(deriveQuery({ id: "g9", kind: "goal", texts: ["Do it"] }).terms).toEqual([]);
  });
});

describe("assignRole", () => {
  const base = {
    trust: "semi_trusted" as const,
    sourceClass: "working-tree" as const,
    queryTerms: ["login"],
    content: "export function login(user: string) { return user; }",
  };

  it("marks git history as background", () => {
    expect(assignRole({ ...base, relPath: "x.ts", sourceClass: "git-history" })).toMatchObject({
      role: "background",
      confident: true,
      reason: "git-history",
    });
  });

  it("prefers test-path over symbol declaration", () => {
    expect(assignRole({ ...base, relPath: "src/auth.test.ts" })).toMatchObject({
      role: "example",
      confident: true,
      reason: "test-path",
    });
  });

  it("assigns constraint_source to semi-trusted docs", () => {
    expect(assignRole({ ...base, relPath: "docs/AUTH.md" })).toMatchObject({
      role: "constraint_source",
      confident: true,
    });
  });

  it("restricts untrusted docs from constraint_source (C053)", () => {
    expect(assignRole({ ...base, relPath: "docs/AUTH.md", trust: "untrusted" })).toMatchObject({
      role: "background",
      confident: true,
      reason: "untrusted-docs-restricted",
    });
  });

  it("detects symbol declarations case-insensitively", () => {
    expect(assignRole({ ...base, relPath: "src/session.ts", queryTerms: ["authprovider"] })).toMatchObject({
      role: "background",
      confident: false,
    });
    expect(
      assignRole({
        ...base,
        relPath: "src/auth.ts",
        queryTerms: ["authprovider"],
        content: "export interface AuthProvider { get(): void; }",
      }),
    ).toMatchObject({ role: "definition", confident: true, reason: "symbol-declaration" });
  });

  it("is low-confidence background when nothing fires", () => {
    expect(assignRole({ ...base, relPath: "src/other.ts", content: "unrelated words here" })).toMatchObject({
      role: "background",
      confident: false,
      reason: "background-default",
    });
  });

  it("recognizes test globs", () => {
    expect(isTestPath("a/b.test.ts")).toBe(true);
    expect(isTestPath("tests/a.ts")).toBe(true);
    expect(isTestPath("__tests__/a.ts")).toBe(true);
    expect(isTestPath("src/a.ts")).toBe(false);
  });

  it("declaresSymbol needs a declaration, not a mention", () => {
    expect(declaresSymbol("import { login } from './x.js';", "login")).toBe(false);
    expect(declaresSymbol("export function login() {}", "login")).toBe(true);
    expect(declaresSymbol("class AuthProvider {}", "authprovider")).toBe(true);
  });
});

describe("scoreCandidate", () => {
  it("weights lexical, role, git, and proximity by the documented defaults", () => {
    const { score, parts } = scoreCandidate({ lexical: 1, role: "definition", git: 1, proximity: 1 });
    expect(score).toBeCloseTo(1, 10);
    expect(parts).toEqual({ lex: 1, role: 1, git: 1, prox: 1 });
    expect(scoreCandidate({ lexical: 0, role: "background", git: null, proximity: 0 }).score).toBeCloseTo(
      (DEFAULT_WEIGHTS.role * ROLE_PRIORS.background) /
        (DEFAULT_WEIGHTS.lex + DEFAULT_WEIGHTS.role + DEFAULT_WEIGHTS.git + DEFAULT_WEIGHTS.prox),
      10,
    );
  });

  it("treats missing git recency as zero, not as failure", () => {
    const { parts } = scoreCandidate({ lexical: 0.5, role: "example", git: null, proximity: 0.5 });
    expect(parts.git).toBe(0);
  });

  it("rejects degenerate weights", () => {
    expect(() =>
      scoreCandidate({ lexical: 1, role: "definition", git: 1, proximity: 1 }, { lex: 0, role: 0, git: 0, prox: 0 }),
    ).toThrow();
  });

  it("custom weights change the outcome deterministically", () => {
    const input = { lexical: 0.2, role: "definition" as const, git: 0, proximity: 1 };
    const lexHeavy = scoreCandidate(input, { lex: 1, role: 0, git: 0, prox: 0 }).score;
    const proxHeavy = scoreCandidate(input, { lex: 0, role: 0, git: 0, prox: 1 }).score;
    expect(lexHeavy).toBeCloseTo(0.2, 10);
    expect(proxHeavy).toBeCloseTo(1, 10);
  });
});

describe("rankCandidates", () => {
  it("sorts by score descending and breaks ties by path (code units, not locale)", () => {
    const ranked = rankCandidates(
      ["b.ts", "a.ts", "Z.ts"].map((relPath) => ({
        item: relPath,
        relPath,
        input: { lexical: 0.5, role: "background" as const, git: null, proximity: 0.5 },
      })),
    );
    expect(ranked.map((r) => r.relPath)).toEqual(["Z.ts", "a.ts", "b.ts"]);
  });

  it("ranks higher lexical strength first", () => {
    const ranked = rankCandidates([
      { item: "low", relPath: "low.ts", input: { lexical: 0.1, role: "background" as const, git: null, proximity: 1 } },
      { item: "high", relPath: "high.ts", input: { lexical: 0.9, role: "background" as const, git: null, proximity: 0 } },
    ]);
    expect(ranked[0]?.item).toBe("high");
  });
});

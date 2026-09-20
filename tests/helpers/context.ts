/**
 * Test helpers for the P2 context engine.
 *
 * `makeTestIR` builds a minimal schema-valid IR without touching
 * `fixtures/ir/`; `makeWorkspace` creates an isolated temp workspace so
 * retrieval tests never depend on repository state. Filesystem access here
 * is test-only scaffolding, not context reads (see fixtures.ts).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";

import { REPO_ROOT } from "./fixtures.js";

export const SMALL_REPO = join(REPO_ROOT, "fixtures", "repos", "small");

export interface TestNode {
  readonly id: string;
  readonly statement: string;
  readonly acceptance?: readonly string[];
}

export function makeTestIR(
  opts: {
    readonly goals?: readonly TestNode[];
    readonly constraints?: readonly (TestNode & { readonly hardness?: "hard" | "soft" })[];
    readonly scopeInclude?: readonly string[];
    readonly scopeExclude?: readonly string[];
    readonly openQuestions?: readonly {
      readonly id: string;
      readonly question: string;
      readonly options?: readonly string[];
      readonly blocking?: boolean;
    }[];
  } = {},
): TaskIR {
  return parseTaskIR({
    ir_version: "1.0",
    semantic_hash: null,
    objective: {
      statement: "Test objective",
      kind: "debug",
      success_definition: "Done",
      source_ref: "user_input",
    },
    goals: (opts.goals ?? [{ id: "g1", statement: "Fix the login session handling" }]).map((g) => ({
      id: g.id,
      statement: g.statement,
      priority: "must",
      acceptance: [...(g.acceptance ?? ["Login works"])],
      source_ref: "user_input",
    })),
    constraints: (opts.constraints ?? []).map((c) => ({
      id: c.id,
      kind: "behavioral",
      hardness: c.hardness ?? "hard",
      statement: c.statement,
      source_ref: "user_input",
    })),
    non_goals: [],
    scope: {
      include: [...(opts.scopeInclude ?? ["src/**"])],
      exclude: [...(opts.scopeExclude ?? [])],
      blast_radius: "module",
      source_ref: "user_input",
    },
    required_capabilities: ["fs_read"],
    context_refs: [],
    assumptions: [],
    open_questions: (opts.openQuestions ?? []).map((q) => ({
      id: q.id,
      question: q.question,
      options: [...(q.options ?? [])],
      default_assumption_ref: null,
      blocking: q.blocking ?? false,
      source_ref: "user_input",
    })),
    verification: [],
    deliverables: [{ id: "d1", kind: "code_change", description: "Fix", source_ref: "user_input" }],
    risk: { level: "low", factors: [] },
  });
}

/** Create a temp workspace containing exactly `files` (keys are rel paths). */
export function makeWorkspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-ctx-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  }
  return root;
}

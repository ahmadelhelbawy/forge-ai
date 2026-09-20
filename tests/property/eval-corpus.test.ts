/**
 * Evaluation corpus tests (TS-R6, P3).
 *
 * Always-on: corpus STRUCTURE — both files parse, ids are unique across
 * the corpus, every entry carries the TS-R6 fields, all 8 categories are
 * covered, and the total reaches ≥30. This runs in the default suite with
 * no model and no network.
 *
 * Live (excluded by default, TS-R5): with FORGE_LIVE_EVAL=1 and a real
 * provider, every entry runs through intent.extract and checks
 * set-containment expectations plus forbidden outputs. Needs a key;
 * never runs in CI.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

import { extractIntent } from "../../src/intent/extract.js";
import { selectProvider } from "../../src/cli/task.js";

const CorpusEntry = z.strictObject({
  id: z.string(),
  category: z.string(),
  text: z.string().min(1),
  repository: z.string().min(1),
  expected_goals: z.array(z.string()),
  expected_constraints: z.array(z.string()),
  expected_questions: z.array(z.string()),
  expected_diagnostics: z.array(z.string()),
  forbidden: z.array(z.string()),
});
type CorpusEntry = z.infer<typeof CorpusEntry>;

const CATEGORIES = [
  "debugging",
  "architecture-change",
  "frontend-design",
  "refactoring",
  "research",
  "security-sensitive",
  "ambiguous",
  "conflicting-constraints",
] as const;

function loadCorpus(name: string): CorpusEntry[] {
  const raw = parseYaml(readFileSync(new URL(`../../evals/corpus/${name}`, import.meta.url), "utf8"));
  return z.array(CorpusEntry).parse(raw);
}

// The thesis file predates the TS-R6 field set and is FROZEN: parse it
// loosely (presence + id continuity only), never amend it.
const ThesisEntry = CorpusEntry.omit({ repository: true, expected_diagnostics: true });

const thesis = z
  .array(ThesisEntry)
  .parse(parseYaml(readFileSync(new URL("../../evals/corpus/tasks.yaml", import.meta.url), "utf8")));
const p3 = loadCorpus("p3-tasks.yaml");
// The live check needs only the shared expectation fields, present in both files.
const all: Array<{
  id: string;
  category: string;
  text: string;
  expected_goals: string[];
  expected_constraints: string[];
  expected_questions: string[];
  forbidden: string[];
}> = [...thesis, ...p3];

describe("eval corpus structure (TS-R6)", () => {
  it("reaches 30 tasks with unique ids", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it("leaves the thesis file frozen at T01–T12", () => {
    expect(thesis.map((e) => e.id).sort()).toEqual([
      "T01", "T02", "T03", "T04", "T05", "T06",
      "T07", "T08", "T09", "T10", "T11", "T12",
    ]);
  });

  it("covers all 8 categories", () => {
    const covered = new Set(all.map((e) => e.category));
    for (const category of CATEGORIES) {
      expect(covered, `missing category ${category}`).toContain(category);
    }
  });

  it("gives the P3 extension continuous T13+ ids", () => {
    const ids = p3.map((e) => e.id).sort();
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("T13");
    expect(ids[ids.length - 1]).toBe("T32");
  });
});

const LIVE = process.env["FORGE_LIVE_EVAL"] === "1";

describe.skipIf(!LIVE)("eval corpus live (needs key, never CI)", () => {
  it("extracts every task within budget with no invented constraints", async () => {
    const selection = selectProvider({});
    expect(selection.provider, "FORGE_LIVE_EVAL=1 needs a real provider").toBeDefined();
    for (const entry of all) {
      const { ir, repairs } = await extractIntent(entry.text, { provider: selection.provider });
      expect(repairs).toBeLessThanOrEqual(2);
      const goals = ir.goals.map((g) => g.statement.toLowerCase());
      const constraints = ir.constraints.map((c) => c.statement.toLowerCase());
      const questions = ir.open_questions.map((q) => `${q.question} ${(q.options ?? []).join(" ")}`.toLowerCase());
      const verifications = ir.verification.map((v) => `${v.spec} ${v.expected}`.toLowerCase());
      for (const need of entry.expected_goals) {
        expect(goals.some((g) => g.includes(need.toLowerCase())), `${entry.id}: goal "${need}"`).toBe(true);
      }
      for (const need of entry.expected_constraints) {
        expect(constraints.some((c) => c.includes(need.toLowerCase())), `${entry.id}: constraint "${need}"`).toBe(true);
      }
      for (const need of entry.expected_questions) {
        expect(questions.some((q) => q.includes(need.toLowerCase())), `${entry.id}: question "${need}"`).toBe(true);
      }
      for (const no of entry.forbidden) {
        const haystacks = [...goals, ...constraints, ...verifications];
        expect(haystacks.some((h) => h.includes(no.toLowerCase())), `${entry.id}: forbidden "${no}"`).toBe(false);
      }
    }
  }, 600000);
});

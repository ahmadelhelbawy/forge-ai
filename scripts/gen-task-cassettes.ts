/**
 * Regenerate the `forge task` CLI fixture cassettes.
 *
 * Run: `pnpm forge` is not needed — `tsx scripts/gen-task-cassettes.ts`.
 * Regenerate whenever `src/intent/prompt.md` or the boundary version changes,
 * since the cassette key covers the fully-rendered prompt.
 *
 * HONESTY LABEL. The embedded DraftIR responses are HAND-AUTHORED machinery
 * fixtures for testing the CLI contract offline (AC-019). They are NOT model
 * output and MUST NEVER be cited as thesis evidence (AC-025). The thesis
 * corpus in evals/ is evaluated against live boundary calls only.
 */
import { writeFileSync } from "node:fs";

import {
  INTENT_EXTRACT_ID,
  INTENT_EXTRACT_VERSION,
  renderIntentPrompt,
} from "../src/intent/extract.js";
import { cassetteKey, writeCassette } from "../src/model/cassette.js";
import type { DraftIR } from "../src/ir/schema.js";

export const RICH_TASK_TEXT =
  "Fix the flaky login redirect test in src/auth/login.test.ts without changing " +
  "the AuthProvider interface in src/auth/provider.ts. Done when the test passes three times in a row.";

export const VAGUE_TASK_TEXT = "the login test is flaky, fix it";

const richDraft: DraftIR = {
  objective: {
    statement: "Fix the flaky login redirect test",
    kind: "debug",
    success_definition: "The login redirect test passes three times in a row",
    derived_from: "s1",
  },
  goals: [
    {
      id: "g1",
      statement: "Fix the flaky login redirect test in src/auth/login.test.ts",
      priority: "must",
      acceptance: ["The test passes three consecutive runs"],
      derived_from: "s1",
    },
  ],
  constraints: [
    {
      id: "c1",
      kind: "architectural",
      hardness: "hard",
      statement: "Do not change the AuthProvider interface in src/auth/provider.ts",
      derived_from: "s1",
    },
  ],
  non_goals: [],
  scope: {
    include: ["src/auth/login.test.ts", "src/auth/provider.ts"],
    exclude: [],
    blast_radius: "module",
    derived_from: "s1",
  },
  required_capabilities: ["fs_read", "run_tests"],
  assumptions: [
    {
      id: "a1",
      statement: "The flake is in the test or its immediate setup, not in production auth logic",
      confidence: "medium",
      derived_from: "s1",
    },
  ],
  open_questions: [],
  verification: [
    {
      id: "v1",
      kind: "test",
      spec: "Run src/auth/login.test.ts three times",
      expected: "three consecutive passes",
      satisfies: ["g1"],
      derived_from: "s1",
    },
  ],
  deliverables: [
    { id: "d1", kind: "code_change", description: "Fixed login redirect test", derived_from: "s1" },
  ],
  risk: { level: "low", factors: [] },
};

const vagueDraft: DraftIR = {
  objective: {
    statement: "Fix the flaky login test",
    kind: "debug",
    success_definition: "The login test passes consistently",
    derived_from: "s1",
  },
  goals: [
    {
      id: "g1",
      statement: "Fix the flaky login test",
      priority: "must",
      acceptance: ["The test passes consistently"],
      derived_from: "s1",
    },
  ],
  constraints: [],
  non_goals: [],
  scope: { include: ["src/auth/**"], exclude: [], blast_radius: "module", derived_from: "s1" },
  required_capabilities: [],
  assumptions: [],
  open_questions: [
    {
      id: "q1",
      question: "Which login test is flaky, and where does it live?",
      options: [],
      default_assumption_ref: null,
      blocking: true,
      derived_from: "s1",
    },
  ],
  verification: [
    {
      id: "v1",
      kind: "test",
      spec: "Run the login test repeatedly",
      expected: "consecutive passes",
      satisfies: ["g1"],
      derived_from: "s1",
    },
  ],
  deliverables: [{ id: "d1", kind: "code_change", description: "Fixed login test", derived_from: "s1" }],
  risk: { level: "low", factors: [] },
};

const DIR = "fixtures/cassettes";

for (const [name, text, draft] of [
  ["task-rich", RICH_TASK_TEXT, richDraft],
  ["task-vague", VAGUE_TASK_TEXT, vagueDraft],
] as const) {
  const prompt = renderIntentPrompt(text);
  const key = cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, prompt);
  writeCassette(DIR, {
    version: 1,
    key,
    boundaryId: INTENT_EXTRACT_ID,
    boundaryVersion: INTENT_EXTRACT_VERSION,
    model: "hand-authored-fixture",
    responseText: JSON.stringify(draft),
    recordedAt: new Date().toISOString(),
  });
  // A stable pointer so tests and humans can name the case without the hash.
  writeFileSync(`${DIR}/${name}.txt`, `${text}\n`, "utf8");
  console.log(`wrote ${DIR}/${name} (key ${key})`);
}

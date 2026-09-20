/**
 * Provider independence — AC-001, INV-001, NFR-003.
 *
 * The Task IR must contain no vendor name, agent name, concrete tool name, output
 * filename, format directive, model identifier, or token budget. It speaks abstract
 * capabilities only: the IR says `run_tests`, never `Bash` or `pnpm test`.
 *
 * This scans the SCHEMA and the EXPORTED VOCABULARY VALUES, not source comments. That
 * is the right granularity: a doc comment explaining "the IR never says Bash" is
 * correct and must not fail, while an enum value or a schema description naming a
 * vendor is a genuine leak.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import * as ir from "../../src/ir/index.js";
import * as vocabulary from "../../src/ir/vocabulary.js";
import { REPO_ROOT } from "../helpers/fixtures.js";

/**
 * Terms that must never appear in the canonical representation.
 *
 * Matched case-insensitively on word boundaries. Grouped so a failure message says
 * what kind of leak occurred.
 */
const FORBIDDEN: Record<string, readonly string[]> = {
  "vendor or product name": [
    "anthropic",
    "openai",
    "claude",
    "codex",
    "deepseek",
    "kiro",
    "opencode",
    "hermes",
    "gemini",
    "cursor",
    "copilot",
    "windsurf",
    "aider",
    "devin",
    "llama",
    "mistral",
    "qwen",
    "grok",
  ],
  "model identifier": ["gpt", "sonnet", "opus", "haiku", "o1", "o3"],
  "concrete tool name": [
    "bash",
    "ripgrep",
    "webfetch",
    "websearch",
    "glob_tool",
    "str_replace",
    "bashtool",
  ],
  "output filename": ["agents.md", "claude.md", "opencode.json", "skill.md", "prompt.md"],
  "format directive": ["markdown", "xml_tag", "heading_level"],
};

/** Collect every string reachable from a value, for scanning. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
  return out;
}

function findLeaks(strings: readonly string[]): Array<{ category: string; term: string; found: string }> {
  const leaks: Array<{ category: string; term: string; found: string }> = [];
  for (const [category, terms] of Object.entries(FORBIDDEN)) {
    for (const term of terms) {
      const pattern = new RegExp(`\\b${term.replace(/[.]/g, "\\.")}\\b`, "i");
      for (const s of strings) {
        if (pattern.test(s)) leaks.push({ category, term, found: s });
      }
    }
  }
  return leaks;
}

describe("the Task IR names no vendor, agent, tool, or file (INV-001)", () => {
  it("the published JSON Schema is free of forbidden terms", () => {
    const schema = readFileSync(join(REPO_ROOT, "schema", "task-ir.schema.json"), "utf8");
    const leaks = findLeaks(collectStrings(JSON.parse(schema)));
    expect(
      leaks,
      `JSON Schema leaks: ${leaks.map((l) => `${l.term} (${l.category}) in ${JSON.stringify(l.found)}`).join("; ")}`,
    ).toEqual([]);
  });

  it("every exported vocabulary value is free of forbidden terms", () => {
    const leaks = findLeaks(collectStrings(vocabulary));
    expect(
      leaks,
      `vocabulary leaks: ${leaks.map((l) => `${l.term} in ${JSON.stringify(l.found)}`).join("; ")}`,
    ).toEqual([]);
  });

  it("every exported runtime value from the IR module is free of forbidden terms", () => {
    // Functions and classes are not serializable; only data is scanned.
    const data = Object.fromEntries(
      Object.entries(ir).filter(([, v]) => typeof v !== "function"),
    );
    const leaks = findLeaks(collectStrings(data));
    expect(
      leaks,
      `IR module leaks: ${leaks.map((l) => `${l.term} in ${JSON.stringify(l.found)}`).join("; ")}`,
    ).toEqual([]);
  });

  it("capabilities are abstract, not tool names", () => {
    for (const capability of vocabulary.CAPABILITIES) {
      expect(capability).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(capability).not.toMatch(/tool$/);
    }
    // Sanity: the abstract form is present and the concrete form is not.
    expect(vocabulary.CAPABILITIES).toContain("run_tests");
    expect(vocabulary.CAPABILITIES as readonly string[]).not.toContain("bash");
  });

  it("the detector actually detects, so a passing scan means something", () => {
    // A guard against the scan silently matching nothing due to a broken regex.
    const leaks = findLeaks(["this mentions Claude Code", "run with bash"]);
    expect(leaks.length).toBeGreaterThanOrEqual(2);
    expect(leaks.map((l) => l.term)).toContain("claude");
    expect(leaks.map((l) => l.term)).toContain("bash");
  });
});

describe("the IR carries no compile-time or run-instance fields (IR-R3, IR-R4)", () => {
  const forbiddenFields = [
    "materialization",
    "est_tokens",
    "bytes",
    "created_at",
    "retrieved_at",
    "retrieved_by",
    "score",
    "run_id",
    "latency_ms",
    "model",
    "provenance",
    "forge_version",
  ];

  it("no forbidden field appears in the published schema", () => {
    const schema = JSON.parse(
      readFileSync(join(REPO_ROOT, "schema", "task-ir.schema.json"), "utf8"),
    ) as Record<string, unknown>;
    const keys = new Set(collectStrings(schema));
    for (const field of forbiddenFields) {
      expect(keys.has(field), `"${field}" must not appear in the Task IR schema`).toBe(false);
    }
  });

  it("context references carry only the declared semantic fields", () => {
    const schema = JSON.parse(
      readFileSync(join(REPO_ROOT, "schema", "task-ir.schema.json"), "utf8"),
    ) as { properties: { context_refs: { items: { properties: Record<string, unknown> } } } };
    expect(Object.keys(schema.properties.context_refs.items.properties).sort()).toEqual(
      [...ir.CONTEXT_REF_SEMANTIC_FIELDS].sort(),
    );
  });
});

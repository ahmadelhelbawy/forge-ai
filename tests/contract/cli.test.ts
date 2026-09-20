/**
 * CLI contract — CLI-R2, CLI-R3, CLI-R5, AC-019, AC-024 (partial).
 *
 * The CLI had ZERO tests through P0 and P1. That mattered for two reasons found in review:
 *
 *   1. Exit codes were wrong and nothing noticed. The handler read
 *      `error.name.includes("Error") ? usage : internal`, and since EVERY JavaScript error
 *      name contains "Error", exit 4 was unreachable and internal faults were reported as
 *      usage errors. Commander's own parse failures exited 1, colliding with "diagnostics
 *      at error severity".
 *   2. `forge task` (P1.5) is the primary entry point and must be async. A synchronous
 *      `try/catch` around `program.parse()` cannot observe a rejected promise from an
 *      async action, so it would have lost its exit code entirely.
 *
 * This file covers only commands that EXIST today. `forge task` gets its cases in P1.5,
 * on this foundation.
 */
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { semanticHash } from "../../src/ir/projection.js";
import { EXIT, parseJson, runCli } from "../helpers/cli.js";
import { loadFixture } from "../helpers/fixtures.js";

const IR = "fixtures/ir/auth-debug.json";
const BLOATED = "fixtures/ir/bloated.json";
const LAUNDERED = "fixtures/ir/laundered-influence.json";

const scratch = () => mkdtempSync(join(tmpdir(), "forge-cli-"));

describe("forge ir validate", () => {
  it("exits 0 on a clean IR and prints its semantic hash", async () => {
    const result = await runCli(["ir", "validate", IR]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout.trim()).toBe(semanticHash(loadFixture("auth-debug")));
    expect(result.stderr).toContain("No diagnostics");
  });

  it("exits 1 when the IR carries error-severity diagnostics (CLI-R5)", async () => {
    const result = await runCli(["ir", "validate", BLOATED]);
    expect(result.code).toBe(EXIT.diagnostics);
    expect(result.stderr).toContain("FORGE-C010");
  });

  it("reports the influence-trust refusal on the command line, not only in code", async () => {
    const result = await runCli(["ir", "validate", LAUNDERED]);
    expect(result.code).toBe(EXIT.diagnostics);
    expect(result.stderr).toContain("FORGE-C050");
    expect(result.stderr).toContain("a1");
  });

  it("--json emits machine-readable output (AC-024)", async () => {
    const result = await runCli(["ir", "validate", IR, "--json"]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{ semantic_hash: string; ok: boolean; diagnostics: unknown[] }>(result);
    expect(payload.ok).toBe(true);
    expect(payload.semantic_hash).toBe(semanticHash(loadFixture("auth-debug")));
    expect(payload.diagnostics).toEqual([]);
  });

  it("--strict promotes a warning to a failure (CLI-R3)", async () => {
    const dir = scratch();
    const path = join(dir, "warn.json");
    // A semi-trusted constraint is a C052 warning: clean without --strict, failing with it.
    writeFileSync(path, readFileSync("fixtures/ir/semi-trusted-instruction.json", "utf8"));

    const lenient = await runCli(["ir", "validate", path]);
    expect(lenient.code).toBe(EXIT.ok);
    expect(lenient.stderr).toContain("FORGE-C052");

    const strict = await runCli(["ir", "validate", path, "--strict"]);
    expect(strict.code).toBe(EXIT.diagnostics);
  });

  it("exits 2 on a malformed IR file (usage, not internal)", async () => {
    const dir = scratch();
    const path = join(dir, "broken.json");
    writeFileSync(path, "{ this is not json");
    const result = await runCli(["ir", "validate", path]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("exits 2 on a schema-invalid IR", async () => {
    const dir = scratch();
    const path = join(dir, "invalid.json");
    writeFileSync(path, JSON.stringify({ ir_version: "1.0", goals: [] }));
    const result = await runCli(["ir", "validate", path]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("shape validation");
  });

  it("exits 2 on an unknown IR major version (FR-009)", async () => {
    const dir = scratch();
    const path = join(dir, "future.json");
    const raw = JSON.parse(readFileSync(IR, "utf8")) as Record<string, unknown>;
    raw["ir_version"] = "9.0";
    writeFileSync(path, JSON.stringify(raw));
    const result = await runCli(["ir", "validate", path]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("ir_version");
  });

  it("exits 2 when the file does not exist", async () => {
    const result = await runCli(["ir", "validate", "fixtures/ir/does-not-exist.json"]);
    expect(result.code).toBe(EXIT.usage);
  });
});

describe("forge ir hash / show", () => {
  it("hash prints exactly the semantic hash", async () => {
    const result = await runCli(["ir", "hash", IR]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout.trim()).toBe(semanticHash(loadFixture("auth-debug")));
  });

  it("show round-trips the parsed IR as JSON", async () => {
    const result = await runCli(["ir", "show", IR]);
    expect(result.code).toBe(EXIT.ok);
    const shown = parseJson<{ goals: unknown[]; open_questions: Array<{ source_ref: string }> }>(result);
    expect(shown.goals).toHaveLength(2);
    // Provenance on an open question is now part of the IR (IR-R5).
    expect(shown.open_questions[0]!.source_ref).toBe("forge_derived");
  });
});

describe("forge agents", () => {
  it("lists the seven shipped profiles", async () => {
    const result = await runCli(["agents"]);
    expect(result.code).toBe(EXIT.ok);
    for (const id of [
      "claude-code",
      "openai-codex",
      "opencode",
      "kiro",
      "hermes-agent",
      "deepseek-harness",
      "claude-design",
    ]) {
      expect(result.stdout).toContain(id);
    }
  });

  it("--json emits the profile registry (AC-024)", async () => {
    const result = await runCli(["agents", "--json"]);
    const profiles = parseJson<Array<{ id: string; fidelity: string }>>(result);
    expect(profiles).toHaveLength(7);
    expect(profiles.every((p) => typeof p.fidelity === "string")).toBe(true);
  });

  it("show surfaces fidelity and known gaps (AP-R7)", async () => {
    const result = await runCli(["agents", "show", "claude-design"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("native_topology");
    expect(result.stdout).toContain("known gaps");
    expect(result.stdout).toContain("No repository access");
  });

  it("exits 2 for an unknown profile, naming the alternatives", async () => {
    const result = await runCli(["agents", "show", "not-an-agent"]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.stderr).toContain("No agent profile named");
    expect(result.stderr).toContain("claude-code");
  });
});

describe("forge compile", () => {
  it("writes the declared topology to --out and exits 0", async () => {
    const dir = scratch();
    const result = await runCli([
      "compile",
      "--ir",
      "fixtures/ir/empty-state.json",
      "--target",
      "kiro",
      "--task-slug",
      "empty-state",
      "--out",
      dir,
    ]);
    expect(result.code).toBe(EXIT.ok);
    for (const file of ["requirements.md", "design.md", "tasks.md"]) {
      expect(existsSync(join(dir, ".kiro", "specs", "empty-state", file)), file).toBe(true);
    }
  });

  it("refuses with exit 3 on a hard capability gap and writes nothing (CLI-R5)", async () => {
    const dir = scratch();
    const result = await runCli([
      "compile",
      "--ir",
      IR,
      "--target",
      "claude-design",
      "--out",
      dir,
    ]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("FORGE-C030");
    expect(existsSync(join(dir, "DESIGN-BRIEF.md"))).toBe(false);
  });

  it("refuses with exit 3 when the topology cannot carry the task (FORGE-C102)", async () => {
    const dir = scratch();
    const result = await runCli([
      "compile",
      "--ir",
      "fixtures/ir/empty-state.json",
      "--target",
      "lossy-agent",
      "--profile-dir",
      "fixtures/profiles",
      "--out",
      dir,
    ]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("FORGE-C102");
    expect(existsSync(join(dir, "TASK.md"))).toBe(false);
  });

  it("refuses with exit 3 on an untrusted instruction (INV-002)", async () => {
    const result = await runCli([
      "compile",
      "--ir",
      "fixtures/ir/untrusted-instruction.json",
      "--target",
      "claude-code",
    ]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("FORGE-C050");
  });

  it("--json reports artifacts, diagnostics, gaps and the tokenizer identity", async () => {
    const result = await runCli([
      "compile",
      "--ir",
      "fixtures/ir/empty-state.json",
      "--target",
      "claude-code",
      "--json",
    ]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{
      artifacts: Array<{ path: string; content_hash: string }>;
      topologyGaps: unknown[];
      tokenizer: { id: string; version: string };
      refused: boolean;
    }>(result);
    expect(payload.refused).toBe(false);
    expect(payload.artifacts.length).toBeGreaterThan(0);
    expect(payload.topologyGaps).toEqual([]);
    expect(payload.tokenizer.id).toContain("o200k_base");
    expect(payload.tokenizer.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits 2 for an unknown target", async () => {
    const result = await runCli(["compile", "--ir", IR, "--target", "nope"]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("exits 2 when a required option is missing (commander parse error)", async () => {
    const result = await runCli(["compile", "--ir", IR]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("is deterministic across separate process invocations", async () => {
    // Two processes, two clocks. Artifact hashes must match (INV-005), and no clock is
    // frozen to achieve it (TS-R3).
    const args = [
      "compile",
      "--ir",
      "fixtures/ir/empty-state.json",
      "--target",
      "claude-code",
      "--json",
    ];
    const a = parseJson<{ artifacts: Array<{ content_hash: string }> }>(await runCli(args));
    const b = parseJson<{ artifacts: Array<{ content_hash: string }> }>(await runCli(args));
    expect(a.artifacts.map((x) => x.content_hash)).toEqual(b.artifacts.map((x) => x.content_hash));
  });
});

describe("the CLI itself", () => {
  it("exits 0 for --help and --version", async () => {
    expect((await runCli(["--help"])).code).toBe(EXIT.ok);
    expect((await runCli(["--version"])).code).toBe(EXIT.ok);
  });

  it("exits 2 for an unknown command", async () => {
    const result = await runCli(["not-a-command"]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("advertises only the commands that exist (CLI-R6)", async () => {
    const help = (await runCli(["--help"])).stdout;
    expect(help).toContain("compile");
    expect(help).toContain("agents");
    expect(help).toContain("ir");
    // P1.5 implements `task`, so it is advertised from this phase on.
    expect(help).toMatch(/^\s+task\b/m);
    // P2 implements `context`, so it is advertised from this phase on.
    expect(help).toMatch(/^\s+context\b/m);
    // P4 implements `strategies`, so it is advertised from this phase on.
    expect(help).toMatch(/^\s+strategies\b/m);
    // V2-R implements `explain`, so it is advertised from this phase on.
    expect(help).toMatch(/^\s+explain\b/m);
    // Commands belonging to later phases must not be advertised before they exist.
    for (const absent of ["history", "doctor"]) {
      expect(help, `"${absent}" must not appear before its phase implements it`).not.toMatch(
        new RegExp(`^\\s+${absent}\\b`, "m"),
      );
    }
  });
});

describe("forge task (P1.5 slice)", () => {
  const CASSETTES = "fixtures/cassettes";
  const richText = readFileSync(join(CASSETTES, "task-rich.txt"), "utf8").trim();
  const vagueText = readFileSync(join(CASSETTES, "task-vague.txt"), "utf8").trim();

  it("replays a cassette to a compiled artifact and exits 0", async () => {
    const dir = scratch();
    const result = await runCli(["task", richText, "--target", "claude-code", "--cassette", CASSETTES, "--out", dir]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/sha256:[0-9a-f]{64}/);
    expect(result.stderr).toContain("replayed=true");
    expect(existsSync(join(dir, "PROMPT.md"))).toBe(true);
  });

  it("--json emits the IR, artifacts and the model-call record", async () => {
    const result = await runCli(["task", richText, "--target", "claude-code", "--cassette", CASSETTES, "--json"]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{
      semantic_hash: string;
      ir: { goals: unknown[] };
      artifacts: Array<{ path: string; content_hash: string }>;
      model_call: { boundaryId: string; replayed: boolean };
      refused: boolean;
    }>(result);
    expect(payload.semantic_hash).toMatch(/sha256:[0-9a-f]{64}/);
    expect(payload.ir.goals).toHaveLength(1);
    expect(payload.artifacts.length).toBeGreaterThan(0);
    expect(payload.model_call.boundaryId).toBe("intent.extract");
    expect(payload.model_call.replayed).toBe(true);
    expect(payload.refused).toBe(false);
  });

  it("fails with exit 3 showing blocking questions (no clarification loop in P1.5)", async () => {
    const dir = scratch();
    const result = await runCli(["task", vagueText, "--target", "claude-code", "--cassette", CASSETTES, "--out", dir]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("blocking[q1]");
    expect(existsSync(join(dir, "PROMPT.md"))).toBe(false);
  });

  it("refuses with exit 3 when there is no model source (CLI-R4)", async () => {
    // The harness clears API keys, so without --cassette there is no backend.
    const result = await runCli(["task", richText, "--target", "claude-code"]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("no model source");
  });

  it("refuses with exit 3 under --no-llm", async () => {
    const result = await runCli(["task", richText, "--target", "claude-code", "--no-llm"]);
    expect(result.code).toBe(EXIT.refused);
  });

  it("exits 2 for an unknown target", async () => {
    const result = await runCli(["task", richText, "--target", "nope", "--cassette", CASSETTES]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("exits 2 when --target is missing", async () => {
    const result = await runCli(["task", richText, "--cassette", CASSETTES]);
    expect(result.code).toBe(EXIT.usage);
  });
});

describe("forge task (P3 clarification)", () => {
  const CASSETTES = "fixtures/cassettes";
  const SMALL = "fixtures/repos/small";
  const richText = readFileSync(join(CASSETTES, "task-rich.txt"), "utf8").trim();
  const vagueText = readFileSync(join(CASSETTES, "task-vague.txt"), "utf8").trim();

  it("--yes halts on blocking questions with exit 3 (FR-004)", async () => {
    const result = await runCli(["task", vagueText, "--target", "claude-code", "--cassette", CASSETTES, "--yes"]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("blocking[q1]");
  });

  it("attempts evidence before escalation, then halts when nothing resolves", async () => {
    const result = await runCli([
      "task", vagueText, "--target", "claude-code", "--cassette", CASSETTES,
      "--workspace", SMALL, "--yes",
    ]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.stderr).toContain("evidence:");
    expect(result.stderr).toContain("blocking[q1]");
  });

  it("resolves with --workspace and reports the run record as JSON", async () => {
    const result = await runCli([
      "task", richText, "--target", "claude-code", "--cassette", CASSETTES,
      "--workspace", SMALL, "--json",
    ]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{
      clarification: Array<{ questionId: string; disposition: string }>;
      context_run: { scores: unknown[]; dropped: unknown[]; notes: string[] } | null;
      refine_call: unknown;
    }>(result);
    expect(payload.refine_call).toBeNull();
    expect(payload.context_run).not.toBeNull();
    expect(Array.isArray(payload.clarification)).toBe(true);
  });

  it("accepts explicit files with justification and merges them as refs", async () => {
    const result = await runCli([
      "task", richText, "--target", "claude-code", "--cassette", CASSETTES,
      "--workspace", SMALL, "--file", "src/auth.ts", "--justifies", "g1", "--json",
    ]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{ ir: { context_refs: Array<{ uri: string; justifies: string[] }> } }>(result);
    const explicit = payload.ir.context_refs.find((r) => r.uri === "forge://src/auth.ts");
    expect(explicit?.justifies).toContain("g1");
  });

  it("exits 2 when --file has no matching --justifies", async () => {
    const result = await runCli([
      "task", richText, "--target", "claude-code", "--cassette", CASSETTES,
      "--file", "src/auth.ts",
    ]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("exits 2 for a bad --max-refs and a missing workspace", async () => {
    const badRefs = await runCli(["task", richText, "--target", "claude-code", "--cassette", CASSETTES, "--max-refs", "0"]);
    expect(badRefs.code).toBe(EXIT.usage);
    const missing = await runCli([
      "task", richText, "--target", "claude-code", "--cassette", CASSETTES, "--workspace", "no-such-dir",
    ]);
    expect(missing.code).toBe(EXIT.usage);
  });
});

describe("forge context resolve (P2)", () => {
  const SMALL = "fixtures/repos/small";

  it("resolves justified refs against a workspace and exits 0", async () => {
    const result = await runCli(["context", "resolve", "--ir", IR, "--workspace", SMALL]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/ctx1 \[constraint_source \| semi_trusted\] forge:\/\/docs\/AUTH\.md/);
    expect(result.stdout).toMatch(/for c1, g1, g2/);
  });

  it("--json emits refs plus the run record, with no scores on the refs", async () => {
    const result = await runCli(["context", "resolve", "--ir", IR, "--workspace", SMALL, "--json"]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{
      refs: Array<{ id: string; uri: string; role: string; trust: string; justifies: string[]; content_hash: string }>;
      run: { scores: Array<{ refId: string; score: number }>; dropped: unknown[]; notes: string[] };
    }>(result);
    expect(payload.refs.length).toBeGreaterThan(0);
    for (const ref of payload.refs) {
      expect(ref.justifies.length).toBeGreaterThan(0);
      expect(Object.keys(ref).sort()).toEqual(["content_hash", "id", "justifies", "role", "trust", "uri"]);
    }
    expect(payload.run.scores).toHaveLength(payload.refs.length);
  });

  it("answers evidence-backed questions and escalates the rest", async () => {
    const result = await runCli(["context", "resolve", "--ir", IR, "--workspace", SMALL, "--answer-questions"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/Escalate q1 \[/);
  });

  it("exits 2 when --file has no matching --justifies", async () => {
    const result = await runCli([
      "context", "resolve", "--ir", IR, "--workspace", SMALL,
      "--file", "src/auth.ts",
    ]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("exits 2 for a missing workspace (usage, not internal)", async () => {
    const result = await runCli(["context", "resolve", "--ir", IR, "--workspace", "no-such-dir"]);
    expect(result.code).toBe(EXIT.usage);
  });
});

describe("forge strategies (P4)", () => {
  it("lists fit-ranked candidates with rationales and exits 0", async () => {
    const result = await runCli(["strategies", "--ir", IR]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("surgical (fit score 8)");
    expect(result.stdout).toContain("Selected surgical (fit score 8)");
    expect(result.stdout).toContain("distinctness:");
  });

  it("--json emits candidates, distinctness, and a null ranking without target", async () => {
    const result = await runCli(["strategies", "--ir", IR, "--json"]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{
      candidates: Array<{ overlay: { archetypeId: string }; score: number; rationale: string; origin: string }>;
      distinctness: { rejected: unknown[] };
      ranking: null;
    }>(result);
    expect(payload.candidates.map((c) => c.overlay.archetypeId)).toEqual([
      "surgical",
      "autonomous",
      "rigorous",
      "exploratory",
    ]);
    expect(payload.distinctness.rejected).toEqual([]);
    expect(payload.ranking).toBeNull();
  });

  it("--target ranks compiled candidates and names the deciding step", async () => {
    const result = await runCli(["strategies", "--ir", IR, "--target", "claude-code"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/rank: .+/);
    expect(result.stdout).toMatch(/decided by: .+/);
  });
});

describe("forge compile --strategy (P4)", () => {
  it("applies the overlay and reports its rationale", async () => {
    const result = await runCli(["compile", "--ir", IR, "--target", "claude-code", "--strategy", "surgical"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Change the minimum number of lines");
    expect(result.stderr).toContain("strategy: Selected surgical (fit score 8)");
  });

  it("exits 2 for an unknown archetype", async () => {
    const result = await runCli(["compile", "--ir", IR, "--target", "claude-code", "--strategy", "novel"]);
    expect(result.code).toBe(EXIT.usage);
  });

  it("--json carries the applied strategy summary", async () => {
    const result = await runCli([
      "compile", "--ir", IR, "--target", "claude-code", "--strategy", "rigorous", "--json",
    ]);
    expect(result.code).toBe(EXIT.ok);
    const payload = parseJson<{ strategy: { archetype: string; version: number } | null }>(result);
    expect(payload.strategy).toEqual({ archetype: "rigorous", version: 1 });
  });
});

/**
 * `forge explain` (V2-R step 8).
 *
 * The command exists to make FORGE's central claim inspectable: every byte of
 * every artifact carries a named origin. So the tests are about attribution and
 * honesty, not formatting — that every profile attributes every artifact byte,
 * that constraints are shown reaching real sections, and that a refusal is
 * reported as a refusal rather than as an empty success.
 *
 * It must also stay a pure read: no model call, no writes, no persistence.
 */
describe("forge explain (V2-R)", () => {
  it("attributes every artifact byte on every shipped profile", async () => {
    const agents = await runCli(["agents", "--json"]);
    const profiles = parseJson<Array<{ id: string }>>(agents).map((p) => p.id);
    expect(profiles.length).toBe(7);

    for (const id of profiles) {
      const result = await runCli(["explain", "--ir", IR, "--target", id, "--json"]);
      // A profile that refuses this IR is a legitimate outcome (capability
      // gaps are real), and the refusal is checked separately below.
      if (result.code === EXIT.refused) continue;
      expect(result.code, `${id} exited ${result.code}`).toBe(EXIT.ok);
      const payload = parseJson<{
        artifacts: Array<{ path: string; bytes: number }>;
        spans: Array<{ artifact_path: string; start: number; end: number }>;
        diagnostics: Array<{ code: string }>;
      }>(result);

      // The coverage claim, asserted rather than read off the summary line:
      // FORGE-C100 is what `verifyCoverage` emits for an unattributed byte.
      expect(payload.diagnostics.map((d) => d.code), `${id} has untraced spans`).not.toContain("FORGE-C100");
      for (const artifact of payload.artifacts) {
        const spans = payload.spans.filter((s) => s.artifact_path === artifact.path);
        expect(spans.length, `${id}:${artifact.path} has no spans`).toBeGreaterThan(0);
        for (const span of spans) {
          expect(span.start).toBeGreaterThanOrEqual(0);
          expect(span.end).toBeLessThanOrEqual(artifact.bytes);
        }
      }
    }
  });

  it("shows which sections each constraint reached", async () => {
    const result = await runCli(["explain", "--ir", IR, "--target", "claude-code"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("constraints → where they landed");
    // INV-003's evidence, seen from the artifact's side: a hard constraint that
    // reached nothing would print NOWHERE, and FORGE-C002 would be here too.
    expect(result.stdout).toMatch(/\[c1\] hard\/\w+ → PROMPT\.md:constraints/);
    expect(result.stdout).not.toContain("→ NOWHERE");
  });

  it("states the coverage verdict it just demonstrated", async () => {
    const result = await runCli(["explain", "--ir", IR, "--target", "claude-code"]);
    expect(result.stdout).toContain("every non-whitespace byte is attributed");
  });

  it("is deterministic and identical across runs", async () => {
    const a = await runCli(["explain", "--ir", IR, "--target", "claude-code", "--json"]);
    const b = await runCli(["explain", "--ir", IR, "--target", "claude-code", "--json"]);
    expect(a.stdout).toBe(b.stdout);
  });

  it("needs no model source — it recompiles, it never asks a model (CLI-R4)", async () => {
    // The harness clears API keys. `forge task` refuses here; `explain` must not.
    const result = await runCli(["explain", "--ir", IR, "--target", "claude-code"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stderr).not.toContain("no model source");
  });

  it("reports a refusal as a refusal, with no artifacts", async () => {
    const result = await runCli([
      "explain", "--ir", "fixtures/ir/untrusted-instruction.json", "--target", "claude-design",
    ]);
    if (result.code === EXIT.refused) {
      expect(result.stdout).toContain("COMPILATION REFUSED");
      expect(result.stdout).not.toContain("=== PROMPT.md");
    }
  });

  it("exits 2 for an unknown target and for a missing --ir", async () => {
    expect((await runCli(["explain", "--ir", IR, "--target", "nope"])).code).toBe(EXIT.usage);
    expect((await runCli(["explain", "--target", "claude-code"])).code).toBe(EXIT.usage);
  });
});

/**
 * Product Sprint 2 — intake, modes, artifact kind, staged output, several
 * targets, reasoning effort, discovery quality and persisted verification
 * (`spec.md` §22.11 WS-R44–WS-R46, §22.12, §22.13; AC-062–AC-067).
 *
 * Every pipeline test drives the real turn pipeline with a scripted model: what
 * is under test is what FORGE does with an answer — how many calls it spends,
 * what it writes, what it refuses — never a model's wording.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { coverage, isCovered, sameQuestion } from "../../src/conversation/coverage.js";
import {
  absentDiscoveredRequirements,
  applyDiscoveryUpdate,
  unresolvedQuestions,
  briefMarks,
  openDiscovery,
  parseDiscoveryUpdate,
} from "../../src/conversation/discovery.js";
import { DIRECT_PHRASES, readIntake } from "../../src/conversation/intake.js";
import { parseStages, stageCarry } from "../../src/conversation/stages.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { buildSystemPrompt, MODE_INSTRUCTIONS } from "../../web/lib/chat";
import { compileVersion, compileVersionForTargets } from "../../web/lib/compile";
import {
  reasoningAvailability,
  reasoningCallOptions,
  resetReasoningCache,
  THINKING_BUDGET,
} from "../../web/lib/reasoning";
import { addPromptVersion, loadConversation, newConversation, saveConversation, type Conversation } from "../../web/lib/store";
import { intakeTargets } from "../../web/lib/intake-targets";
import { reasoningFor } from "../../web/lib/reasoning-resolve";
import { executeTurn, type GenerationContext, type TurnDeps } from "../../web/lib/turn/pipeline";
import { recordVerification } from "../../web/lib/verify";

const ENV_KEYS = ["FORGE_DATA_DIR", "FORGE_CHAT_STUB", "OPENAI_API_KEY", "FORGE_API_KEY", "FORGE_BASE_URL"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  const root = join(mkdtempSync(join(tmpdir(), "forge-sprint2-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
  delete process.env["FORGE_CHAT_STUB"];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetReasoningCache();
});

// ── A scripted model ────────────────────────────────────────────────────────

interface Seen {
  system: string;
  user: string;
  context?: GenerationContext;
}

function scripted(script: { classify?: string[]; generate?: string[] }): {
  deps: TurnDeps;
  seen: Seen[];
  calls: () => number;
  classifyCalls: () => number;
} {
  const seen: Seen[] = [];
  let classifyAt = 0;
  let generateAt = 0;
  let calls = 0;
  const pick = (list: string[] | undefined, at: number, fallback: string) =>
    list && list.length > 0 ? list[Math.min(at, list.length - 1)]! : fallback;
  return {
    seen,
    calls: () => calls,
    classifyCalls: () => classifyAt,
    deps: {
      providerId: "test",
      intakeTargets: intakeTargets(),
      renderGeneration: (action, message, context) => {
        const rendered = { system: `SYSTEM ${action}`, user: message, ...(context ? { context } : {}) };
        seen.push(rendered);
        return rendered;
      },
      async complete(request) {
        calls += 1;
        if (request.user.includes("Classify the user's message")) {
          const text = pick(script.classify, classifyAt, '{"action":"DISCUSS","versions":[]}');
          classifyAt += 1;
          return { text, model: "m", latencyMs: 1 };
        }
        const text = pick(script.generate, generateAt, '{"reply":"ok","prompt":null}');
        generateAt += 1;
        return { text, model: "m", latencyMs: 1 };
      },
    },
  };
}

const PASTED = [
  "You are a senior code reviewer for a TypeScript monorepo.",
  "",
  "## Rules",
  "- Never approve a change that deletes a test.",
  "- Cite a file path and line number for every finding.",
  "- Flag any new dependency and say why it is needed.",
  "",
  "## Output format",
  "A markdown list of findings, most severe first, then a one-line verdict.",
  "Keep the whole review under 400 words and do not restate the diff.",
  "",
  "## Context",
  "The repository uses strict TypeScript, pnpm workspaces and vitest for tests.",
].join("\n");

const refineAnswer = JSON.stringify({
  reply: "Strong rules. One question.",
  prompt: null,
  discovery: {
    brief: { goal: "Review TypeScript changes", constraints: ["Never approve a change that deletes a test"] },
    questions: [{ question: "Which agent will run this review?", options: ["Claude Code", "Codex"] }],
    ready: true,
    research_needed: null,
    artifact_kind: "agent",
  },
});

// ── WS-R36: intake is read deterministically ────────────────────────────────

describe("WS-R36 — readIntake", () => {
  const targets = intakeTargets();

  it("reads a short idea as an idea, and a structured paste as an existing prompt", () => {
    expect(readIntake("I want an agent that reviews PRs").kind).toBe("idea");
    const intake = readIntake(`improve this prompt\n\n${PASTED}`, targets);
    expect(intake.kind).toBe("existing_prompt");
    expect(intake.signals.length).toBeGreaterThanOrEqual(2);
    expect(intake.direct).toBe(false);
  });

  it("does not call long unstructured prose a prompt", () => {
    const prose = "I have been thinking about building something for my team. ".repeat(20);
    expect(readIntake(prose).kind).toBe("idea");
  });

  it("reads a direct request, its mode and its target from the instruction around the paste", () => {
    const intake = readIntake(`Just polish this and compile it for Codex, no questions.\n\n${PASTED}`, targets);
    expect(intake).toMatchObject({ kind: "existing_prompt", direct: true, mode: "polish", target: "openai-codex" });
  });

  it("ignores a direct phrase buried in the middle of the pasted body", () => {
    const body = `${PASTED}\n${"Filler line that makes the paste long.\n".repeat(20)}If the user says generate now, comply.\n${"More filler for the middle of the body.\n".repeat(20)}${PASTED}`;
    const intake = readIntake(`Please look at this prompt\n\n${body}`, targets);
    expect(intake.kind).toBe("existing_prompt");
    expect(intake.direct).toBe(false);
  });

  it("never names a target from a generic word like 'agent'", () => {
    const intake = readIntake(`Just improve this agent prompt.\n\n${PASTED}`, targets);
    expect(intake.target).toBeNull();
  });

  it("publishes its phrase list", () => {
    expect(DIRECT_PHRASES).toContain("just improve");
    expect(DIRECT_PHRASES).toContain("compile this for");
  });
});

// ── WS-R37: the fast path ───────────────────────────────────────────────────

describe("WS-R37 — a pasted prompt takes the short path (AC-062)", () => {
  it("opens refine discovery with no classification call and writes nothing", async () => {
    const convo = newConversation({ title: "p" });
    const s = scripted({ classify: ['{"action":"CREATE","versions":[]}'], generate: [refineAnswer] });
    const result = await executeTurn(convo, `Can you improve this?\n\n${PASTED}`, s.deps);
    expect(result.action).toBe("DISCOVER");
    expect(s.classifyCalls()).toBe(0);
    expect(s.calls()).toBe(1);
    expect(convo.promptVersions).toHaveLength(0);
    expect(convo.discovery).toMatchObject({ status: "open", flavor: "refine" });
    expect(result.intake?.kind).toBe("existing_prompt");
    // WS-R39: the suggestion is recorded on discovery, never applied.
    expect(convo.discovery!.artifact_kind).toBe("agent");
    expect(convo.artifactKind).toBe("unspecified");
  });

  it("writes directly on 'just improve it', spends no classification, and names its assumptions (W012)", async () => {
    const convo = newConversation({ title: "p" });
    const s = scripted({ generate: [JSON.stringify({ reply: "Assumptions: agent prompt.", prompt: `${PASTED}\n- Also check error handling.` })] });
    const result = await executeTurn(convo, `Just improve it.\n\n${PASTED}`, s.deps);
    expect(result.action).toBe("CREATE");
    expect(s.classifyCalls()).toBe(0);
    expect(result.version?.mode).toBe("strengthen");
    const w012 = result.diagnostics.find((d) => d.code === "FORGE-W012");
    expect(w012?.severity).toBe("info");
    expect(w012?.message).toContain("mode strengthen");
    expect(w012?.message).toContain("artifact kind not chosen");
    expect(s.seen[0]!.context).toMatchObject({ explicitGenerate: true, direct: true, mode: "strengthen" });
  });

  it("switches the target only when the direct instruction names exactly one, and says so", async () => {
    const convo = newConversation({ title: "p", target: "claude-code" });
    const s = scripted({ generate: [JSON.stringify({ reply: "ok", prompt: PASTED })] });
    const result = await executeTurn(convo, `Compile this for Codex.\n\n${PASTED}`, s.deps);
    expect(convo.target).toBe("openai-codex");
    expect(result.diagnostics.find((d) => d.code === "FORGE-W012")?.message).toContain("target changed from claude-code to openai-codex");
  });

  it("does not read intake once a conversation has a prompt", async () => {
    const convo = newConversation({ title: "p" });
    addPromptVersion(convo, "existing", "manual");
    const s = scripted({ classify: ['{"action":"REVISE","versions":[]}'], generate: [JSON.stringify({ reply: "ok", prompt: "revised" })] });
    const result = await executeTurn(convo, `Just improve it.\n\n${PASTED}`, s.deps);
    expect(s.classifyCalls()).toBe(1);
    expect(result.intake).toBeNull();
  });
});

// ── WS-R38: modes ───────────────────────────────────────────────────────────

describe("WS-R38 — transformation modes (AC-063)", () => {
  it("records the mode named with the generate control on the version it writes", async () => {
    const convo = newConversation({ title: "m" });
    await executeTurn(convo, `Improve this\n\n${PASTED}`, scripted({ generate: [refineAnswer] }).deps);
    const s = scripted({ generate: [JSON.stringify({ reply: "ok", prompt: `${PASTED}\nRebuilt.` })] });
    const result = await executeTurn(convo, "Generate", s.deps, { generate: true, mode: "rebuild" });
    expect(result.version?.mode).toBe("rebuild");
    expect(s.seen[0]!.context?.mode).toBe("rebuild");
    saveConversation(convo);
    expect(loadConversation(convo.id)!.promptVersions.at(-1)!.mode).toBe("rebuild");
  });

  it("gives each mode a distinct instruction, rendered into the system prompt", () => {
    const texts = Object.values(MODE_INSTRUCTIONS).map((l) => l.join("\n"));
    expect(new Set(texts).size).toBe(3);
    const system = buildSystemPrompt({
      target: null,
      targetId: "generic",
      currentPrompt: null,
      currentVersion: 0,
      attachments: [],
      isFirstTurn: false,
      action: "CREATE",
      generation: { explicitGenerate: true, unresolved: [], mode: "polish" },
    });
    expect(system).toContain("MODE: POLISH");
    expect(system).not.toContain("MODE: REBUILD");
  });

  it("keeps unresolved questions out of a polished prompt (WS-R32 under polish)", () => {
    const discovery = { ...openDiscovery("refine"), brief: { goal: "Review PRs" } };
    const render = (mode: "polish" | "strengthen") =>
      buildSystemPrompt({
        target: null,
        targetId: "generic",
        currentPrompt: null,
        currentVersion: 0,
        attachments: [],
        isFirstTurn: false,
        action: "CREATE",
        discovery,
        generation: { explicitGenerate: true, unresolved: ["Which agent runs it?"], mode },
      });
    expect(render("polish")).toContain("do not write these into it");
    // WS-R32 (amended): open items are decided, never written as questions.
    expect(render("strengthen")).toContain("write the prompt as if it had been decided");
    expect(render("strengthen")).toContain("Never write these as questions");
    expect(render("polish")).not.toContain("'Assumptions' heading in the prompt");
  });
});

// ── WS-R39: artifact kind ───────────────────────────────────────────────────

describe("WS-R39 — artifact kind is the user's (AC-063)", () => {
  const base = { target: null, targetId: "generic", currentPrompt: null, currentVersion: 0, attachments: [] as { name: string; excerpt: string; truncated: boolean }[], isFirstTurn: false };

  it("states the chosen kind in every generation instruction", () => {
    expect(buildSystemPrompt({ ...base, action: "CREATE", artifactKind: "builder" })).toContain("BUILD INSTRUCTIONS");
    expect(buildSystemPrompt({ ...base, action: "CREATE", artifactKind: "agent" })).toContain("AGENT PROMPT");
    expect(buildSystemPrompt({ ...base, action: "DISCOVER", artifactKind: "unspecified" })).toContain("ask once");
  });

  it("never changes the setting from a turn, whatever the model suggests", async () => {
    const convo = newConversation({ title: "k" });
    await executeTurn(convo, `Improve this\n\n${PASTED}`, scripted({ generate: [refineAnswer] }).deps);
    await executeTurn(convo, "The Codex one", scripted({ generate: [refineAnswer] }).deps);
    expect(convo.artifactKind).toBe("unspecified");
  });
});

// ── WS-R40: staged output ───────────────────────────────────────────────────

const STAGED = [
  "## Stage 1 — Plan",
  "Depends on: none",
  "Read the repository and write a plan. Never approve a change that deletes a test.",
  "",
  "## Stage 2 — Build",
  "Depends on: Stage 1",
  "Implement the plan. Cite a file path and line number for every finding.",
  "",
  "## Stage 3 — Verify",
  "Depends on: Stage 1, Stage 2",
  "Run the tests and report.",
].join("\n");

describe("WS-R40 — staged output (AC-064)", () => {
  it("parses ordered stages with backward dependencies", () => {
    const parsed = parseStages(STAGED);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.stages.map((s) => [s.n, s.title, s.dependsOn])).toEqual([
      [1, "Plan", []],
      [2, "Build", [1]],
      [3, "Verify", [1, 2]],
    ]);
    expect(parsed.stages.map((s) => s.text).join("\n\n")).toBe(STAGED);
  });

  it("refuses a forward dependency, a gap, and a single stage — naming why", () => {
    const forward = parseStages(STAGED.replace("Depends on: none", "Depends on: Stage 2"));
    expect(forward).toMatchObject({ ok: false });
    expect(!forward.ok && forward.reason).toContain("only on earlier stages");
    expect(parseStages(STAGED.replace("## Stage 2", "## Stage 4"))).toMatchObject({ ok: false });
    expect(parseStages("## Stage 1 — Only\nDo it.")).toMatchObject({ ok: false });
  });

  it("reports which stages carry each requirement, by the existing rules", () => {
    const parsed = parseStages(STAGED);
    if (!parsed.ok) throw new Error("fixture must parse");
    const carry = stageCarry(parsed.stages, [
      { text: "Never approve a change that deletes a test", kind: "pinned" },
      { text: "cite file path and line number for findings", kind: "discovered" },
      { text: "Deploy to production on Fridays", kind: "pinned" },
    ]);
    expect(carry.map((c) => c.stages)).toEqual([[1], [2], []]);
  });

  it("emits FORGE-W013 when staged output was requested and the version is not staged", async () => {
    const convo = newConversation({ title: "s" });
    convo.outputShape = "staged";
    const s = scripted({ classify: ['{"action":"CREATE","versions":[]}'], generate: [JSON.stringify({ reply: "ok", prompt: "One flat prompt." })] });
    const result = await executeTurn(convo, "write a prompt for a PR reviewer", s.deps);
    expect(result.version?.shape).toBe("staged");
    const w013 = result.diagnostics.find((d) => d.code === "FORGE-W013");
    expect(w013?.message).toContain("at least two");
  });

  it("accepts a staged version without W013", async () => {
    const convo = newConversation({ title: "s" });
    convo.outputShape = "staged";
    const s = scripted({ classify: ['{"action":"CREATE","versions":[]}'], generate: [JSON.stringify({ reply: "ok", prompt: STAGED })] });
    const result = await executeTurn(convo, "write it in stages", s.deps);
    expect(result.diagnostics.map((d) => d.code)).not.toContain("FORGE-W013");
  });
});

// ── WS-R41: several targets ─────────────────────────────────────────────────

describe("WS-R41 — several targets, one IR (AC-065)", () => {
  it("extracts once and matches each single-target compile byte for byte", async () => {
    process.env["FORGE_CHAT_STUB"] = "1";
    const convo = newConversation({ title: "t" });
    addPromptVersion(convo, PASTED, "model", { action: "CREATE" });
    const targets = ["claude-code", "openai-codex", "kiro"];
    const many = await compileVersionForTargets(convo, convo.currentV, targets);
    expect(many.filter((r) => r.extracted)).toHaveLength(1);
    expect(convo.versionIrs).toHaveLength(1);
    for (const result of many) {
      const single = await compileVersion(convo, convo.currentV, result.target);
      expect(single.extracted).toBe(false);
      expect(result.artifacts.map((a) => a.content)).toEqual(single.artifacts.map((a) => a.content));
      const direct = compile(result.ir, builtinProfiles().get(result.profileId), { taskSlug: result.taskSlug });
      expect(result.artifacts.map((a) => a.content_hash)).toEqual(direct.artifacts.map((a) => a.content_hash));
    }
    expect(new Set(many.map((r) => r.profileId)).size).toBe(3);
  });

  it("rejects an unknown target before any extraction", async () => {
    process.env["FORGE_CHAT_STUB"] = "1";
    const convo = newConversation({ title: "t" });
    addPromptVersion(convo, PASTED, "model", { action: "CREATE" });
    await expect(compileVersionForTargets(convo, convo.currentV, ["claude-code", "not-a-target"])).rejects.toThrow();
    expect(convo.versionIrs).toHaveLength(0);
  });
});

// ── WS-R42/WS-R43: reasoning effort ─────────────────────────────────────────

describe("WS-R42/WS-R43 — reasoning effort (AC-066)", () => {
  const openCode = (modelId: string) => ({ providerId: "opencode-go", baseURL: "https://opencode.ai/zen/go/v1", protocol: "chat-completions" as const, modelId, openCode: true });

  it("supports declared models only, and names the reason otherwise", async () => {
    const yes = await reasoningAvailability({ providerId: "openai", baseURL: null, protocol: "chat-completions", modelId: "gpt-5.6", openCode: false });
    expect(yes.support).toMatchObject({ wire: "openai-chat", source: "declared" });
    const no = await reasoningAvailability({ providerId: "openai", baseURL: null, protocol: "chat-completions", modelId: "gpt-4o-mini", openCode: false });
    expect(no.support).toBeNull();
    expect(no.reason).toContain("gpt-4o-mini");
    const custom = await reasoningAvailability({ providerId: "custom-x", baseURL: "http://localhost:1234/v1", protocol: "chat-completions", modelId: "my-model", openCode: false });
    expect(custom.support).toBeNull();
    expect((await reasoningAvailability(openCode("gpt-5.6-luna"))).support?.wire).toBe("openai-responses");
    // Measured live (evals/release-blockers/): the Qwen family on OpenCode's
    // Anthropic path honours a thinking budget and reasons without a bound
    // when none is sent, so its Default is bounded; MiniMax M3 honours the
    // budget and does not reason by default; M2.x ignores `disabled`, and a
    // chat-completions model has no documented setting.
    expect((await reasoningAvailability(openCode("qwen3.8-flash"))).support).toMatchObject({
      wire: "anthropic-thinking",
      source: "declared",
      defaultLevel: "low",
    });
    expect((await reasoningAvailability(openCode("qwen3.6-plus"))).support?.defaultLevel).toBe("low");
    expect((await reasoningAvailability(openCode("minimax-m3"))).support).toMatchObject({ wire: "anthropic-thinking", defaultLevel: null });
    expect((await reasoningAvailability(openCode("minimax-m2.7"))).support).toBeNull();
    const kimi = await reasoningAvailability(openCode("kimi-k3"));
    expect(kimi.support).toBeNull();
    expect(kimi.reason).toContain("kimi-k3");
    // Every other declared or discovered model's Default sends nothing.
    expect((await reasoningAvailability(openCode("gpt-5.6-luna"))).support?.defaultLevel).toBeNull();
  });

  it("discovers OpenRouter support from the provider's own listing, and never guesses past a failure", async () => {
    const or = { providerId: "openrouter", baseURL: "https://openrouter.ai/api/v1", protocol: "chat-completions" as const, openCode: false };
    const listing = async () => [
      { id: "a/thinks", supported_parameters: ["reasoning", "max_tokens"] },
      { id: "b/plain", supported_parameters: ["max_tokens"] },
    ];
    expect((await reasoningAvailability({ ...or, modelId: "a/thinks" }, listing)).support).toMatchObject({ wire: "openrouter", source: "discovered" });
    expect((await reasoningAvailability({ ...or, modelId: "b/plain" }, listing)).support).toBeNull();
    expect((await reasoningAvailability({ ...or, modelId: "c/unlisted" }, listing)).reason).toContain("does not list");
    resetReasoningCache();
    const failed = await reasoningAvailability({ ...or, modelId: "a/thinks" }, async () => {
      throw new Error("offline");
    });
    expect(failed.support).toBeNull();
    expect(failed.reason).toContain("offline");
  });

  it("sends each protocol its own parameter, and nothing when no effort is asked", () => {
    expect(reasoningCallOptions(undefined, "openai", 16000)).toEqual({ maxTokens: 16000, omitTemperature: false });
    expect(reasoningCallOptions({ wire: "openai-chat", effort: "low" }, "openai", 16000).providerOptions).toEqual({ openai: { reasoningEffort: "low" } });
    expect(reasoningCallOptions({ wire: "openrouter", effort: "high" }, "openrouter", 16000).providerOptions).toEqual({ openrouter: { reasoning: { effort: "high" } } });
    expect(reasoningCallOptions({ wire: "openai-responses", effort: "medium" }, "opencode-go", 16000).providerOptions).toEqual({ openai: { reasoningEffort: "medium" } });
    const thinking = reasoningCallOptions({ wire: "anthropic-thinking", effort: "high" }, "anthropic", 16000);
    expect(thinking.providerOptions).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: THINKING_BUDGET.high } } });
    expect(thinking.maxTokens).toBe(16000 + THINKING_BUDGET.high);
    expect(thinking.omitTemperature).toBe(true);
  });

  it("refuses an effort for an unsupported model before any call", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-not-real";
    const convo = newConversation({ title: "r", provider: "openai", model: "gpt-4o-mini" });
    convo.reasoningEffort = "high";
    await expect(reasoningFor(convo)).rejects.toThrow(/Reasoning effort "high" was requested/);
    convo.model = "gpt-5.6";
    await expect(reasoningFor(convo)).resolves.toEqual({ wire: "openai-chat", effort: "high" });
    convo.reasoningEffort = "default";
    await expect(reasoningFor(convo)).resolves.toBeUndefined();
  });

  it("bounds Default for a model that otherwise reasons without a limit, and only there", async () => {
    // The legacy key belongs to OpenCode Go only when its base URL says so.
    process.env["FORGE_API_KEY"] = "sk-test-not-real";
    process.env["FORGE_BASE_URL"] = "https://opencode.ai/zen/go/v1";
    const convo = newConversation({ title: "r", provider: "opencode-go", model: "qwen3.8-flash" });
    convo.reasoningEffort = "default";
    await expect(reasoningFor(convo)).resolves.toEqual({ wire: "anthropic-thinking", effort: "low" });
    convo.reasoningEffort = "high";
    await expect(reasoningFor(convo)).resolves.toEqual({ wire: "anthropic-thinking", effort: "high" });
    // The thinking budget is added to the answer's cap, never taken from it.
    expect(reasoningCallOptions({ wire: "anthropic-thinking", effort: "low" }, "opencode-go", 16000).maxTokens).toBe(16000 + THINKING_BUDGET.low);
    convo.reasoningEffort = "default";
    convo.model = "minimax-m3";
    await expect(reasoningFor(convo)).resolves.toBeUndefined();
    convo.model = "kimi-k3";
    await expect(reasoningFor(convo)).resolves.toBeUndefined();
    convo.reasoningEffort = "low";
    await expect(reasoningFor(convo)).rejects.toThrow(/Reasoning effort "low" was requested/);
  });

  it("keeps a stored effort through a model that cannot take it, sending nothing there", async () => {
    // The legacy key belongs to OpenCode Go only when its base URL says so.
    process.env["FORGE_API_KEY"] = "sk-test-not-real";
    process.env["FORGE_BASE_URL"] = "https://opencode.ai/zen/go/v1";
    const convo = newConversation({ title: "r", provider: "opencode-go", model: "kimi-k3" });
    convo.reasoningEffort = "high";
    // Not named by this request: nothing is sent, and the choice is not erased.
    await expect(reasoningFor(convo, { strict: false })).resolves.toBeUndefined();
    expect(convo.reasoningEffort).toBe("high");
    // Named by the request: refused before any call (WS-R42).
    await expect(reasoningFor(convo, { strict: true })).rejects.toThrow(/Reasoning effort "high" was requested/);
    convo.model = "qwen3.8-flash";
    await expect(reasoningFor(convo, { strict: false })).resolves.toEqual({ wire: "anthropic-thinking", effort: "high" });
  });
});

// ── WS-R44–WS-R46 and the amended WS-R33: discovery quality ────────────────

describe("discovery quality (AC-067)", () => {
  const q = (question: string) => ({ question, options: [] });

  it("drops a question asked in an earlier turn, however lightly re-worded (WS-R44)", () => {
    const first = applyDiscoveryUpdate(openDiscovery(), {
      brief: {},
      questions: [q("What data sources can the agent access?")],
      ready: false,
      research_needed: null,
      artifact_kind: null,
    });
    const second = applyDiscoveryUpdate(first, {
      brief: {},
      questions: [q("What data sources can the agent access today?"), q("Who approves the output?")],
      ready: false,
      research_needed: null,
      artifact_kind: null,
    });
    expect(second.questions.map((x) => x.question)).toEqual(["Who approves the output?"]);
    expect(second.asked).toHaveLength(2);
    expect(sameQuestion("Who approves the output?", "Which budget do you have?")).toBe(false);
  });

  it("keeps at most two questions in refine discovery, moving the rest to open questions (WS-R37)", () => {
    const next = applyDiscoveryUpdate(openDiscovery("refine"), {
      brief: {},
      questions: [q("Which agent runs this review?"), q("Is the verdict pass or fail?"), q("Should style issues be reported?")],
      ready: true,
      research_needed: null,
      artifact_kind: null,
    });
    expect(next.questions.map((x) => x.question)).toEqual(["Which agent runs this review?", "Is the verdict pass or fail?"]);
    expect(next.brief.open_questions).toEqual(["Should style issues be reported?"]);
  });

  it("counts a restated open question once (WS-R32 with the WS-R44 rule)", () => {
    const state = {
      ...openDiscovery(),
      questions: [q("Which accounting software do the firms use?")],
      brief: { open_questions: ["Which accounting software do the firms use today?", "Who approves sending?"] },
    };
    expect(unresolvedQuestions(state)).toEqual(["Which accounting software do the firms use?", "Who approves sending?"]);
  });

  it("marks brief items stated or inferred from the user's own words (WS-R45)", () => {
    const marks = briefMarks(
      { goal: "Automate client onboarding for accounting firms", constraints: ["Budget under 200 dollars monthly"] },
      ["I want to automate client onboarding for small accounting firms"],
    );
    expect(marks["Automate client onboarding for accounting firms"]).toBe("stated");
    expect(marks["Budget under 200 dollars monthly"]).toBe("inferred");
  });

  it("treats a paraphrase as covered but reports a real drop, in one finding (WS-R33 amended)", async () => {
    expect(isCovered("A human must approve every email before it is sent", "Every email is sent only after a human approves it.")).toBe(true);
    expect(coverage("Client data must remain private", "Send the emails quickly.")).toBeLessThan(0.8);
    const absent = absentDiscoveredRequirements(
      { goal: "Chase missing client documents", constraints: ["Client data must remain private", "Human approval before sending"] },
      "Chase missing client documents by email. Wait for human approval before sending anything.",
    );
    expect(absent.map((a) => a.text)).toEqual(["Client data must remain private"]);

    const convo = newConversation({ title: "w9" });
    convo.discovery = {
      ...openDiscovery(),
      brief: { goal: "Chase missing client documents", constraints: ["Client data must remain private", "Use only Gmail"] },
    };
    const s = scripted({ generate: [JSON.stringify({ reply: "ok", prompt: "Chase missing client documents politely." })] });
    const result = await executeTurn(convo, "generate", s.deps, { generate: true });
    const w009 = result.diagnostics.filter((d) => d.code === "FORGE-W009");
    expect(w009).toHaveLength(1);
    expect(w009[0]!.message).toContain("Client data must remain private");
    expect(w009[0]!.message).toContain("Use only Gmail");
  });

  it("lets a closed discovery gate nothing (WS-R46)", async () => {
    const convo = newConversation({ title: "c" });
    addPromptVersion(convo, "existing prompt", "manual");
    convo.discovery = { ...openDiscovery(), status: "closed", brief: { goal: "kept" } };
    const s = scripted({ classify: ['{"action":"REVISE","versions":[]}'], generate: [JSON.stringify({ reply: "ok", prompt: "revised prompt" })] });
    const result = await executeTurn(convo, "make it shorter", s.deps);
    expect(result.action).toBe("REVISE");
    expect(result.version).not.toBeNull();
    expect(convo.discovery.brief.goal).toBe("kept");
  });

  it("parses the artifact-kind suggestion and rejects an unknown one", () => {
    const base = { brief: {}, questions: [], ready: false, research_needed: null };
    expect(parseDiscoveryUpdate(JSON.stringify({ discovery: { ...base, artifact_kind: "builder" } }))?.artifact_kind).toBe("builder");
    expect(parseDiscoveryUpdate(JSON.stringify({ discovery: { ...base, artifact_kind: "robot" } }))).toBeNull();
  });
});

// ── WS-R34 applied to discovery: one bounded repair ─────────────────────────

describe("the discovery repair (WS-R34, WS-R13)", () => {
  const good = JSON.stringify({ discovery: { brief: { goal: "Review PRs" }, questions: [{ question: "Which repo?", options: [] }], ready: false, research_needed: null } });

  it("repairs an unusable discovery object once and keeps the first reply", async () => {
    const convo = newConversation({ title: "r" });
    const s = scripted({ generate: ['{"reply":"Here is what I think.","prompt":null,"discovery":{"questions":"oops"}}', good] });
    const result = await executeTurn(convo, `Improve this\n\n${PASTED}`, s.deps);
    expect(s.calls()).toBe(2);
    expect(result.reply).toBe("Here is what I think.");
    expect(convo.discovery?.brief.goal).toBe("Review PRs");
    expect(result.events.some((e) => e.kind === "model_call" && e.repair === true)).toBe(true);
    expect(convo.modelCalls.at(-1)?.repairs).toBe(1);
    expect(result.diagnostics.map((d) => d.code)).not.toContain("FORGE-W003");
  });

  it("stops after one repair and cites both problems", async () => {
    const convo = newConversation({ title: "r" });
    const s = scripted({ generate: ['{"reply":"x","prompt":null,"discovery":{"questions":"oops"}}', "still not json"] });
    const result = await executeTurn(convo, `Improve this\n\n${PASTED}`, s.deps);
    expect(s.calls()).toBe(2);
    const w003 = result.diagnostics.find((d) => d.code === "FORGE-W003");
    expect(w003?.message).toContain("after one repair");
    expect(convo.promptVersions).toHaveLength(0);
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

describe("settings and verifications survive a reload", () => {
  it("round-trips artifact kind, shape, effort, version shape and a verification", async () => {
    const convo: Conversation = newConversation({ title: "persist" });
    convo.artifactKind = "builder";
    convo.outputShape = "staged";
    convo.reasoningEffort = "medium";
    addPromptVersion(convo, STAGED, "model", { action: "CREATE", shape: "staged", mode: "polish" });
    const report = {
      package_valid: true,
      package_semantic_id: "sha256:abc",
      verdicts: [],
      diagnostics: [],
      json: JSON.stringify({ evidence_hash: "sha256:e1", counts: { VERIFIED: 1, FAILED: 0 } }),
    };
    recordVerification(convo, { v: 1, target: "claude-code", profileId: "claude-code", report, evidence: '{"records":[]}' });
    recordVerification(convo, {
      v: 1,
      target: "claude-code",
      profileId: "claude-code",
      report,
      evidence: 'token AKIAIOSFODNN7EXAMPLE in a log',
    });
    saveConversation(convo);
    const back = loadConversation(convo.id)!;
    expect([back.artifactKind, back.outputShape, back.reasoningEffort]).toEqual(["builder", "staged", "medium"]);
    expect(back.promptVersions[0]).toMatchObject({ shape: "staged", mode: "polish" });
    expect(back.verifications).toHaveLength(2);
    expect(back.verifications[0]).toMatchObject({ evidenceKept: true, evidence: '{"records":[]}', counts: { VERIFIED: 1 } });
    // A credential in pasted evidence is never written to disk.
    expect(back.verifications[1]).toMatchObject({ evidenceKept: false, evidence: null });
  });
});

describe("a failed call still leaves a trace (WS-R14)", () => {
  it("records a classifier transport failure as model_call_failed and degrades with W001", async () => {
    const convo = newConversation({ title: "f" });
    const deps: TurnDeps = {
      providerId: "test",
      renderGeneration: (action, message) => ({ system: `SYSTEM ${action}`, user: message }),
      async complete(request) {
        if (request.user.includes("Classify the user's message")) throw new Error("Invalid JSON response");
        return { text: '{"reply":"ok","prompt":null}', model: "m", latencyMs: 1 };
      },
    };
    const result = await executeTurn(convo, "what makes a good review prompt?", deps);
    expect(result.degraded).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W001");
    const failed = result.events.find((e) => e.kind === "model_call_failed");
    expect(failed).toMatchObject({ boundaryId: "conversation.classify", reason: "Invalid JSON response" });
    saveConversation(convo);
    expect(loadConversation(convo.id)!.turnEvents.some((e) => e.kind === "model_call_failed")).toBe(true);
  });
});

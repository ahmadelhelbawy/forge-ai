/**
 * Discovery (Product Sprint 1, `FR-059`, `spec.md` §22.11, `AC-058`–`AC-061`).
 *
 * The product question these answer: does FORGE ask before it writes? Each
 * test drives the real turn pipeline with a scripted model, because the
 * properties are about what FORGE does with an answer — the gate, the write
 * guard, the state — not about what a model happens to say.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { parseClassifyOutput } from "../../src/conversation/classify.js";
import {
  absentDiscoveredRequirements,
  parseDiscoveryUpdate,
} from "../../src/conversation/discovery.js";
import { addPromptVersion, loadConversation, newConversation, saveConversation, type Conversation } from "../../web/lib/store";
import { buildSystemPrompt } from "../../web/lib/chat";
import { executeTurn, type GenerationContext, type TurnDeps } from "../../web/lib/turn/pipeline";

beforeEach(() => {
  process.env["FORGE_DATA_DIR"] = join(mkdtempSync(join(tmpdir(), "forge-discovery-")), "data");
});

interface Script {
  /** Answers to classification calls, in order; the last repeats. */
  classify?: string[];
  /** Answers to generation calls, in order; the last repeats. */
  generate?: string[];
}

function scripted(script: Script): { deps: TurnDeps; seen: { system: string; user: string; context?: GenerationContext }[]; calls: () => number } {
  const seen: { system: string; user: string; context?: GenerationContext }[] = [];
  let classifyAt = 0;
  let generateAt = 0;
  let calls = 0;
  const pick = (list: string[] | undefined, at: number, fallback: string) =>
    list && list.length > 0 ? list[Math.min(at, list.length - 1)]! : fallback;
  return {
    seen,
    calls: () => calls,
    deps: {
      providerId: "test",
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

const discover = '{"action":"DISCOVER","versions":[]}';
const create = '{"action":"CREATE","versions":[]}';

function discoveryAnswer(update: Record<string, unknown>, prompt: string | null = null): string {
  return JSON.stringify({ reply: "Let's work it out. What is your main goal?", prompt, discovery: update });
}

const FIRST = discoveryAnswer({
  brief: { vision: "An AI agent the user can build within 24 months" },
  questions: [{ question: "What is your main goal?", options: ["Save time", "Make money", "Something else"] }],
  ready: false,
  research_needed: null,
});
const SECOND = discoveryAnswer({
  brief: {
    vision: "An AI agent the user can build within 24 months",
    goal: "Automate client onboarding for small accounting firms",
    constraints: ["Must run on a budget under 200 dollars a month"],
    success_criteria: ["Onboarding time drops by half"],
    open_questions: ["Which accounting software do the firms use?"],
  },
  questions: [{ question: "Which accounting software do your clients use?", options: [] }],
  ready: true,
  research_needed: "Current pricing of accounting-software APIs",
});

async function vagueConversation(): Promise<Conversation> {
  const convo = newConversation({ title: "d" });
  const s = scripted({ classify: [discover], generate: [FIRST] });
  await executeTurn(convo, "I want to build an AI agent but I don't know exactly what agent to build.", s.deps);
  return convo;
}

describe("WS-R30 — a vague idea enters discovery and writes nothing (AC-058)", () => {
  it("opens discovery, persists the brief and questions, and writes no version", async () => {
    const convo = newConversation({ title: "d" });
    const s = scripted({ classify: [discover], generate: [FIRST] });
    const result = await executeTurn(convo, "I want to build an AI agent but I don't know exactly what agent to build.", s.deps);
    expect(result.action).toBe("DISCOVER");
    expect(result.version).toBeNull();
    expect(convo.promptVersions).toHaveLength(0);
    expect(convo.discovery).toMatchObject({ status: "open", turns: 1 });
    expect(convo.discovery!.questions[0]!.options).toContain("Make money");
    expect(result.reply).not.toBe("");
  });

  it("blocks a prompt the model smuggles into a discovery turn (the write guard stays authoritative)", async () => {
    const convo = newConversation({ title: "d" });
    const s = scripted({ classify: [discover], generate: [discoveryAnswer(JSON.parse(FIRST).discovery, "# A full prompt")] });
    const result = await executeTurn(convo, "no idea what to build", s.deps);
    expect(result.version).toBeNull();
    expect(convo.promptVersions).toHaveLength(0);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W004");
  });

  it("keeps the previous state when the update is unreadable, and says so (FORGE-W003)", async () => {
    const convo = await vagueConversation();
    const before = JSON.stringify(convo.discovery);
    const s = scripted({ classify: [discover], generate: ['{"reply":"hmm","prompt":null,"discovery":{"questions":"not a list"}}'] });
    const result = await executeTurn(convo, "make money", s.deps);
    expect(JSON.stringify(convo.discovery)).toBe(before);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W003");
  });

  it("survives reload and navigation", async () => {
    const convo = await vagueConversation();
    saveConversation(convo);
    const reloaded = loadConversation(convo.id)!;
    expect(reloaded.discovery).toEqual(convo.discovery);
  });
});

describe("adaptive discovery", () => {
  it("feeds the answer into the next turn and the brief becomes more specific — with no classification call", async () => {
    const convo = await vagueConversation();
    const s = scripted({ classify: [create], generate: [SECOND] });
    const result = await executeTurn(convo, "Make money — I run bookkeeping for small accounting firms.", s.deps);
    // WS-R31: discovery open and no prompt, so DISCOVER is the only possible
    // answer and no classifier call is spent to reach it.
    expect(result.action).toBe("DISCOVER");
    expect(s.calls()).toBe(1);
    expect(convo.promptVersions).toHaveLength(0);
    expect(convo.discovery!.brief.goal).toBe("Automate client onboarding for small accounting firms");
    expect(convo.discovery!.turns).toBe(2);
    expect(convo.discovery!.research_needed).toContain("pricing");
  });
});

describe("WS-R31 — a classified write is gated while discovery is open (AC-059)", () => {
  async function reopened(): Promise<Conversation> {
    const convo = newConversation({ title: "g" });
    addPromptVersion(convo, "# An existing prompt", "manual");
    await executeTurn(convo, "Actually, I'm not sure this is the right agent at all", scripted({ classify: [discover], generate: [FIRST] }).deps);
    expect(convo.discovery?.status).toBe("open");
    return convo;
  }

  it("turns a classified REVISE into DISCOVER, emits FORGE-W011, and writes nothing", async () => {
    const convo = await reopened();
    const s = scripted({ classify: ['{"action":"REVISE","versions":[]}'], generate: [discoveryAnswer(JSON.parse(SECOND).discovery, "# A rewritten prompt")] });
    const result = await executeTurn(convo, "Just rewrite it for bookkeeping", s.deps);
    expect(result.action).toBe("DISCOVER");
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W011");
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W004");
    expect(convo.promptVersions).toHaveLength(1);
  });

  it("treats a plain discussion as more discovery, without W011", async () => {
    const convo = await reopened();
    const result = await executeTurn(convo, "bookkeeping", scripted({ classify: ['{"action":"DISCUSS","versions":[]}'], generate: [SECOND] }).deps);
    expect(result.action).toBe("DISCOVER");
    expect(result.diagnostics.map((d) => d.code)).not.toContain("FORGE-W011");
  });
});

describe("WS-R31–WS-R33 — the explicit generate gate (AC-059, AC-060)", () => {
  async function readyConversation(): Promise<Conversation> {
    const convo = await vagueConversation();
    await executeTurn(convo, "bookkeeping firms", scripted({ classify: [discover], generate: [SECOND] }).deps);
    return convo;
  }

  it("writes a version only on the explicit request, spends no classification, and closes discovery", async () => {
    const convo = await readyConversation();
    const prompt =
      "# Onboarding agent\nAutomate client onboarding for small accounting firms.\n" +
      "Must run on a budget under 200 dollars a month.\nOnboarding time drops by half.\n" +
      "Assumption: Which accounting software do the firms use? — unknown.";
    const s = scripted({ generate: [JSON.stringify({ reply: "Here it is.", prompt })] });
    const result = await executeTurn(convo, "Generate the prompt from what we have discussed.", s.deps, { generate: true });
    expect(result.action).toBe("CREATE");
    expect(s.calls()).toBe(1);
    expect(result.version?.v).toBe(1);
    expect(convo.discovery!.status).toBe("generated");
    // Everything discovered is present, so no W009.
    expect(result.diagnostics.map((d) => d.code)).not.toContain("FORGE-W009");
  });

  it("allows generating with open questions, and surfaces every one (FORGE-W010)", async () => {
    const convo = await readyConversation();
    const s = scripted({ generate: [JSON.stringify({ reply: "ok", prompt: "Automate client onboarding for small accounting firms." })] });
    const result = await executeTurn(convo, "Generate now with what we know", s.deps, { generate: true });
    const w010 = result.diagnostics.filter((d) => d.code === "FORGE-W010");
    expect(w010).toHaveLength(1);
    expect(w010[0]!.message).toContain("Which accounting software");
    expect(s.seen[0]!.context!.explicitGenerate).toBe(true);
    expect(s.seen[0]!.context!.unresolved).toContain("Which accounting software do the firms use?");
  });

  it("reports a discovered requirement the generated prompt dropped (FORGE-W009)", async () => {
    const convo = await readyConversation();
    const s = scripted({ generate: [JSON.stringify({ reply: "ok", prompt: "Automate client onboarding for small accounting firms." })] });
    const result = await executeTurn(convo, "generate", s.deps, { generate: true });
    const w009 = result.diagnostics.filter((d) => d.code === "FORGE-W009").map((d) => d.message);
    expect(w009.some((m) => m.includes("budget under 200 dollars"))).toBe(true);
    expect(w009.some((m) => m.includes("Onboarding time drops by half"))).toBe(true);
  });

  it("leaves discovery open when the generate request produced no prompt", async () => {
    const convo = await readyConversation();
    const result = await executeTurn(convo, "generate", scripted({ generate: ['{"reply":"I need more","prompt":null}'] }).deps, { generate: true });
    expect(result.version).toBeNull();
    expect(convo.discovery!.status).toBe("open");
  });
});

describe("WS-R34 — classifier degradation is bounded and visible (AC-061)", () => {
  it("parses fenced JSON and skips a non-matching object before the answer", () => {
    expect(parseClassifyOutput('```json\n{"thinking":"x"}\n{"action":"DISCOVER","versions":[]}\n```').action).toBe("DISCOVER");
  });

  it("never reinterprets a bare word or a near-miss label", () => {
    expect(() => parseClassifyOutput("DISCUSS")).toThrow(/no JSON/);
    expect(() => parseClassifyOutput('{"action":"discuss"}')).toThrow(/conversation actions/);
    expect(() => parseClassifyOutput("")).toThrow(/empty/);
  });

  it("repairs once and uses the repaired answer", async () => {
    const convo = newConversation({ title: "r" });
    const s = scripted({ classify: ["I think this is a discovery", discover], generate: [FIRST] });
    const result = await executeTurn(convo, "not sure what to build", s.deps);
    expect(result.action).toBe("DISCOVER");
    expect(result.degraded).toBe(false);
    expect(s.calls()).toBe(3);
    expect(convo.modelCalls).toHaveLength(3);
  });

  it("degrades after one failed repair with FORGE-W001 citing both failures, and writes nothing", async () => {
    const convo = newConversation({ title: "r" });
    const s = scripted({ classify: ["", "still not json"], generate: ['{"reply":"ok","prompt":"# a prompt"}'] });
    const result = await executeTurn(convo, "write me a prompt for code review", s.deps);
    expect(result.degraded).toBe(true);
    expect(result.action).toBe("DISCUSS");
    expect(result.version).toBeNull();
    const w001 = result.diagnostics.find((d) => d.code === "FORGE-W001")!;
    expect(w001.message).toContain("empty response");
    expect(w001.message).toContain("After one repair");
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W004");
    expect(s.calls()).toBe(3);
  });
});

describe("the deterministic helpers", () => {
  it("accepts eight options on a question and rejects nine", () => {
    const update = (n: number) =>
      JSON.stringify({ reply: "x", prompt: null, discovery: { brief: {}, questions: [{ question: "Which?", options: Array.from({ length: n }, (_, i) => `o${i}`) }] } });
    expect(parseDiscoveryUpdate(update(8))).not.toBeNull();
    expect(parseDiscoveryUpdate(update(9))).toBeNull();
  });

  it("rejects a discovery update with more than three questions", () => {
    const questions = [1, 2, 3, 4].map((n) => ({ question: `Question ${n}?`, options: [] }));
    expect(parseDiscoveryUpdate(JSON.stringify({ reply: "x", prompt: null, discovery: { brief: {}, questions } }))).toBeNull();
  });

  it("finds absent discovered items by the presence rule, forgiving format", () => {
    const brief = { goal: "Automate onboarding", constraints: ["No new dependencies"] };
    expect(absentDiscoveredRequirements(brief, "- automate ONBOARDING.\n- no new dependencies!")).toEqual([]);
    expect(absentDiscoveredRequirements(brief, "automate onboarding")).toEqual([{ field: "constraint", text: "No new dependencies" }]);
  });
});

describe("the real generation prompt carries discovery forward", () => {
  const base = { target: null, targetId: "generic", currentPrompt: null, currentVersion: 0, attachments: [], isFirstTurn: false };

  it("gives a DISCOVER turn the current brief and the questions it is answering, and forbids a prompt", async () => {
    const convo = await vagueConversation();
    await executeTurn(convo, "bookkeeping", scripted({ generate: [SECOND] }).deps);
    const system = buildSystemPrompt({ ...base, action: "DISCOVER", discovery: convo.discovery });
    expect(system).toContain("DISCOVERY MODE");
    expect(system).toContain('Always set "prompt" to null');
    expect(system).toContain("Goal: Automate client onboarding for small accounting firms");
    expect(system).toContain("- Which accounting software do your clients use?");
    expect(system).toContain("research_needed");
  });

  it("gives an approved generate the brief to carry and the unresolved questions to state", async () => {
    const convo = await vagueConversation();
    await executeTurn(convo, "bookkeeping", scripted({ generate: [SECOND] }).deps);
    const system = buildSystemPrompt({
      ...base,
      action: "CREATE",
      discovery: convo.discovery,
      generation: { explicitGenerate: true, unresolved: ["Which accounting software do the firms use?"] },
    });
    expect(system).toContain("THE USER PRESSED GENERATE");
    expect(system).toContain("  - Must run on a budget under 200 dollars a month");
    expect(system).toContain("UNRESOLVED");
    expect(system).toContain("- Which accounting software do the firms use?");
    // A classified CREATE with no approval gets none of it.
    expect(buildSystemPrompt({ ...base, action: "CREATE", discovery: convo.discovery })).not.toContain("THE USER PRESSED GENERATE");
  });
});

/**
 * V2-A1 — conversation state, candidate set, pending clarification, the
 * append-only TurnEvent log, and ModelCallRecord persistence.
 *
 * Requirements: WS-R5 (state sufficiency), WS-R7 (immutable versions record
 * their action and turn), WS-R8 (candidate set), WS-R9 (semantic/run split),
 * WS-R10 (the event log is one mechanism), WS-R14 (every model call is
 * persisted). Acceptance: AC-031.
 *
 * No server, no model, no network.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addCandidate,
  addPromptVersion,
  appendTurnEvent,
  dataDir,
  loadConversation,
  newConversation,
  recordModelCall,
  resolvePendingClarification,
  saveConversation,
  semanticSnapshot,
  setPendingClarification,
  type Conversation,
} from "../../web/lib/store";

function isolatedDataDir(): void {
  const dir = mkdtempSync(join(tmpdir(), "forge-turn-state-"));
  process.env["FORGE_DATA_DIR"] = join(dir, "data");
}

function fresh(): Conversation {
  const convo = newConversation({ title: "t" });
  saveConversation(convo);
  return convo;
}

const callRecord = (over: Partial<Record<string, unknown>> = {}) => ({
  boundaryId: "conversation.classify",
  boundaryVersion: "1",
  provider: "openai-compat",
  model: "test-model",
  promptHash: "sha256:aa",
  outputHash: "sha256:bb",
  repairs: 0,
  latencyMs: 12,
  replayed: false,
  timestamp: "2026-09-16T00:00:00.000Z",
  ...over,
});

describe("conversation state (V2-A1)", () => {
  beforeEach(isolatedDataDir);

  it("starts with an empty candidate set, no pending clarification, and an empty run log", () => {
    const convo = newConversation({});
    expect(convo.candidates).toEqual([]);
    expect(convo.pendingClarification).toBeNull();
    expect(convo.turnEvents).toEqual([]);
    expect(convo.modelCalls).toEqual([]);
  });

  it("loads a pre-V2 conversation file and fills the new state with empty defaults", () => {
    const legacy = {
      id: "legacy-convo",
      title: "old",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      target: "generic",
      provider: "openai-compat",
      model: "m",
      messages: [{ role: "user", content: "hi", at: "2026-09-01T00:00:00.000Z" }],
      attachmentContents: {},
      attachments: [],
      promptVersions: [{ v: 1, text: "p", source: "model", at: "2026-09-01T00:00:00.000Z" }],
      currentV: 1,
    };
    mkdirSync(join(dataDir(), "conversations"), { recursive: true });
    writeFileSync(join(dataDir(), "conversations", "legacy-convo.json"), JSON.stringify(legacy), "utf8");

    const loaded = loadConversation("legacy-convo");
    expect(loaded).not.toBeNull();
    expect(loaded?.candidates).toEqual([]);
    expect(loaded?.pendingClarification).toBeNull();
    expect(loaded?.turnEvents).toEqual([]);
    expect(loaded?.modelCalls).toEqual([]);
    expect(loaded?.promptVersions[0]?.text).toBe("p");
  });
});

describe("append-only TurnEvent log (WS-R10)", () => {
  beforeEach(isolatedDataDir);

  it("assigns monotonic sequence numbers starting at 1", () => {
    const convo = fresh();
    const first = appendTurnEvent(convo, { turnId: "t1", kind: "turn_started" });
    const second = appendTurnEvent(convo, { turnId: "t1", kind: "stage", stage: "classifying", label: "Understanding your message" });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(convo.turnEvents).toHaveLength(2);
  });

  it("never rewrites an event already in the log", () => {
    const convo = fresh();
    const first = appendTurnEvent(convo, { turnId: "t1", kind: "turn_started" });
    const snapshotOfFirst = JSON.stringify(first);
    appendTurnEvent(convo, { turnId: "t1", kind: "turn_completed", action: "DISCUSS", versionCreated: false });
    expect(JSON.stringify(convo.turnEvents[0])).toBe(snapshotOfFirst);
    expect(Object.isFrozen(convo.turnEvents[0])).toBe(true);
  });

  it("survives a save/load round trip with its order intact", () => {
    const convo = fresh();
    appendTurnEvent(convo, { turnId: "t1", kind: "turn_started" });
    appendTurnEvent(convo, { turnId: "t1", kind: "action_resolved", action: "DISCUSS", degraded: false });
    appendTurnEvent(convo, { turnId: "t1", kind: "turn_completed", action: "DISCUSS", versionCreated: false });
    saveConversation(convo);

    const loaded = loadConversation(convo.id);
    expect(loaded?.turnEvents.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(loaded?.turnEvents.map((e) => e.kind)).toEqual(["turn_started", "action_resolved", "turn_completed"]);
  });

  it("carries a user-meaningful stage label and no chain-of-thought field (WS-R11)", () => {
    const convo = fresh();
    const event = appendTurnEvent(convo, {
      turnId: "t1",
      kind: "stage",
      stage: "classifying",
      label: "Understanding your message",
    });
    expect(event).toMatchObject({ kind: "stage", label: "Understanding your message" });
    expect(Object.keys(event)).not.toContain("reasoning");
    expect(Object.keys(event)).not.toContain("thinking");
  });
});

describe("ModelCallRecord persistence (WS-R14, AC-031)", () => {
  beforeEach(isolatedDataDir);

  it("persists every declared field of a model call", () => {
    const convo = fresh();
    recordModelCall(convo, callRecord() as never);
    saveConversation(convo);

    const loaded = loadConversation(convo.id);
    const record = loaded?.modelCalls[0];
    expect(record).toBeDefined();
    for (const field of [
      "boundaryId",
      "boundaryVersion",
      "provider",
      "model",
      "promptHash",
      "outputHash",
      "repairs",
      "latencyMs",
      "replayed",
      "timestamp",
    ]) {
      expect(record).toHaveProperty(field);
    }
  });

  it("accounts for every call: one run-log record per model_call event", () => {
    const convo = fresh();
    for (const boundaryId of ["conversation.classify", "conversation.generate"]) {
      const record = callRecord({ boundaryId });
      recordModelCall(convo, record as never);
      appendTurnEvent(convo, { turnId: "t1", kind: "model_call", boundaryId, model: "test-model", latencyMs: 12 });
    }
    const calls = convo.turnEvents.filter((e) => e.kind === "model_call");
    expect(convo.modelCalls).toHaveLength(calls.length);
    expect(convo.modelCalls.map((r) => r.boundaryId).sort()).toEqual(
      calls.map((e) => (e as { boundaryId: string }).boundaryId).sort(),
    );
  });

  it("never stores a credential-shaped field on a record", () => {
    const convo = fresh();
    recordModelCall(convo, callRecord() as never);
    const serialized = JSON.stringify(convo.modelCalls);
    expect(serialized).not.toMatch(/apiKey|api_key|authorization|sk-/i);
  });
});

describe("candidate set (WS-R8)", () => {
  beforeEach(isolatedDataDir);

  it("adds candidates with stable ids and keeps them addressable across a reload", () => {
    const convo = fresh();
    addPromptVersion(convo, "base", "model", { action: "CREATE", turnId: "t1" });
    const a = addCandidate(convo, { label: "terse", text: "short prompt", fromVersion: 1 });
    const b = addCandidate(convo, { label: "rigorous", text: "long prompt", fromVersion: 1 });
    expect(a.id).not.toBe(b.id);
    saveConversation(convo);

    const loaded = loadConversation(convo.id);
    expect(loaded?.candidates.map((c) => c.label)).toEqual(["terse", "rigorous"]);
    expect(loaded?.candidates[0]?.fromVersion).toBe(1);
  });
});

describe("pending clarification (WS-R5)", () => {
  beforeEach(isolatedDataDir);

  it("survives across turns until the user answers it", () => {
    const convo = fresh();
    setPendingClarification(convo, { question: "Which database?", options: ["Postgres", "SQLite"], turnId: "t1" });
    saveConversation(convo);

    const reloaded = loadConversation(convo.id) as Conversation;
    expect(reloaded.pendingClarification?.question).toBe("Which database?");

    const resolved = resolvePendingClarification(reloaded, "Postgres", "t2");
    expect(resolved?.answer).toBe("Postgres");
    expect(reloaded.pendingClarification).toBeNull();
  });

  it("resolving with nothing pending returns null and changes no state", () => {
    const convo = fresh();
    const before = semanticSnapshot(convo);
    expect(resolvePendingClarification(convo, "anything", "t1")).toBeNull();
    expect(semanticSnapshot(convo)).toBe(before);
  });
});

describe("semantic/run split of conversation state (WS-R9)", () => {
  beforeEach(isolatedDataDir);

  it("excludes run data — timestamps, events and model calls — from the semantic snapshot", () => {
    const convo = fresh();
    addPromptVersion(convo, "p1", "model", { action: "CREATE", turnId: "t1" });
    const before = semanticSnapshot(convo);

    appendTurnEvent(convo, { turnId: "t2", kind: "turn_started" });
    recordModelCall(convo, callRecord() as never);
    convo.updatedAt = "2099-01-01T00:00:00.000Z";

    expect(semanticSnapshot(convo)).toBe(before);
    expect(before).not.toMatch(/2099|latencyMs|turnEvents/);
  });

  it("includes what the user would call a change to the conversation", () => {
    const convo = fresh();
    const before = semanticSnapshot(convo);
    addPromptVersion(convo, "p1", "model", { action: "CREATE", turnId: "t1" });
    expect(semanticSnapshot(convo)).not.toBe(before);
  });
});

describe("prompt versions record their origin (WS-R7)", () => {
  beforeEach(isolatedDataDir);

  it("records the action and the turn that produced the version", () => {
    const convo = fresh();
    const version = addPromptVersion(convo, "p1", "model", { action: "CREATE", turnId: "turn-123" });
    expect(version.action).toBe("CREATE");
    expect(version.turnId).toBe("turn-123");
  });

  it("is immutable once written: a later version never edits an earlier one", () => {
    const convo = fresh();
    const first = addPromptVersion(convo, "p1", "model", { action: "CREATE", turnId: "t1" });
    const serialized = JSON.stringify(first);
    addPromptVersion(convo, "p2", "model", { action: "REVISE", turnId: "t2" });
    expect(JSON.stringify(convo.promptVersions[0])).toBe(serialized);
    expect(Object.isFrozen(convo.promptVersions[0])).toBe(true);
  });
});

describe("the workspace's own model calls are accounted for (WS-R14, AC-031)", () => {
  beforeEach(isolatedDataDir);

  it("surfaces the intent.extract call record from structure analysis and persists it", async () => {
    const { analyzePrompt } = await import("../../web/lib/forge");
    const provider = {
      id: "openai-compat",
      defaultModel: "test-model",
      complete: async () => ({
        text: JSON.stringify(ANALYZE_DRAFT),
        model: "test-model",
        latencyMs: 3,
      }),
    };
    const analysis = await analyzePrompt(
      "Fix the flaky login redirect test in src/auth/login.test.ts without changing the AuthProvider interface.",
      { provider: provider as never, providerId: "openai-compat", model: "test-model", sessionHeader: null, extraHeaders: {} },
      "generic",
    );
    expect(analysis.record.boundaryId).toBe("intent.extract");
    expect(analysis.record.provider).toBe("openai-compat");

    const convo = fresh();
    recordModelCall(convo, analysis.record);
    saveConversation(convo);
    expect(loadConversation(convo.id)?.modelCalls[0]?.boundaryId).toBe("intent.extract");
  });
});

/** A schema-valid DraftIR, so the real boundary runs with a stand-in model. */
const ANALYZE_DRAFT = {
  objective: {
    statement: "Fix the flaky login redirect test",
    kind: "debug",
    success_definition: "The login redirect test passes consistently",
    derived_from: "s1",
  },
  goals: [
    {
      id: "g1",
      statement: "Fix the flaky login redirect test",
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
      statement: "Do not change the AuthProvider interface",
      derived_from: "s1",
    },
  ],
  non_goals: [],
  scope: { include: ["src/auth/login.test.ts"], exclude: [], blast_radius: "file", derived_from: "s1" },
  required_capabilities: ["run_tests"],
  assumptions: [],
  open_questions: [],
  verification: [
    {
      id: "v1",
      kind: "test",
      spec: "Run the login redirect test three times",
      expected: "three consecutive passes",
      satisfies: ["g1"],
      derived_from: "s1",
    },
  ],
  deliverables: [{ id: "d1", kind: "code_change", description: "Fixed login redirect test", derived_from: "s1" }],
  risk: { level: "low", factors: [] },
};

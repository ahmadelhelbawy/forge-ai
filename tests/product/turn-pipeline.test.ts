/**
 * V2-A2 — the FORGE-owned turn pipeline and the conversation action model.
 *
 * Requirements: WS-R1 (closed action set), WS-R2 (only four actions write a
 * version), WS-R3 (the check is on the effect, not the label), WS-R4 (a failed
 * classification degrades to DISCUSS with a diagnostic), WS-R5 (an action the
 * state cannot express is refused, not silently downgraded), WS-R10/R11 (typed
 * events with user-meaningful stages), WS-R12 (cancel loses nothing),
 * WS-R13 (bounded call budget), WS-R14 (every call recorded).
 * Acceptance: AC-029, AC-030, AC-031, AC-036.
 *
 * The model is a stand-in that replays canned texts: what is under test is
 * FORGE's half of the turn, never the model's wording.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CONVERSATION_ACTIONS,
  READ_ONLY_ACTIONS,
  VERSION_WRITING_ACTIONS,
} from "../../src/conversation/actions.js";
import {
  addPromptVersion,
  currentPrompt,
  newConversation,
  saveConversation,
  semanticSnapshot,
  setPendingClarification,
  type Conversation,
} from "../../web/lib/store";
import { isTurnDelta } from "../../web/lib/turn/events";
import type { TurnEvent, TurnStreamItem } from "../../web/lib/turn/events";
import { CLASSIFY_MESSAGE_LIMIT, TURN_CALL_BUDGET, executeTurn, runTurn } from "../../web/lib/turn/pipeline";
import type { TurnDeps } from "../../web/lib/turn/pipeline";

function isolatedDataDir(): void {
  const dir = mkdtempSync(join(tmpdir(), "forge-turn-pipeline-"));
  process.env["FORGE_DATA_DIR"] = join(dir, "data");
}

interface Recorder {
  readonly deps: TurnDeps;
  readonly prompts: string[];
  calls(): number;
}

/** A model stand-in: one canned classification, one canned generation. */
function deps(options: {
  classification?: string;
  generation?: string;
  classifyThrows?: Error;
  generateThrows?: Error;
}): Recorder {
  const prompts: string[] = [];
  let calls = 0;
  return {
    prompts,
    calls: () => calls,
    deps: {
      providerId: "test-provider",
      renderGeneration: (action, message) => ({
        system: `SYSTEM for ${action}`,
        user: message,
      }),
      async complete(request) {
        calls += 1;
        prompts.push(request.user);
        const isClassification = request.user.includes("Classify the user's message");
        if (isClassification) {
          if (options.classifyThrows) throw options.classifyThrows;
          return { text: options.classification ?? '{"action":"DISCUSS","versions":[]}', model: "test-model", latencyMs: 4 };
        }
        if (options.generateThrows) throw options.generateThrows;
        return {
          text: options.generation ?? '{"reply":"ok","prompt":null}',
          model: "test-model",
          latencyMs: 9,
        };
      },
    },
  };
}

function conversationWithPrompt(): Conversation {
  const convo = newConversation({ title: "t" });
  addPromptVersion(convo, "the original prompt", "model", { action: "CREATE", turnId: "seed" });
  saveConversation(convo);
  return convo;
}

const envelope = (prompt: string | null) => JSON.stringify({ reply: "done", prompt });
const classification = (action: string, versions: number[] = []) => JSON.stringify({ action, versions });

describe("only four actions may write a version (WS-R2, AC-029)", () => {
  beforeEach(isolatedDataDir);

  it("writes no version for any read-only action, even when the model sends a prompt", async () => {
    for (const action of READ_ONLY_ACTIONS) {
      const convo = conversationWithPrompt();
      const before = convo.promptVersions.length;
      const result = await executeTurn(
        convo,
        "a message",
        deps({ classification: classification(action), generation: envelope("A SPURIOUS NEW PROMPT") }).deps,
      );
      expect(result.action, action).toBe(action);
      expect(convo.promptVersions.length, action).toBe(before);
      expect(currentPrompt(convo), action).toBe("the original prompt");
    }
  });

  it("blocks the write loudly: a read-only action carrying a prompt emits an error diagnostic (WS-R3)", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "why did you structure it that way?",
      deps({ classification: classification("EXPLAIN"), generation: envelope("SPURIOUS") }).deps,
    );
    const codes = result.diagnostics.map((d) => d.code);
    expect(codes).toContain("FORGE-W004");
    expect(result.diagnostics.find((d) => d.code === "FORGE-W004")?.severity).toBe("error");
    expect(result.version).toBeNull();
  });

  it("writes a version for CREATE, REVISE and MERGE when the model produced one", async () => {
    for (const action of VERSION_WRITING_ACTIONS.filter((a) => a !== "RESTORE")) {
      const convo = conversationWithPrompt();
      addPromptVersion(convo, "second", "model", { action: "REVISE", turnId: "seed2" });
      const before = convo.promptVersions.length;
      const result = await executeTurn(
        convo,
        "change it",
        deps({ classification: classification(action), generation: envelope(`revised by ${action}`) }).deps,
      );
      expect(result.version?.action, action).toBe(action);
      expect(convo.promptVersions.length, action).toBe(before + 1);
    }
  });

  it("records the action and turn on the version it wrote (WS-R7)", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "make it stricter",
      deps({ classification: classification("REVISE"), generation: envelope("stricter prompt") }).deps,
    );
    expect(result.version?.turnId).toBe(result.turnId);
    expect(result.version?.source).toBe("model");
  });

  it("asking a question produces an answer and no new version — the daily defect", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "why did you structure it that way?",
      deps({ classification: classification("EXPLAIN"), generation: envelope(null) }).deps,
    );
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.version).toBeNull();
    expect(convo.promptVersions).toHaveLength(1);
  });
});

describe("a very long message still resolves an action", () => {
  beforeEach(isolatedDataDir);

  it("classifies a paste larger than the classifier's input limit", async () => {
    const convo = conversationWithPrompt();
    const huge = "Requirement: validate inputs before acting.\n".repeat(2000);
    const result = await executeTurn(
      convo,
      huge,
      deps({ classification: classification("REVISE"), generation: envelope("revised") }).deps,
    );
    expect(huge.length).toBeGreaterThan(CLASSIFY_MESSAGE_LIMIT);
    expect(result.degraded).toBe(false);
    expect(result.action).toBe("REVISE");
    expect(result.version).not.toBeNull();
  });

  it("sends the classifier no more than its declared input limit", async () => {
    const convo = conversationWithPrompt();
    const recorder = deps({ classification: classification("REVISE"), generation: envelope("revised") });
    await executeTurn(convo, "x".repeat(CLASSIFY_MESSAGE_LIMIT + 5000), recorder.deps);
    const classifyPrompt = recorder.prompts[0] as string;
    expect(classifyPrompt.length).toBeLessThan(CLASSIFY_MESSAGE_LIMIT + 2000);
  });
});

describe("classification failure degrades to DISCUSS (WS-R4, AC-030)", () => {
  beforeEach(isolatedDataDir);

  it("degrades when the classifier call throws", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "anything",
      deps({ classifyThrows: new Error("upstream 500"), generation: envelope("SPURIOUS") }).deps,
    );
    expect(result.action).toBe("DISCUSS");
    expect(result.degraded).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W001");
    expect(result.version).toBeNull();
    expect(convo.promptVersions).toHaveLength(1);
  });

  it("degrades when the classifier answers with something that is not an action", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "anything",
      deps({ classification: '{"action":"OBLITERATE"}', generation: envelope("SPURIOUS") }).deps,
    );
    expect(result.action).toBe("DISCUSS");
    expect(result.degraded).toBe(true);
    expect(result.version).toBeNull();
  });

  it("never degrades into letting the model decide whether to write", async () => {
    const convo = conversationWithPrompt();
    await executeTurn(
      convo,
      "anything",
      deps({ classifyThrows: new Error("down"), generation: envelope("MODEL DECIDED TO WRITE") }).deps,
    );
    expect(currentPrompt(convo)).toBe("the original prompt");
  });

  it("still answers the user — a degraded turn is not a lost turn", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "anything",
      deps({ classifyThrows: new Error("down"), generation: envelope(null) }).deps,
    );
    expect(result.reply).toBe("done");
    expect(convo.messages.at(-1)?.role).toBe("assistant");
  });
});

describe("an action the state cannot express is refused (WS-R5)", () => {
  beforeEach(isolatedDataDir);

  it("refuses RESTORE of a version that does not exist, and says why", async () => {
    const convo = conversationWithPrompt();
    const recorder = deps({ classification: classification("RESTORE", [9]) });
    const result = await executeTurn(convo, "go back to version 9", recorder.deps);
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W002");
    expect(result.refused).toBe(true);
    expect(result.version).toBeNull();
    expect(result.reply).toMatch(/9/);
  });

  it("refuses COMPARE with only one artifact without spending a generation call", async () => {
    const convo = conversationWithPrompt();
    const recorder = deps({ classification: classification("COMPARE") });
    const result = await executeTurn(convo, "compare them", recorder.deps);
    expect(result.refused).toBe(true);
    expect(recorder.calls()).toBe(1);
  });

  it("refuses CLARIFY when no question is outstanding", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(convo, "postgres", deps({ classification: classification("CLARIFY") }).deps);
    expect(result.refused).toBe(true);
  });

  it("allows CLARIFY once a question is pending, and resolves it", async () => {
    const convo = conversationWithPrompt();
    setPendingClarification(convo, { question: "Which database?", turnId: "t0" });
    const result = await executeTurn(
      convo,
      "postgres",
      deps({ classification: classification("CLARIFY"), generation: envelope(null) }).deps,
    );
    expect(result.refused).toBe(false);
    expect(convo.pendingClarification).toBeNull();
  });
});

describe("RESTORE moves the pointer and records that it did (WS-R7)", () => {
  beforeEach(isolatedDataDir);

  it("makes an earlier version current without rewriting history", async () => {
    const convo = conversationWithPrompt();
    addPromptVersion(convo, "second prompt", "model", { action: "REVISE", turnId: "seed2" });
    const result = await executeTurn(convo, "go back to version 1", deps({ classification: classification("RESTORE", [1]) }).deps);
    expect(result.refused).toBe(false);
    expect(convo.currentV).toBe(1);
    expect(convo.promptVersions).toHaveLength(2);
    expect(currentPrompt(convo)).toBe("the original prompt");
  });
});

describe("an unreadable response degrades to reply-only (INV-012)", () => {
  beforeEach(isolatedDataDir);

  it("keeps the prose, writes no version, and records a diagnostic", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "revise it",
      deps({ classification: classification("REVISE"), generation: "I cannot produce JSON today." }).deps,
    );
    expect(result.reply).toContain("cannot produce JSON");
    expect(result.version).toBeNull();
    expect(result.diagnostics.map((d) => d.code)).toContain("FORGE-W003");
  });

  it("shows the recovered reply, not raw JSON, and warns only when something was lost (hardening pass)", async () => {
    // Broken after the reply (live: 1 in 4 answers from one model).
    const broken = '{"reply":"Here is my read.","prompt":null,"extra":[1 2]}';
    const discuss = await executeTurn(
      conversationWithPrompt(),
      "what do you think?",
      deps({ classification: classification("DISCUSS"), generation: broken }).deps,
    );
    expect(discuss.reply).toBe("Here is my read.");
    expect(discuss.diagnostics.map((d) => d.code)).not.toContain("FORGE-W003");

    // A write-capable action lost its prompt: that is reported, with the cause.
    const revise = await executeTurn(
      conversationWithPrompt(),
      "revise it",
      deps({ classification: classification("REVISE"), generation: '{"reply":"Done.","prompt":"x" "y"}' }).deps,
    );
    expect(revise.reply).toBe("Done.");
    const w003 = revise.diagnostics.find((d) => d.code === "FORGE-W003");
    expect(w003?.message).toMatch(/invalid JSON/);
  });
});

describe("the turn event log (WS-R10, WS-R11)", () => {
  beforeEach(isolatedDataDir);

  it("emits typed events in order, ending with completion", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(
      convo,
      "revise it",
      deps({ classification: classification("REVISE"), generation: envelope("new") }).deps,
    );
    const kinds = result.events.map((e) => e.kind);
    expect(kinds[0]).toBe("turn_started");
    expect(kinds).toContain("action_resolved");
    expect(kinds).toContain("version_created");
    expect(kinds.at(-1)).toBe("turn_completed");
    expect(result.events.every((e) => e.turnId === result.turnId)).toBe(true);
  });

  it("names stages in words a user can read, and carries no reasoning", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(convo, "hello", deps({}).deps);
    const stages = result.events.filter((e) => e.kind === "stage");
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect((stage as { label: string }).label).toMatch(/[a-z]/i);
      expect(JSON.stringify(stage)).not.toMatch(/reasoning|chain.of.thought|thinking/i);
    }
  });

  it("appends to the conversation's own log, not a second one", async () => {
    const convo = conversationWithPrompt();
    const result = await executeTurn(convo, "hello", deps({}).deps);
    expect(convo.turnEvents.map((e) => e.seq)).toEqual(result.events.map((e) => e.seq));
  });
});

describe("model call accounting and budget (WS-R13, WS-R14, AC-031)", () => {
  beforeEach(isolatedDataDir);

  // The declared budget is 3 since WS-R34 allows one classification repair;
  // an ordinary revision with a well-formed classification still spends 2.
  it("spends exactly one classification plus one generation on an ordinary revision", async () => {
    const convo = conversationWithPrompt();
    const recorder = deps({ classification: classification("REVISE"), generation: envelope("new") });
    await executeTurn(convo, "revise it", recorder.deps);
    expect(recorder.calls()).toBe(2);
    // WS-R13 (Sprint 2): classify + its repair + generate + one discovery repair.
    expect(TURN_CALL_BUDGET).toBe(4);
  });

  it("records one ModelCallRecord per call, naming the boundary it served", async () => {
    const convo = conversationWithPrompt();
    await executeTurn(
      convo,
      "revise it",
      deps({ classification: classification("REVISE"), generation: envelope("new") }).deps,
    );
    expect(convo.modelCalls.map((r) => r.boundaryId)).toEqual([
      "conversation.classify",
      "conversation.generate",
    ]);
    for (const record of convo.modelCalls) {
      expect(record.promptHash).toMatch(/^sha256:/);
      expect(record.outputHash).toMatch(/^sha256:/);
      expect(record.provider).toBe("test-provider");
      expect(record.replayed).toBe(false);
    }
  });

  it("accounts for the classification call even when classification failed", async () => {
    const convo = conversationWithPrompt();
    await executeTurn(convo, "hello", deps({ classification: "not json", generation: envelope(null) }).deps);
    expect(convo.modelCalls.map((r) => r.boundaryId)).toContain("conversation.classify");
  });
});

describe("a cancelled turn loses exactly what a failed turn loses (WS-R12, AC-036)", () => {
  beforeEach(isolatedDataDir);

  it("leaves the conversation semantically byte-identical to a failed turn", async () => {
    const cancelled = conversationWithPrompt();
    const controller = new AbortController();
    controller.abort();
    const cancelledResult = await executeTurn(
      cancelled,
      "revise it",
      deps({ classification: classification("REVISE"), generation: envelope("new") }).deps,
      { signal: controller.signal },
    );

    const failed = conversationWithPrompt();
    const failedResult = await executeTurn(
      failed,
      "revise it",
      deps({ classifyThrows: new Error("down"), generateThrows: new Error("down") }).deps,
    );

    expect(cancelledResult.cancelled).toBe(true);
    expect(failedResult.failed).toBe(true);
    expect(semanticSnapshot(cancelled).replace(cancelled.id, "ID")).toBe(
      semanticSnapshot(failed).replace(failed.id, "ID"),
    );
  });

  it("keeps the user's message and writes neither an assistant message nor a version", async () => {
    const convo = conversationWithPrompt();
    const controller = new AbortController();
    controller.abort();
    await executeTurn(convo, "revise it", deps({ classification: classification("REVISE") }).deps, {
      signal: controller.signal,
    });
    expect(convo.messages.map((m) => m.role)).toEqual(["user"]);
    expect(convo.promptVersions).toHaveLength(1);
  });
});

describe("the action set is closed (WS-R1)", () => {
  // Eleven since Product Sprint 1 added DISCOVER, which is read-only (§22.11).
  it("has exactly eleven actions, four of which may write", () => {
    expect(CONVERSATION_ACTIONS).toHaveLength(11);
    expect(VERSION_WRITING_ACTIONS).toHaveLength(4);
    expect(READ_ONLY_ACTIONS).toHaveLength(7);
    expect(READ_ONLY_ACTIONS).toContain("DISCOVER");
  });
});

/**
 * V2-B — streaming, stages, cancellation, retry (WS-R10…WS-R13, AC-036).
 *
 * The stand-in model here streams in awkward chunks on purpose. What is under
 * test is that FORGE shows text as it arrives without letting the stream
 * decide anything: the artifact still comes from the accumulated text, a
 * cancel mid-stream writes nothing, and no delta reaches the audit log.
 */
function streamingDeps(options: {
  classification?: string;
  generation?: string;
  chunkSize?: number;
  /** Called after each chunk, so a test can cancel mid-stream. */
  onChunkIndex?: (index: number) => void;
}): { deps: TurnDeps; streamCalls: () => number } {
  let streamCalls = 0;
  const base = deps({ classification: options.classification });
  return {
    streamCalls: () => streamCalls,
    deps: {
      ...base.deps,
      async *streamComplete(request) {
        streamCalls += 1;
        void request;
        const text = options.generation ?? '{"reply":"streamed ok","prompt":null}';
        const size = options.chunkSize ?? 7;
        let index = 0;
        for (let at = 0; at < text.length; at += size) {
          yield text.slice(at, at + size);
          options.onChunkIndex?.(index);
          index += 1;
        }
        return { text, model: "test-model", latencyMs: 12 };
      },
    },
  };
}

async function collect(
  convo: Conversation,
  message: string,
  turnDeps: TurnDeps,
  options?: Parameters<typeof runTurn>[3],
): Promise<{ items: TurnStreamItem[]; result: Awaited<ReturnType<typeof executeTurn>> }> {
  const iterator = runTurn(convo, message, turnDeps, options ?? {});
  const items: TurnStreamItem[] = [];
  let next = await iterator.next();
  while (!next.done) {
    items.push(next.value);
    next = await iterator.next();
  }
  return { items, result: next.value };
}

describe("tokens stream while the turn runs (WS-R10)", () => {
  beforeEach(isolatedDataDir);

  it("emits reply and prompt deltas that reassemble the final answer", async () => {
    const convo = conversationWithPrompt();
    const generation = JSON.stringify({ reply: "Switched to PostgreSQL.", prompt: "Use PostgreSQL." });
    const { items, result } = await collect(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation }).deps,
    );
    const deltas = items.filter(isTurnDelta);
    expect(deltas.length).toBeGreaterThan(1);
    const reply = deltas.filter((d) => d.kind === "reply_delta").map((d) => d.text).join("");
    const prompt = deltas.filter((d) => d.kind === "prompt_delta").map((d) => d.text).join("");
    expect(reply).toBe("Switched to PostgreSQL.");
    expect(prompt).toBe("Use PostgreSQL.");
    expect(result.reply).toBe("Switched to PostgreSQL.");
    expect(result.streamed).toBe(true);
    expect(currentPrompt(convo)).toBe("Use PostgreSQL.");
  });

  it("falls back to a whole completion when the transport cannot stream", async () => {
    const convo = conversationWithPrompt();
    const { items, result } = await collect(
      convo,
      "make the database postgres",
      deps({ classification: classification("REVISE"), generation: envelope("non-streamed") }).deps,
    );
    expect(items.filter(isTurnDelta)).toEqual([]);
    expect(result.streamed).toBe(false);
    expect(currentPrompt(convo)).toBe("non-streamed");
  });

  it("keeps deltas out of the audit log (WS-R10, AC-036)", async () => {
    const convo = conversationWithPrompt();
    await collect(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation: envelope("p") }).deps,
    );
    for (const event of convo.turnEvents) {
      expect(event.kind).not.toBe("reply_delta");
      expect(event.kind).not.toBe("prompt_delta");
    }
    expect(convo.turnEvents.map((e) => e.seq)).toEqual(convo.turnEvents.map((_, i) => i + 1));
  });

  it("never streams anything the model wrote outside the envelope (WS-R11)", async () => {
    const convo = conversationWithPrompt();
    const generation =
      'Thinking: the user is asking about Postgres, so first I will consider...\n' +
      JSON.stringify({ reasoning: "step one, step two", reply: "Done.", prompt: "Use PostgreSQL." });
    const { items } = await collect(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation, chunkSize: 3 }).deps,
    );
    const streamed = items.filter(isTurnDelta).map((d) => d.text).join("");
    expect(streamed).not.toMatch(/Thinking/);
    expect(streamed).not.toMatch(/step one/);
    expect(streamed).toBe("Done.Use PostgreSQL.");
  });
});

describe("stages are named and ordered (WS-R11)", () => {
  beforeEach(isolatedDataDir);

  it("reports the user-meaningful stages of a revision in order", async () => {
    const convo = conversationWithPrompt();
    convo.target = "claude-code";
    const { items } = await collect(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation: envelope("p") }).deps,
    );
    const stages = items
      .filter((i): i is Extract<TurnEvent, { kind: "stage" }> => i.kind === "stage")
      .map((s) => s.stage);
    expect(stages).toEqual(["classifying", "reading_prompt", "adapting", "generating", "verifying", "saving"]);
  });

  it("gives every stage a label that names the work, not a spinner", async () => {
    const convo = conversationWithPrompt();
    const { items } = await collect(
      convo,
      "why is it like that?",
      streamingDeps({ classification: classification("EXPLAIN") }).deps,
    );
    const labels = items
      .filter((i): i is Extract<TurnEvent, { kind: "stage" }> => i.kind === "stage")
      .map((s) => s.label);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(3);
      expect(label).not.toMatch(/loading|please wait|thinking/i);
    }
  });

  it("skips the adapting stage for the generic target, which adapts to nothing", async () => {
    const convo = conversationWithPrompt();
    convo.target = "generic";
    const { items } = await collect(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation: envelope("p") }).deps,
    );
    const stages = items
      .filter((i): i is Extract<TurnEvent, { kind: "stage" }> => i.kind === "stage")
      .map((s) => s.stage);
    expect(stages).not.toContain("adapting");
  });
});

describe("a cancel mid-stream writes nothing (WS-R12, AC-036)", () => {
  beforeEach(isolatedDataDir);

  it("discards the partial text and leaves the conversation as a failed turn would", async () => {
    const cancelled = conversationWithPrompt();
    const controller = new AbortController();
    const streaming = streamingDeps({
      classification: classification("REVISE"),
      generation: envelope("A PROMPT THAT MUST NOT BE SAVED"),
      chunkSize: 4,
      onChunkIndex: (index) => {
        if (index === 1) controller.abort();
      },
    });
    const { result } = await collect(cancelled, "revise it", streaming.deps, { signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(cancelled.messages.map((m) => m.role)).toEqual(["user"]);
    expect(cancelled.promptVersions).toHaveLength(1);
    expect(currentPrompt(cancelled)).toBe("the original prompt");
    expect(cancelled.turnEvents.at(-1)?.kind).toBe("turn_cancelled");

    const failed = conversationWithPrompt();
    await executeTurn(failed, "revise it", deps({ generateThrows: new Error("down") }).deps);
    expect(semanticSnapshot(cancelled).replace(cancelled.id, "ID")).toBe(
      semanticSnapshot(failed).replace(failed.id, "ID"),
    );
  });

  it("a Stop pressed while 'Verifying' or 'Saving' is shown still writes nothing (hardening pass)", async () => {
    for (const stage of ["verifying", "saving"]) {
      const convo = conversationWithPrompt();
      const controller = new AbortController();
      const iterator = runTurn(
        convo,
        "revise it",
        deps({ classification: classification("REVISE"), generation: envelope("A PROMPT THAT MUST NOT BE SAVED") }).deps,
        { signal: controller.signal },
      );
      let next = await iterator.next();
      while (!next.done) {
        // The consumer sees the stage, then the user presses Stop before it asks for more.
        const item = next.value as { kind?: string; stage?: string };
        if (item.kind === "stage" && item.stage === stage) controller.abort();
        next = await iterator.next();
      }
      expect(next.value.cancelled, stage).toBe(true);
      expect(convo.promptVersions, stage).toHaveLength(1);
      expect(currentPrompt(convo), stage).toBe("the original prompt");
    }
  });

  it("records the model call it actually made, because it did happen (WS-R14)", async () => {
    const convo = conversationWithPrompt();
    const controller = new AbortController();
    const streaming = streamingDeps({
      classification: classification("REVISE"),
      chunkSize: 4,
      onChunkIndex: () => controller.abort(),
    });
    await collect(convo, "revise it", streaming.deps, { signal: controller.signal });
    expect(convo.modelCalls.map((r) => r.boundaryId)).toContain("conversation.classify");
  });
});

describe("a turn can be regenerated (WS-R13)", () => {
  beforeEach(isolatedDataDir);

  it("re-runs the last user message without duplicating it", async () => {
    const convo = conversationWithPrompt();
    await executeTurn(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation: envelope("first attempt") }).deps,
    );
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);

    const regenerated = await executeTurn(
      convo,
      "make the database postgres",
      streamingDeps({ classification: classification("REVISE"), generation: envelope("second attempt") }).deps,
      { regenerate: true },
    );
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(convo.messages[0]?.content).toBe("make the database postgres");
    expect(regenerated.regenerated).toBe(true);
    expect(currentPrompt(convo)).toBe("second attempt");
    expect(convo.turnEvents.filter((e) => e.kind === "turn_started" && e.regenerated === true)).toHaveLength(1);
  });

  it("stays within the declared call budget when it regenerates", async () => {
    const convo = conversationWithPrompt();
    const first = deps({ classification: classification("REVISE"), generation: envelope("a") });
    await executeTurn(convo, "change it", first.deps);
    expect(first.calls()).toBe(2);
    const second = deps({ classification: classification("REVISE"), generation: envelope("b") });
    await executeTurn(convo, "change it", second.deps, { regenerate: true });
    expect(second.calls()).toBe(2);
    expect(second.calls()).toBeLessThanOrEqual(TURN_CALL_BUDGET);
  });

  it("regenerating a discussion still writes no version (WS-R2)", async () => {
    const convo = conversationWithPrompt();
    await executeTurn(convo, "why?", deps({ classification: classification("EXPLAIN") }).deps);
    const before = convo.promptVersions.length;
    await executeTurn(convo, "why?", deps({ classification: classification("EXPLAIN") }).deps, {
      regenerate: true,
    });
    expect(convo.promptVersions).toHaveLength(before);
    expect(convo.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

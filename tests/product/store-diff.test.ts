/**
 * Product unit tests (default suite): file store, line diff, chat-protocol
 * parsing. No server, no model, no network.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSystemPrompt, parseChatReply } from "../../web/lib/chat";
import { diffLines, estimateTokens } from "../../web/lib/diff";
import {
  addPromptVersion,
  currentPrompt,
  deleteConversation,
  listConversations,
  loadConversation,
  newConversation,
  saveConversation,
} from "../../web/lib/store";

function isolatedDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-product-"));
  process.env["FORGE_DATA_DIR"] = join(dir, "data");
  return dir;
}

describe("conversation store", () => {
  it("round-trips conversations with versions", () => {
    isolatedDataDir();
    const convo = newConversation({ title: "t", target: "claude-code" });
    convo.messages.push({ role: "user", content: "hi", at: new Date().toISOString() });
    addPromptVersion(convo, "prompt one", "model");
    addPromptVersion(convo, "prompt two", "manual");
    saveConversation(convo);

    const loaded = loadConversation(convo.id)!;
    expect(loaded.title).toBe("t");
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.promptVersions.map((p) => p.v)).toEqual([1, 2]);
    expect(loaded.currentV).toBe(2);
    expect(currentPrompt(loaded)).toBe("prompt two");
    expect(listConversations()).toHaveLength(1);
    expect(deleteConversation(convo.id)).toBe(true);
    expect(loadConversation(convo.id)).toBeNull();
    expect(listConversations()).toHaveLength(0);
  });

  it("returns null for unknown ids and rejects path traversal", () => {
    isolatedDataDir();
    expect(loadConversation("nope")).toBeNull();
    expect(loadConversation("../../etc/passwd")).toBeNull();
    expect(deleteConversation("../../etc/passwd")).toBe(false);
  });
});

describe("diffLines", () => {
  it("marks changed lines while keeping context", () => {
    const hunks = diffLines("a\nb\nc", "a\nB\nc");
    expect(hunks).toEqual([
      { type: "same", lines: ["a"] },
      { type: "del", lines: ["b"] },
      { type: "add", lines: ["B"] },
      { type: "same", lines: ["c"] },
    ]);
  });

  it("handles empty inputs and guards huge ones", () => {
    expect(diffLines("", "")).toEqual([{ type: "same", lines: [""] }]);
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
    const hunks = diffLines(big, `${big}\nlast`);
    expect(hunks.some((h) => h.type === "add")).toBe(true);
  });

  it("estimates tokens at roughly four chars each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("parseChatReply", () => {
  it("extracts the envelope", () => {
    expect(parseChatReply('{"reply": "hi", "prompt": "PROMPT"}')).toEqual({ reply: "hi", prompt: "PROMPT" });
  });

  it("treats null prompt as discussion-only", () => {
    expect(parseChatReply('{"reply": "ok", "prompt": null}')).toEqual({ reply: "ok", prompt: null });
  });

  it("degrades non-JSON to chat-only without a version", () => {
    expect(parseChatReply("just some prose")).toEqual({ reply: "just some prose", prompt: null });
    expect(parseChatReply("")).toEqual({ reply: "", prompt: null });
  });
});

describe("the system prompt states what the resolved action permits (WS-R2)", () => {
  const context = (action?: "EXPLAIN" | "REVISE") => ({
    target: null,
    targetId: "generic",
    currentPrompt: "an existing prompt",
    currentVersion: 1,
    attachments: [],
    isFirstTurn: false,
    ...(action ? { action } : {}),
  });

  it("tells the model a read-only action must return a null prompt", () => {
    const prompt = buildSystemPrompt(context("EXPLAIN"));
    expect(prompt).toContain("EXPLAIN");
    expect(prompt).toMatch(/read-only/i);
  });

  it("tells the model a version-writing action may return a prompt", () => {
    const prompt = buildSystemPrompt(context("REVISE"));
    expect(prompt).toContain("REVISE");
    expect(prompt).not.toMatch(/read-only/i);
  });

  it("says nothing about actions when none was resolved", () => {
    expect(buildSystemPrompt(context())).not.toMatch(/RESOLVED ACTION/);
  });
});

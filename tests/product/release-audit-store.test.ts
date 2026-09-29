/**
 * Pre-release audit (2026-09-29): races and lost writes in the store.
 *
 * Reproduced before the fix:
 * - two tabs each writing a revision from v1 both stored `v = 2`, and the
 *   fold and the index disagreed about which text "v2" was;
 * - two racing governance decisions were both appended, after which every
 *   read of the conversation's requirements failed;
 * - re-uploading an attachment under the same name answered 201 and was
 *   never written.
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addPromptVersion,
  ConversationConflictError,
  loadConversation,
  newConversation,
  saveConversation,
  versionHistory,
} from "../../web/lib/store";

beforeEach(() => {
  const root = join(mkdtempSync(join(tmpdir(), "forge-audit-store-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
});

function seeded(): string {
  const convo = newConversation({ title: "race" });
  addPromptVersion(convo, "v1 text", "manual");
  saveConversation(convo);
  return convo.id;
}

describe("a save that would fork a numbered history is refused", () => {
  it("two tabs revising the same version: the second is a conflict, not a second v2", () => {
    const id = seeded();
    const tabA = loadConversation(id)!;
    const tabB = loadConversation(id)!;
    addPromptVersion(tabA, "A's revision", "manual");
    addPromptVersion(tabB, "B's revision", "manual");

    saveConversation(tabA);
    expect(() => saveConversation(tabB)).toThrow(ConversationConflictError);

    const reloaded = loadConversation(id)!;
    expect(reloaded.promptVersions.map((v) => [v.v, v.text])).toEqual([
      [1, "v1 text"],
      [2, "A's revision"],
    ]);
    expect(versionHistory(id).map((v) => v.v)).toEqual([1, 2]);
  });

  it("two racing governance decisions: only the first is written", () => {
    const id = seeded();
    const a = loadConversation(id)!;
    const b = loadConversation(id)!;
    const record = (subject: string) =>
      ({ decision: { kind: "accept", requirement_id: subject }, subjects: [subject], at: new Date().toISOString() }) as never;
    a.governance.push(record("RQ-a"));
    b.governance.push(record("RQ-b"));

    saveConversation(a);
    expect(() => saveConversation(b)).toThrow(ConversationConflictError);
    expect(loadConversation(id)!.governance).toHaveLength(1);
  });

  it("does not refuse a save whose concurrent neighbour changed something unrelated", () => {
    const id = seeded();
    const turn = loadConversation(id)!;
    const rename = loadConversation(id)!;
    rename.title = "renamed while a turn ran";
    saveConversation(rename);

    addPromptVersion(turn, "turn's revision", "model");
    saveConversation(turn);
    const reloaded = loadConversation(id)!;
    expect(reloaded.promptVersions.map((v) => v.v)).toEqual([1, 2]);
    expect(reloaded.title).toBe("renamed while a turn ran");
  });

  it("a fresh load after a conflict can write again", () => {
    const id = seeded();
    const stale = loadConversation(id)!;
    const winner = loadConversation(id)!;
    addPromptVersion(winner, "winner", "manual");
    saveConversation(winner);
    addPromptVersion(stale, "stale", "manual");
    expect(() => saveConversation(stale)).toThrow(ConversationConflictError);

    const retry = loadConversation(id)!;
    addPromptVersion(retry, "retry", "manual");
    saveConversation(retry);
    expect(loadConversation(id)!.promptVersions.map((v) => v.text)).toEqual(["v1 text", "winner", "retry"]);
  });
});

describe("re-uploading an attachment under the same name", () => {
  it("is written, and replaces the earlier file on reload", () => {
    const id = seeded();
    const first = loadConversation(id)!;
    first.attachmentContents["notes.md"] = "OLD CONTENT";
    first.attachments.push({ name: "notes.md", size: 11, truncated: false, at: "2026-09-29T00:00:00.000Z", trust: "semi_trusted", redactions: [] });
    saveConversation(first);

    const second = loadConversation(id)!;
    second.attachmentContents["notes.md"] = "NEW CONTENT";
    const at = second.attachments.findIndex((a) => a.name === "notes.md");
    second.attachments[at] = { name: "notes.md", size: 11, truncated: false, at: "2026-09-29T00:01:00.000Z", trust: "semi_trusted", redactions: [] };
    saveConversation(second);

    const reloaded = loadConversation(id)!;
    expect(reloaded.attachments).toHaveLength(1);
    expect(reloaded.attachmentContents["notes.md"]).toBe("NEW CONTENT");
  });
});

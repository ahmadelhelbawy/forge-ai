/**
 * V2-C — the persistence architecture (WS-R6…WS-R9, WS-R17, WS-R18, AC-032).
 *
 * The claim being tested is narrow and load-bearing: **objects plus the
 * append-only log are the only source of truth, and the SQLite index is a
 * function of them.** Everything else in this file exists to make that claim
 * falsifiable — a round-trip that loses a field, an index that survives a
 * delete with different bytes, or a migration that drops a version would all
 * fail here.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { openRunLog } from "../../src/store/runlog.js";
import {
  addCandidate,
  addPromptVersion,
  appendTurnEvent,
  currentPrompt,
  dataDir,
  deleteConversation,
  listConversations,
  loadConversation,
  newConversation,
  openStoreIndex,
  recordModelCall,
  saveConversation,
  semanticSnapshot,
  setPendingClarification,
  store,
  versionHistory,
} from "../../web/lib/store";
import { migrateFlatFiles } from "../../web/lib/store/migrate";
import { openStore } from "../../web/lib/store/repository";

const FIXTURES = join(process.cwd(), "fixtures", "conversations");

function isolated(): string {
  const root = join(mkdtempSync(join(tmpdir(), "forge-v2c-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
  return root;
}

const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

/** A conversation exercising every field the store can hold. */
function populated(): ReturnType<typeof newConversation> {
  const convo = newConversation({ title: "Studio", target: "claude-code", provider: "opencode-go", model: "kimi-k3" });
  convo.messages.push({ role: "user", content: "build me a reviewer", at: "2026-09-17T10:00:00.000Z" });
  convo.messages.push({ role: "assistant", content: "here it is", at: "2026-09-17T10:00:01.000Z" });
  addPromptVersion(convo, "version one text", "model", { action: "CREATE", turnId: "turn-1" });
  addPromptVersion(convo, "version two text", "model", { action: "REVISE", turnId: "turn-2" });
  addCandidate(convo, { label: "terser", text: "a terser alternative", fromVersion: 2, strategy: "minimal" });
  convo.attachments.push({ name: "schema.sql", size: 12, truncated: false, at: "2026-09-17T10:00:02.000Z" });
  convo.attachmentContents["schema.sql"] = "create table t;";
  setPendingClarification(convo, { question: "Postgres or MySQL?", options: ["Postgres", "MySQL"], turnId: "turn-2" });
  appendTurnEvent(convo, { turnId: "turn-2", kind: "turn_completed", action: "REVISE", versionCreated: true });
  recordModelCall(convo, {
    boundaryId: "conversation.generate",
    boundaryVersion: "1",
    provider: "opencode-go",
    model: "kimi-k3",
    promptHash: "sha256:aa",
    outputHash: "sha256:bb",
    repairs: 0,
    latencyMs: 1234,
    replayed: false,
    timestamp: "2026-09-17T10:00:03.000Z",
  });
  return convo;
}

describe("truth is objects plus the append-only log (WS-R17)", () => {
  beforeEach(isolated);

  it("round-trips every field of a fully populated conversation", () => {
    const written = populated();
    saveConversation(written);
    const read = loadConversation(written.id);
    expect(read).not.toBeNull();
    expect(semanticSnapshot(read!)).toBe(semanticSnapshot(written));
    expect(read!.title).toBe("Studio");
    expect(read!.target).toBe("claude-code");
    expect(read!.provider).toBe("opencode-go");
    expect(read!.model).toBe("kimi-k3");
    expect(read!.messages).toEqual(written.messages);
    expect(read!.promptVersions).toEqual(written.promptVersions);
    expect(read!.candidates).toEqual(written.candidates);
    expect(read!.attachmentContents).toEqual({ "schema.sql": "create table t;" });
    expect(read!.turnEvents).toEqual(written.turnEvents);
    expect(read!.modelCalls).toEqual(written.modelCalls);
    expect(read!.pendingClarification).toEqual(written.pendingClarification);
    expect(currentPrompt(read!)).toBe("version two text");
  });

  it("writes no conversation JSON record at all — the log is the record", () => {
    const convo = populated();
    saveConversation(convo);
    const root = dataDir();
    expect(readdirSync(root).sort()).toEqual(["objects", "runs"]);
    // The index appears only when something queries it, and is never truth.
    listConversations();
    expect(readdirSync(root).sort()).toEqual(["index.sqlite", "objects", "runs"]);
  });

  it("appends on save rather than rewriting: earlier events are untouched", () => {
    const convo = newConversation({ title: "t" });
    convo.messages.push({ role: "user", content: "one", at: "2026-09-17T10:00:00.000Z" });
    saveConversation(convo);
    const first = openRunLog(dataDir()).readAll();

    convo.messages.push({ role: "assistant", content: "two", at: "2026-09-17T10:00:01.000Z" });
    saveConversation(convo);
    const second = openRunLog(dataDir()).readAll();

    expect(second.length).toBeGreaterThan(first.length);
    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("saving twice with no changes appends nothing", () => {
    const convo = populated();
    saveConversation(convo);
    const before = openRunLog(dataDir()).readAll().length;
    saveConversation(convo);
    expect(openRunLog(dataDir()).readAll()).toHaveLength(before);
  });

  it("stores version text as a content-addressed object, once per distinct text (PS-R2)", () => {
    const convo = newConversation({ title: "t" });
    addPromptVersion(convo, "identical text", "model", { action: "CREATE", turnId: "t1" });
    addPromptVersion(convo, "identical text", "manual");
    saveConversation(convo);
    const objects = openStore(dataDir()).objects;
    const hashes = versionHistory(convo.id).map((v) => v.textHash);
    expect(hashes[0]).toBe(hashes[1]);
    expect(objects.get(hashes[0]!)).toBe("identical text");
  });

  it("WS-R18: an attachment payload is an object, never inlined in the log", () => {
    const convo = newConversation({ title: "t" });
    const payload = "SECRET_MARKER_PAYLOAD ".repeat(500);
    convo.attachments.push({ name: "big.txt", size: payload.length, truncated: false, at: "2026-09-17T10:00:00.000Z" });
    convo.attachmentContents["big.txt"] = payload;
    saveConversation(convo);

    const runs = join(dataDir(), "runs");
    for (const file of readdirSync(runs)) {
      expect(readFileSync(join(runs, file), "utf8")).not.toContain("SECRET_MARKER_PAYLOAD");
    }
    expect(loadConversation(convo.id)!.attachmentContents["big.txt"]).toBe(payload);
  });

  it("keeps large message bodies out of the log too", () => {
    const convo = newConversation({ title: "t" });
    const body = "MESSAGE_MARKER ".repeat(1000);
    convo.messages.push({ role: "user", content: body, at: "2026-09-17T10:00:00.000Z" });
    saveConversation(convo);
    for (const file of readdirSync(join(dataDir(), "runs"))) {
      expect(readFileSync(join(dataDir(), "runs", file), "utf8")).not.toContain("MESSAGE_MARKER");
    }
    expect(loadConversation(convo.id)!.messages[0]!.content).toBe(body);
  });

  it("WS-R7: a restore moves the pointer and adds no version", () => {
    const convo = populated();
    saveConversation(convo);
    const loaded = loadConversation(convo.id)!;
    loaded.currentV = 1;
    saveConversation(loaded);

    const again = loadConversation(convo.id)!;
    expect(again.currentV).toBe(1);
    expect(again.promptVersions.map((v) => v.v)).toEqual([1, 2]);
    expect(currentPrompt(again)).toBe("version one text");
  });

  it("WS-R7: version history survives a delete of the index", () => {
    const convo = populated();
    saveConversation(convo);
    expect(versionHistory(convo.id).map((v) => v.v)).toEqual([1, 2]);
    rmSync(join(dataDir(), "index.sqlite"));
    expect(versionHistory(convo.id).map((v) => v.v)).toEqual([1, 2]);
    expect(loadConversation(convo.id)!.promptVersions).toHaveLength(2);
  });

  it("a deleted conversation is a tombstone: it stops listing but nothing is erased", () => {
    const convo = populated();
    saveConversation(convo);
    const objectsBefore = openStore(dataDir()).objects.list();

    expect(deleteConversation(convo.id)).toBe(true);
    expect(loadConversation(convo.id)).toBeNull();
    expect(listConversations().map((c) => c.id)).not.toContain(convo.id);
    expect(openStore(dataDir()).objects.list()).toEqual(objectsBefore);
    expect(deleteConversation(convo.id)).toBe(false);
  });

  it("V2-B truncation is recorded, not silent", () => {
    const convo = newConversation({ title: "t" });
    convo.messages.push({ role: "user", content: "ask", at: "2026-09-17T10:00:00.000Z" });
    convo.messages.push({ role: "assistant", content: "first answer", at: "2026-09-17T10:00:01.000Z" });
    saveConversation(convo);

    convo.messages.pop();
    convo.messages.push({ role: "assistant", content: "second answer", at: "2026-09-17T10:00:02.000Z" });
    saveConversation(convo);

    expect(openRunLog(dataDir()).readAll().map((e) => e["kind"])).toContain("messages_truncated");
    const read = loadConversation(convo.id)!;
    expect(read.messages.map((m) => m.content)).toEqual(["ask", "second answer"]);
  });

  it("lists conversations newest first, with counts", () => {
    const first = newConversation({ title: "older" });
    saveConversation(first);
    const second = populated();
    saveConversation(second);
    const listed = listConversations();
    expect(listed[0]!.id).toBe(second.id);
    expect(listed[0]!.messageCount).toBe(2);
    expect(listed[0]!.currentV).toBe(2);
    expect(listed[0]!.hasPrompt).toBe(true);
    expect(listed.find((c) => c.id === first.id)!.hasPrompt).toBe(false);
  });
});

describe("AC-032 — the index is derivable (PS-R3, AD-20)", () => {
  beforeEach(isolated);

  function busyStore(): void {
    const a = populated();
    saveConversation(a);
    const b = newConversation({ title: "second", target: "kiro" });
    b.messages.push({ role: "user", content: "hello", at: "2026-09-17T11:00:00.000Z" });
    addPromptVersion(b, "b version", "model", { action: "CREATE", turnId: "tb" });
    saveConversation(b);
    const loaded = loadConversation(a.id)!;
    loaded.currentV = 1;
    saveConversation(loaded);
    const c = newConversation({ title: "deleted one" });
    saveConversation(c);
    deleteConversation(c.id);
  }

  it("deleting index.sqlite and rebuilding reproduces it byte for byte", () => {
    busyStore();
    const path = join(dataDir(), "index.sqlite");
    listConversations();
    const before = digest(path);

    rmSync(path);
    expect(existsSync(path)).toBe(false);
    listConversations();

    expect(digest(path)).toBe(before);
  });

  it("the rebuilt index answers identically to the one it replaced", () => {
    busyStore();
    const query = (): unknown => {
      const index = openStoreIndex(store());
      try {
        return {
          conversations: index.query("SELECT * FROM conversation ORDER BY id"),
          versions: index.query("SELECT * FROM prompt_version ORDER BY conversation_id, v"),
          messages: index.query("SELECT * FROM message ORDER BY seq"),
          candidates: index.query("SELECT * FROM candidate ORDER BY id"),
          attachments: index.query("SELECT * FROM attachment ORDER BY seq"),
          calls: index.query("SELECT * FROM model_call ORDER BY seq"),
          events: index.query("SELECT * FROM turn_event ORDER BY seq"),
        };
      } finally {
        index.close();
      }
    };
    const before = JSON.stringify(query());
    rmSync(join(dataDir(), "index.sqlite"));
    expect(JSON.stringify(query())).toBe(before);
  });

  it("holds across repeated rebuilds", () => {
    busyStore();
    const path = join(dataDir(), "index.sqlite");
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      rmSync(path, { force: true });
      listConversations();
      seen.add(digest(path));
    }
    expect(seen.size).toBe(1);
  });

  it("survives a corrupt index by rebuilding it", () => {
    busyStore();
    const path = join(dataDir(), "index.sqlite");
    listConversations();
    const good = digest(path);
    writeFileSync(path, "not a database at all", "utf8");
    expect(listConversations().length).toBeGreaterThan(0);
    expect(digest(path)).toBe(good);
  });

  it("the index holds hashes, so deleting it can never lose content", () => {
    busyStore();
    const index = openStoreIndex(store());
    try {
      const rows = index.query<{ text_hash: string }>("SELECT text_hash FROM prompt_version");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.text_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // And no table holds prompt text itself.
      const columns = index
        .query<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'table'")
        .map((r) => r.sql)
        .join(" ");
      expect(columns).not.toMatch(/\btext TEXT\b/i);
    } finally {
      index.close();
    }
  });
});

describe("migration from the flat conversation files (V2-C exit gate)", () => {
  beforeEach(isolated);

  function withFixtures(): string {
    const root = dataDir();
    cpSync(FIXTURES, join(root, "conversations"), { recursive: true });
    rmSync(join(root, "conversations", "README.md"), { force: true });
    return root;
  }

  it("migrates every real pre-V2-C file, preserving messages and versions", () => {
    withFixtures();
    const listed = listConversations();
    expect(listed).toHaveLength(3);

    // The V2-B browser-run conversation: 10 messages, 4 versions.
    const rich = loadConversation("275ac183-feac-4f9d-af77-11a142c28f85")!;
    const original = JSON.parse(
      readFileSync(join(FIXTURES, "275ac183-feac-4f9d-af77-11a142c28f85.json"), "utf8"),
    ) as { messages: unknown[]; promptVersions: { v: number; text: string }[]; currentV: number; turnEvents: unknown[]; modelCalls: unknown[] };

    expect(rich.messages).toHaveLength(original.messages.length);
    expect(rich.messages).toEqual(original.messages);
    expect(rich.promptVersions.map((v) => v.v)).toEqual(original.promptVersions.map((v) => v.v));
    expect(rich.promptVersions.map((v) => v.text)).toEqual(original.promptVersions.map((v) => v.text));
    expect(rich.currentV).toBe(original.currentV);
    expect(rich.turnEvents).toHaveLength(original.turnEvents.length);
    expect(rich.modelCalls).toHaveLength(original.modelCalls.length);
  });

  it("migrates a pre-V2-A file that has no candidates, turnEvents or modelCalls keys", () => {
    withFixtures();
    const old = loadConversation("325afa81-44fb-45a6-8e7c-1d7088d64fe4")!;
    expect(old.messages.length).toBeGreaterThan(0);
    expect(old.candidates).toEqual([]);
    expect(old.turnEvents).toEqual([]);
    expect(old.modelCalls).toEqual([]);
    expect(old.pendingClarification).toBeNull();
  });

  it("is idempotent: migrating twice changes nothing", () => {
    const root = withFixtures();
    listConversations();
    const events = openRunLog(root).readAll().length;
    const report = migrateFlatFiles(openStore(root));
    expect(report.migrated).toEqual([]);
    expect(report.skipped).toHaveLength(3);
    expect(openRunLog(root).readAll()).toHaveLength(events);
  });

  it("leaves the original files in place, so a bad migration is recoverable", () => {
    const root = withFixtures();
    listConversations();
    expect(readdirSync(join(root, "conversations")).filter((f) => f.endsWith(".json"))).toHaveLength(3);
  });

  it("skips a corrupt file instead of making the readable ones unreachable", () => {
    const root = withFixtures();
    writeFileSync(join(root, "conversations", "broken.json"), "{ not json", "utf8");
    const report = migrateFlatFiles(openStore(root));
    expect(report.migrated).toHaveLength(3);
    expect(report.failed.map((f) => f.file)).toEqual(["broken.json"]);
    expect(listConversations()).toHaveLength(3);
  });

  it("AC-032 holds over a migrated store", () => {
    const root = withFixtures();
    listConversations();
    const path = join(root, "index.sqlite");
    const before = digest(path);
    rmSync(path);
    listConversations();
    expect(digest(path)).toBe(before);
  });

  it("a migrated conversation can then be revised like any other", () => {
    withFixtures();
    const convo = loadConversation("275ac183-feac-4f9d-af77-11a142c28f85")!;
    const versionsBefore = convo.promptVersions.length;
    addPromptVersion(convo, "a post-migration revision", "model", { action: "REVISE", turnId: "post" });
    saveConversation(convo);

    const reloaded = loadConversation(convo.id)!;
    expect(reloaded.promptVersions).toHaveLength(versionsBefore + 1);
    expect(currentPrompt(reloaded)).toBe("a post-migration revision");
    expect(reloaded.promptVersions.slice(0, versionsBefore)).toEqual(convo.promptVersions.slice(0, versionsBefore));
  });
});

/**
 * The conversation projection into the derivable index (AD-20, PS-R3).
 *
 * The core owns the mechanism — fold a log into SQLite, reproducibly. This
 * file owns the shape, because the conversation domain belongs to the
 * workspace and the core may never learn about it (`forge` must not depend
 * on `web`).
 *
 * The projection is a **query convenience**: listing conversations, reading
 * version history, diffing two versions without replaying the log. It holds
 * hashes rather than text, so the index never becomes the only place a piece
 * of content lives. Deleting `index.sqlite` loses nothing (AC-032).
 *
 * `apply` must stay deterministic: no clock, no randomness, no I/O. Every
 * timestamp it writes comes out of the event itself.
 */
import type { IndexProjector } from "forge/dist/store/index-store.js";

export const CONVERSATION_INDEX_VERSION = 3;

export const conversationProjector: IndexProjector = {
  schema: {
    version: CONVERSATION_INDEX_VERSION,
    tables: [
      `CREATE TABLE conversation (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         target TEXT NOT NULL,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         current_v INTEGER NOT NULL,
         message_count INTEGER NOT NULL,
         version_count INTEGER NOT NULL,
         candidate_count INTEGER NOT NULL,
         deleted INTEGER NOT NULL
       )`,
      `CREATE TABLE message (
         seq INTEGER PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         ordinal INTEGER NOT NULL,
         role TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX message_by_conversation ON message (conversation_id, ordinal)",
      `CREATE TABLE prompt_version (
         conversation_id TEXT NOT NULL,
         v INTEGER NOT NULL,
         text_hash TEXT NOT NULL,
         source TEXT NOT NULL,
         action TEXT,
         turn_id TEXT,
         at TEXT NOT NULL,
         PRIMARY KEY (conversation_id, v)
       )`,
      `CREATE TABLE candidate (
         id TEXT PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         label TEXT NOT NULL,
         text_hash TEXT NOT NULL,
         from_version INTEGER,
         strategy TEXT,
         origin TEXT NOT NULL,
         rationale TEXT,
         score INTEGER,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX candidate_by_conversation ON candidate (conversation_id)",
      `CREATE TABLE candidate_promotion (
         seq INTEGER PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         v INTEGER NOT NULL,
         promotion TEXT NOT NULL,
         candidate_ids TEXT NOT NULL,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX candidate_promotion_by_conversation ON candidate_promotion (conversation_id)",
      `CREATE TABLE attachment (
         seq INTEGER PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         name TEXT NOT NULL,
         size INTEGER NOT NULL,
         truncated INTEGER NOT NULL,
         content_hash TEXT NOT NULL,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX attachment_by_conversation ON attachment (conversation_id)",
      `CREATE TABLE pinned_requirement (
         id TEXT PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         text_hash TEXT NOT NULL,
         origin TEXT NOT NULL,
         pinned_from_version INTEGER,
         at TEXT NOT NULL,
         unpinned INTEGER NOT NULL
       )`,
      "CREATE INDEX pinned_requirement_by_conversation ON pinned_requirement (conversation_id)",
      `CREATE TABLE version_ir (
         conversation_id TEXT NOT NULL,
         v INTEGER NOT NULL,
         ir_hash TEXT NOT NULL,
         boundary_id TEXT NOT NULL,
         boundary_version TEXT NOT NULL,
         at TEXT NOT NULL,
         PRIMARY KEY (conversation_id, v)
       )`,
      `CREATE TABLE model_call (
         seq INTEGER PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         boundary_id TEXT NOT NULL,
         provider TEXT NOT NULL,
         model TEXT NOT NULL,
         latency_ms INTEGER NOT NULL,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX model_call_by_conversation ON model_call (conversation_id)",
      `CREATE TABLE turn_event (
         seq INTEGER PRIMARY KEY,
         conversation_id TEXT NOT NULL,
         turn_id TEXT NOT NULL,
         event_seq INTEGER NOT NULL,
         kind TEXT NOT NULL,
         at TEXT NOT NULL
       )`,
      "CREATE INDEX turn_event_by_conversation ON turn_event (conversation_id, event_seq)",
    ],
  },

  apply(event, write) {
    const id = typeof event["id"] === "string" ? event["id"] : null;
    if (id === null) return;

    switch (event["kind"]) {
      case "conversation_created":
        write.run(
          `INSERT OR REPLACE INTO conversation
             (id, title, target, provider, model, created_at, updated_at,
              current_v, message_count, version_count, candidate_count, deleted)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
          id,
          String(event["title"] ?? ""),
          String(event["target"] ?? "generic"),
          String(event["provider"] ?? ""),
          String(event["model"] ?? ""),
          event.at,
          event.at,
        );
        return;

      case "conversation_deleted":
        // A tombstone, not a removal. The events and objects stay: an
        // append-only log has no way to un-write history (WS-R17).
        write.run("UPDATE conversation SET deleted = 1, updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "title_changed":
        write.run("UPDATE conversation SET title = ?, updated_at = ? WHERE id = ?", String(event["title"] ?? ""), event.at, id);
        return;

      case "settings_changed":
        for (const [column, key] of [["target", "target"], ["provider", "provider"], ["model", "model"]] as const) {
          if (typeof event[key] === "string") {
            write.run(`UPDATE conversation SET ${column} = ? WHERE id = ?`, String(event[key]), id);
          }
        }
        write.run("UPDATE conversation SET updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "message_appended":
        write.run(
          `INSERT INTO message (seq, conversation_id, ordinal, role, content_hash, at)
           VALUES (?, ?, (SELECT COUNT(*) FROM message WHERE conversation_id = ? AND ordinal >= 0), ?, ?, ?)`,
          event.seq,
          id,
          id,
          String(event["role"]),
          String(event["contentHash"]),
          String(event["messageAt"] ?? event.at),
        );
        write.run(
          "UPDATE conversation SET message_count = message_count + 1, updated_at = ? WHERE id = ?",
          event.at,
          id,
        );
        return;

      case "messages_truncated": {
        const keep = Number(event["keep"] ?? 0);
        write.run("DELETE FROM message WHERE conversation_id = ? AND ordinal >= ?", id, keep);
        write.run("UPDATE conversation SET message_count = ?, updated_at = ? WHERE id = ?", keep, event.at, id);
        return;
      }

      case "prompt_version_written":
        write.run(
          `INSERT OR REPLACE INTO prompt_version (conversation_id, v, text_hash, source, action, turn_id, at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id,
          Number(event["v"]),
          String(event["textHash"]),
          String(event["source"]),
          typeof event["action"] === "string" ? String(event["action"]) : null,
          typeof event["turnId"] === "string" ? String(event["turnId"]) : null,
          String(event["versionAt"] ?? event.at),
        );
        write.run(
          `UPDATE conversation
              SET version_count = (SELECT COUNT(*) FROM prompt_version WHERE conversation_id = ?),
                  current_v = ?, updated_at = ?
            WHERE id = ?`,
          id,
          Number(event["v"]),
          event.at,
          id,
        );
        return;

      case "current_version_moved":
        write.run("UPDATE conversation SET current_v = ?, updated_at = ? WHERE id = ?", Number(event["v"]), event.at, id);
        return;

      case "candidate_added":
        write.run(
          `INSERT OR REPLACE INTO candidate
             (id, conversation_id, label, text_hash, from_version, strategy, origin, rationale, score, at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          String(event["candidateId"]),
          id,
          String(event["label"]),
          String(event["textHash"]),
          event["fromVersion"] === null || event["fromVersion"] === undefined ? null : Number(event["fromVersion"]),
          typeof event["strategy"] === "string" ? String(event["strategy"]) : null,
          typeof event["origin"] === "string" ? String(event["origin"]) : "archetype",
          typeof event["rationale"] === "string" ? String(event["rationale"]) : null,
          typeof event["score"] === "number" ? Number(event["score"]) : null,
          String(event["candidateAt"] ?? event.at),
        );
        write.run(
          `UPDATE conversation
              SET candidate_count = (SELECT COUNT(*) FROM candidate WHERE conversation_id = ?), updated_at = ?
            WHERE id = ?`,
          id,
          event.at,
          id,
        );
        return;

      case "candidate_promoted":
        write.run(
          `INSERT INTO candidate_promotion (seq, conversation_id, v, promotion, candidate_ids, at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          event.seq,
          id,
          Number(event["v"]),
          String(event["promotion"]),
          JSON.stringify(event["candidateIds"] ?? []),
          String(event["promotedAt"] ?? event.at),
        );
        write.run("UPDATE conversation SET updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "attachment_added":
        write.run(
          `INSERT INTO attachment (seq, conversation_id, name, size, truncated, content_hash, at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          event.seq,
          id,
          String(event["name"]),
          Number(event["size"] ?? 0),
          event["truncated"] ? 1 : 0,
          String(event["contentHash"]),
          String(event["attachmentAt"] ?? event.at),
        );
        write.run("UPDATE conversation SET updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "requirement_pinned":
        write.run(
          `INSERT OR REPLACE INTO pinned_requirement
             (id, conversation_id, text_hash, origin, pinned_from_version, at, unpinned)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          String(event["entryId"]),
          id,
          String(event["textHash"]),
          String(event["origin"] ?? "user_input"),
          event["pinnedFromVersion"] === null || event["pinnedFromVersion"] === undefined
            ? null
            : Number(event["pinnedFromVersion"]),
          String(event["pinnedAt"] ?? event.at),
        );
        write.run("UPDATE conversation SET updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "requirement_unpinned":
        // Marked, not deleted: the index mirrors a log that cannot forget.
        write.run("UPDATE pinned_requirement SET unpinned = 1 WHERE id = ?", String(event["entryId"]));
        write.run("UPDATE conversation SET updated_at = ? WHERE id = ?", event.at, id);
        return;

      case "version_ir_extracted":
        write.run(
          `INSERT OR REPLACE INTO version_ir
             (conversation_id, v, ir_hash, boundary_id, boundary_version, at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          Number(event["v"]),
          String(event["irHash"]),
          String(event["boundaryId"] ?? ""),
          String(event["boundaryVersion"] ?? ""),
          String(event["extractedAt"] ?? event.at),
        );
        return;

      case "model_call": {
        const record = event["record"] as Record<string, unknown> | undefined;
        if (!record) return;
        write.run(
          `INSERT INTO model_call (seq, conversation_id, boundary_id, provider, model, latency_ms, at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          event.seq,
          id,
          String(record["boundaryId"] ?? ""),
          String(record["provider"] ?? ""),
          String(record["model"] ?? ""),
          Number(record["latencyMs"] ?? 0),
          String(record["timestamp"] ?? event.at),
        );
        return;
      }

      case "turn_event": {
        const turn = event["event"] as Record<string, unknown> | undefined;
        if (!turn) return;
        write.run(
          `INSERT INTO turn_event (seq, conversation_id, turn_id, event_seq, kind, at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          event.seq,
          id,
          String(turn["turnId"] ?? ""),
          Number(turn["seq"] ?? 0),
          String(turn["kind"] ?? ""),
          String(turn["at"] ?? event.at),
        );
        return;
      }

      default:
        return;
    }
  },
};

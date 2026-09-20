/**
 * Migration from the pre-V2-C flat conversation files (V2-C exit gate).
 *
 * Before this phase, truth was one JSON file per conversation under
 * `<root>/conversations/`. It is now objects plus an append-only log. A user
 * upgrading FORGE must not lose a single prompt version to that change —
 * WS-R7's "versions are never deleted" applies to a migration as much as to
 * a turn, so this reads what is there and replays it as events.
 *
 * Three properties matter:
 *
 *  - **Idempotent.** A conversation already in the log is skipped, so running
 *    twice (or on a partially migrated store) adds nothing.
 *  - **Non-destructive.** The old files are left exactly where they are. If
 *    this migration is wrong, the original is still on disk to re-read.
 *  - **Order-preserving.** Events are emitted in the order the record implies
 *    — creation, then messages, versions, candidates, attachments, the turn
 *    log and the model-call log — so the fold reproduces the same state.
 *
 * A corrupt file is skipped with a warning rather than failing the store:
 * one unreadable conversation must not make the other twenty unreachable.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Store } from "./repository";
import type { ConversationEventBody } from "./events";
import type { Conversation } from "../store-types";

export interface MigrationReport {
  readonly migrated: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly file: string; readonly reason: string }[];
}

/** Ids already present in the log — migrated or created natively. */
function knownIds(store: Store): Set<string> {
  const ids = new Set<string>();
  for (const event of store.log.readAll()) {
    if (typeof event["id"] === "string") ids.add(event["id"]);
  }
  return ids;
}

export function migrateFlatFiles(store: Store): MigrationReport {
  const dir = join(store.root, "conversations");
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { migrated: [], skipped: [], failed: [] };
  }
  if (files.length === 0) return { migrated: [], skipped: [], failed: [] };

  const known = knownIds(store);
  const migrated: string[] = [];
  const skipped: string[] = [];
  const failed: { file: string; reason: string }[] = [];

  for (const file of files) {
    let flat: Conversation;
    try {
      flat = JSON.parse(readFileSync(join(dir, file), "utf8")) as Conversation;
    } catch (error) {
      failed.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (typeof flat?.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(flat.id)) {
      failed.push({ file, reason: "no usable conversation id" });
      continue;
    }
    if (known.has(flat.id)) {
      skipped.push(flat.id);
      continue;
    }

    const emit = (body: ConversationEventBody): void => {
      store.log.append(body as unknown as Record<string, unknown>);
    };
    const at = (value: unknown): string =>
      typeof value === "string" && value.length > 0 ? value : (flat.createdAt ?? new Date().toISOString());

    emit({
      kind: "conversation_created",
      id: flat.id,
      title: typeof flat.title === "string" ? flat.title : "New conversation",
      target: typeof flat.target === "string" ? flat.target : "generic",
      provider: typeof flat.provider === "string" ? flat.provider : "",
      model: typeof flat.model === "string" ? flat.model : "",
    });

    for (const message of Array.isArray(flat.messages) ? flat.messages : []) {
      emit({
        kind: "message_appended",
        id: flat.id,
        role: message.role === "assistant" ? "assistant" : "user",
        contentHash: store.objects.put(String(message.content ?? "")),
        messageAt: at(message.at),
      });
    }

    for (const version of Array.isArray(flat.promptVersions) ? flat.promptVersions : []) {
      emit({
        kind: "prompt_version_written",
        id: flat.id,
        v: Number(version.v),
        textHash: store.objects.put(String(version.text ?? "")),
        source: version.source ?? "import",
        ...(version.action ? { action: version.action } : {}),
        ...(version.turnId ? { turnId: version.turnId } : {}),
        versionAt: at(version.at),
      });
    }

    for (const candidate of Array.isArray(flat.candidates) ? flat.candidates : []) {
      emit({
        kind: "candidate_added",
        id: flat.id,
        candidateId: String(candidate.id),
        label: String(candidate.label ?? "candidate"),
        textHash: store.objects.put(String(candidate.text ?? "")),
        fromVersion: candidate.fromVersion ?? null,
        ...(candidate.strategy ? { strategy: candidate.strategy } : {}),
        // A pre-V2-E record predates the origin field; ST-R7's only v0.1
        // value is the honest reading of where it came from.
        origin: "archetype",
        candidateAt: at(candidate.at),
      });
    }

    for (const attachment of Array.isArray(flat.attachments) ? flat.attachments : []) {
      // WS-R18: the payload leaves the record and becomes an object.
      const content = flat.attachmentContents?.[attachment.name] ?? "";
      emit({
        kind: "attachment_added",
        id: flat.id,
        name: String(attachment.name),
        size: Number(attachment.size ?? content.length),
        truncated: Boolean(attachment.truncated),
        contentHash: store.objects.put(content),
        attachmentAt: at(attachment.at),
      });
    }

    for (const event of Array.isArray(flat.turnEvents) ? flat.turnEvents : []) {
      emit({ kind: "turn_event", id: flat.id, event });
    }
    for (const record of Array.isArray(flat.modelCalls) ? flat.modelCalls : []) {
      emit({ kind: "model_call", id: flat.id, record });
    }

    if (flat.pendingClarification) {
      const pending = flat.pendingClarification;
      emit({
        kind: "clarification_set",
        id: flat.id,
        clarificationId: String(pending.id),
        question: String(pending.question),
        options: Array.isArray(pending.options) ? [...pending.options] : [],
        askedInTurn: String(pending.askedInTurn ?? ""),
        clarificationAt: at(pending.at),
      });
    }

    // The pointer last, so a RESTORE that left `currentV` behind the newest
    // version survives the move instead of being silently advanced.
    const versions = Array.isArray(flat.promptVersions) ? flat.promptVersions : [];
    const newest = versions.length > 0 ? Math.max(...versions.map((v) => Number(v.v))) : 0;
    if (typeof flat.currentV === "number" && flat.currentV !== newest) {
      emit({ kind: "current_version_moved", id: flat.id, v: flat.currentV });
    }

    migrated.push(flat.id);
  }

  if (failed.length > 0) {
    console.warn(
      `[forge] ${failed.length} conversation file(s) could not be migrated and were left in place: ${failed
        .map((f) => f.file)
        .join(", ")}`,
    );
  }
  return { migrated, skipped, failed };
}

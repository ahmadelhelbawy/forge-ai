/**
 * The append-only run log (PS-R1, PS-R3, WS-R17, AD-17).
 *
 * One JSON object per line, one file per day, and no operation that rewrites
 * a line that exists. This is the log AD-17 makes the checkpointer: it gives
 * resume, cancel, replay and the audit trail from one mechanism, and it is
 * what an index is rebuilt from when the index is deleted.
 *
 * The store owns `seq` and `at`. A caller that could supply either could
 * backdate or renumber history, and then "append-only" would be a convention
 * rather than a property. A supplied `seq` is overwritten, not honoured.
 *
 * A partially written final line is expected, not exceptional: a process
 * killed mid-append leaves one. Reading stops at the last line that parses,
 * and the next append takes the number after it — so a crash costs the event
 * that was in flight and nothing before it.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Json } from "../ir/canonical.js";

/** What a caller appends: any JSON object. `seq` and `at` are not theirs. */
export type RunEventInput = Record<string, unknown>;

export interface RunEvent {
  /** 1-based and global across the whole log. Gaps mean a crash. */
  readonly seq: number;
  /** Run data (§6.3): never hashed, never part of a semantic comparison. */
  readonly at: string;
  readonly [key: string]: Json | undefined;
}

export interface RunLog {
  readonly root: string;
  append(event: RunEventInput): RunEvent;
  /** Every event ever written, in the order written, across all day files. */
  readAll(): readonly RunEvent[];
  /** The day files present, sorted — `YYYY-MM-DD.jsonl`. */
  days(): readonly string[];
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function dayFileFor(at: string): string {
  return `${at.slice(0, 10)}.jsonl`;
}

export function openRunLog(root: string): RunLog {
  const dir = join(root, "runs");
  mkdirSync(dir, { recursive: true });

  const days = (): string[] => {
    try {
      return readdirSync(dir).filter((name) => DAY_FILE.test(name)).sort();
    } catch {
      return [];
    }
  };

  const readAll = (): RunEvent[] => {
    const events: RunEvent[] = [];
    for (const day of days()) {
      let text: string;
      try {
        text = readFileSync(join(dir, day), "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (line.trim().length === 0) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          // A half-written line. Everything after it in this file is
          // unreachable anyway, because a line is written whole or not at all.
          break;
        }
        if (typeof parsed === "object" && parsed !== null && typeof (parsed as RunEvent).seq === "number") {
          events.push(Object.freeze(parsed as RunEvent));
        }
      }
    }
    // Read order IS the order: day files sorted, lines in the order written.
    // Re-sorting by `seq` would be redundant in a healthy log and actively
    // wrong in a damaged one, where two lines can carry the same number.
    return events;
  };

  return {
    root,
    days,
    readAll,

    append(event) {
      const at = new Date().toISOString();
      // The highest number ever written, not the last one read: a log with a
      // duplicate from a crashed write must still never reuse a number.
      let last = 0;
      for (const existing of readAll()) if (existing.seq > last) last = existing.seq;
      // `seq` and `at` are assigned last so a caller's values cannot win.
      const line: RunEvent = Object.freeze({ ...event, seq: last + 1, at } as RunEvent);
      appendFileSync(join(dir, dayFileFor(at)), `${JSON.stringify(line)}\n`, "utf8");
      return line;
    },
  };
}

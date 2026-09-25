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
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync } from "node:fs";
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

  /**
   * What has been read of each day file. The log is append-only, so a file
   * only ever grows: a read resumes at the end of the last whole line instead
   * of re-parsing the file. Before this, every load AND every append re-read
   * and re-parsed the entire log — quadratic in the life of a data directory,
   * measured at ~0.5 s per request midway through the HTTP suite.
   *
   * The half-written-line rule is kept exactly: a line that does not parse
   * ends that file for good (`stopped`), because a line is written whole or
   * not at all. A file that shrank — which an append-only log never does — is
   * simply read again from the start.
   */
  interface FileState {
    offset: number;
    size: number;
    stopped: boolean;
    events: RunEvent[];
  }
  const files = new Map<string, FileState>();
  let cached: RunEvent[] | null = null;
  let maxSeq = 0;

  const refresh = (): boolean => {
    let changed = false;
    for (const day of days()) {
      let fd: number;
      try {
        fd = openSync(join(dir, day), "r");
      } catch {
        continue;
      }
      try {
        const size = fstatSync(fd).size;
        let state = files.get(day);
        if (state === undefined || size < state.size) {
          state = { offset: 0, size: 0, stopped: false, events: [] };
          files.set(day, state);
          changed = true;
        }
        if (size === state.size) continue;
        state.size = size;
        if (state.stopped || size <= state.offset) continue;
        const buffer = Buffer.alloc(size - state.offset);
        readSync(fd, buffer, 0, buffer.length, state.offset);
        // Only whole lines: an unterminated tail is left for the next read.
        const end = buffer.lastIndexOf(0x0a);
        if (end === -1) continue;
        const chunk = buffer.subarray(0, end).toString("utf8");
        state.offset += end + 1;
        for (const line of chunk.split("\n")) {
          if (line.trim().length === 0) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            // A half-written line. Everything after it in this file is
            // unreachable anyway, because a line is written whole or not at all.
            state.stopped = true;
            break;
          }
          if (typeof parsed === "object" && parsed !== null && typeof (parsed as RunEvent).seq === "number") {
            const event = Object.freeze(parsed as RunEvent);
            state.events.push(event);
            if (event.seq > maxSeq) maxSeq = event.seq;
          }
        }
        changed = true;
      } finally {
        closeSync(fd);
      }
    }
    return changed;
  };

  const readAll = (): RunEvent[] => {
    if (refresh() || cached === null) {
      // Read order IS the order: day files sorted, lines in the order written.
      // Re-sorting by `seq` would be redundant in a healthy log and actively
      // wrong in a damaged one, where two lines can carry the same number.
      cached = days().flatMap((day) => files.get(day)?.events ?? []);
      // A file that was reset may have held the highest number; recompute.
      maxSeq = cached.reduce((max, e) => (e.seq > max ? e.seq : max), 0);
    }
    return [...cached];
  };

  return {
    root,
    days,
    readAll,

    append(event) {
      const at = new Date().toISOString();
      // The highest number ever written, not the last one read: a log with a
      // duplicate from a crashed write must still never reuse a number.
      readAll();
      const last = maxSeq;
      // `seq` and `at` are assigned last so a caller's values cannot win.
      const line: RunEvent = Object.freeze({ ...event, seq: last + 1, at } as RunEvent);
      appendFileSync(join(dir, dayFileFor(at)), `${JSON.stringify(line)}\n`, "utf8");
      return line;
    },
  };
}

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
 * killed mid-append leaves one. The next append starts on a fresh line, so the
 * torn fragment stays a line of its own; reading skips a line that does not
 * parse and REPORTS it (`damaged`, INV-012) — a crash costs the event that was
 * in flight and nothing before or after it.
 *
 * (Before the 2026-09-29 audit, the next append was glued onto the fragment
 * and the reader treated the first unparsable line as the end of the file:
 * every later event that day — new conversations included — vanished, with
 * no report.)
 */
import { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readSync, readdirSync, statSync } from "node:fs";
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
  /** Lines that could not be read (a torn or corrupted write), for reporting. */
  damaged(): readonly DamagedLine[];
}

export interface DamagedLine {
  readonly day: string;
  /** Byte offset of the line in its day file. */
  readonly offset: number;
  readonly length: number;
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function dayFileFor(at: string): string {
  return `${at.slice(0, 10)}.jsonl`;
}

/** True when a file exists and its last byte is not a newline (a torn write). */
function endsTorn(path: string): boolean {
  let size: number;
  try {
    size = statSync(path).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (size === 0) return false;
  const fd = openSync(path, "r");
  try {
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function openRunLog(root: string): RunLog {
  const dir = join(root, "runs");
  mkdirSync(dir, { recursive: true });

  // The directory was created above: a failure to list it is a real fault
  // (permissions, I/O), never "no runs" — that reading would hide history.
  const days = (): string[] => readdirSync(dir).filter((name) => DAY_FILE.test(name)).sort();

  /**
   * What has been read of each day file. The log is append-only, so a file
   * only ever grows: a read resumes at the end of the last whole line instead
   * of re-parsing the file. Before this, every load AND every append re-read
   * and re-parsed the entire log — quadratic in the life of a data directory,
   * measured at ~0.5 s per request midway through the HTTP suite.
   *
   * A line that does not parse is skipped and recorded in `damaged`. A file
   * that shrank — which an append-only log never does — is simply read again
   * from the start.
   */
  interface FileState {
    offset: number;
    size: number;
    events: RunEvent[];
    damaged: DamagedLine[];
  }
  const files = new Map<string, FileState>();
  let cached: RunEvent[] | null = null;
  let maxSeq = 0;

  const refresh = (): boolean => {
    let changed = false;
    for (const day of days()) {
      const fd = openSync(join(dir, day), "r");
      try {
        const size = fstatSync(fd).size;
        let state = files.get(day);
        if (state === undefined || size < state.size) {
          state = { offset: 0, size: 0, events: [], damaged: [] };
          files.set(day, state);
          changed = true;
        }
        if (size === state.size) continue;
        state.size = size;
        if (size <= state.offset) continue;
        const buffer = Buffer.alloc(size - state.offset);
        readSync(fd, buffer, 0, buffer.length, state.offset);
        // Only whole lines: an unterminated tail is left for the next read.
        const end = buffer.lastIndexOf(0x0a);
        if (end === -1) continue;
        let lineStart = 0;
        while (lineStart <= end) {
          const lineEnd = buffer.indexOf(0x0a, lineStart);
          const raw = buffer.subarray(lineStart, lineEnd);
          const at = state.offset + lineStart;
          lineStart = lineEnd + 1;
          const line = raw.toString("utf8");
          if (line.trim().length === 0) continue;
          let parsed: unknown;
          try {
            parsed = JSON.parse(line);
          } catch {
            state.damaged.push({ day, offset: at, length: raw.length });
            continue;
          }
          if (typeof parsed === "object" && parsed !== null && typeof (parsed as RunEvent).seq === "number") {
            const event = Object.freeze(parsed as RunEvent);
            state.events.push(event);
            if (event.seq > maxSeq) maxSeq = event.seq;
          } else {
            state.damaged.push({ day, offset: at, length: raw.length });
          }
        }
        state.offset += end + 1;
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
    damaged: () => {
      refresh();
      return days().flatMap((day) => files.get(day)?.damaged ?? []);
    },

    append(event) {
      const at = new Date().toISOString();
      // The highest number ever written, not the last one read: a log with a
      // duplicate from a crashed write must still never reuse a number.
      readAll();
      const last = maxSeq;
      // `seq` and `at` are assigned last so a caller's values cannot win.
      const line: RunEvent = Object.freeze({ ...event, seq: last + 1, at } as RunEvent);
      const path = join(dir, dayFileFor(at));
      appendFileSync(path, `${endsTorn(path) ? "\n" : ""}${JSON.stringify(line)}\n`, "utf8");
      return line;
    },
  };
}

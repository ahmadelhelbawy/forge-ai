/**
 * The append-only run log (PS-R1, PS-R3, WS-R17).
 *
 * The other half of truth, and the thing an index is rebuilt from. What is
 * under test is that the log preserves order across days and process
 * restarts, assigns its own sequence numbers, and offers no way to rewrite
 * history.
 */
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openRunLog } from "../../src/store/runlog.js";

function root(): string {
  return mkdtempSync(join(tmpdir(), "forge-runlog-"));
}

describe("the run log is append-only and ordered (WS-R17)", () => {
  it("assigns its own monotonic sequence, so a caller cannot renumber history", () => {
    const log = openRunLog(root());
    const first = log.append({ kind: "a" });
    const second = log.append({ kind: "b" });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(log.readAll().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("ignores a caller-supplied seq rather than trusting it", () => {
    const log = openRunLog(root());
    const event = log.append({ kind: "a", seq: 999 } as never);
    expect(event.seq).toBe(1);
  });

  it("continues the sequence after a restart", () => {
    const dir = root();
    openRunLog(dir).append({ kind: "a" });
    openRunLog(dir).append({ kind: "b" });
    const reopened = openRunLog(dir);
    expect(reopened.append({ kind: "c" }).seq).toBe(3);
    expect(reopened.readAll().map((e) => e.kind)).toEqual(["a", "b", "c"]);
  });

  it("writes one JSON line per event under runs/<date>.jsonl (PS-R1)", () => {
    const dir = root();
    const log = openRunLog(dir);
    log.append({ kind: "a" });
    log.append({ kind: "b" });
    const files = readdirSync(join(dir, "runs"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/);
    const lines = readFileSync(join(dir, "runs", files[0]!), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ seq: 1, kind: "a" });
  });

  it("reads events across several day files in sequence order", () => {
    const dir = root();
    const runs = join(dir, "runs");
    openRunLog(dir).append({ kind: "today" });
    // Two earlier days, written directly — the shape a real store accumulates.
    writeFileSync(join(runs, "2026-01-01.jsonl"), `${JSON.stringify({ seq: 1, at: "2026-01-01T00:00:00.000Z", kind: "oldest" })}\n`, "utf8");
    writeFileSync(join(runs, "2026-02-01.jsonl"), `${JSON.stringify({ seq: 2, at: "2026-02-01T00:00:00.000Z", kind: "middle" })}\n`, "utf8");
    expect(openRunLog(dir).readAll().map((e) => e.kind)).toEqual(["oldest", "middle", "today"]);
  });

  it("numbers a new event after every event already on disk, across days", () => {
    const dir = root();
    const runs = join(dir, "runs");
    openRunLog(dir); // creates runs/
    writeFileSync(join(runs, "2026-01-01.jsonl"), `${JSON.stringify({ seq: 1, at: "x", kind: "a" })}\n${JSON.stringify({ seq: 2, at: "x", kind: "b" })}\n`, "utf8");
    expect(openRunLog(dir).append({ kind: "c" }).seq).toBe(3);
  });

  it("stamps each event with a time, which is run data and never hashed", () => {
    const log = openRunLog(root());
    const event = log.append({ kind: "a" });
    expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("survives a truncated final line, which is what a killed process leaves", () => {
    const dir = root();
    const log = openRunLog(dir);
    log.append({ kind: "a" });
    const file = join(dir, "runs", readdirSync(join(dir, "runs"))[0]!);
    writeFileSync(file, `${readFileSync(file, "utf8")}{"seq":2,"kind":"hal`, "utf8");
    const reopened = openRunLog(dir);
    expect(reopened.readAll().map((e) => e.kind)).toEqual(["a"]);
    // And the next append lands after the last event it could actually read.
    expect(reopened.append({ kind: "b" }).seq).toBe(2);
  });

  it("returns an empty log for a store that has never been written", () => {
    expect(openRunLog(root()).readAll()).toEqual([]);
  });

  it("gives a frozen event back, so a caller cannot edit what was logged", () => {
    const log = openRunLog(root());
    const event = log.append({ kind: "a" });
    expect(Object.isFrozen(event)).toBe(true);
  });
});

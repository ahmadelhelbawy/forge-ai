/**
 * The derivable index (AD-20, PS-R3, WS-R17, AC-032).
 *
 * The whole point of this file is one property: the index is a **function of**
 * the log. Delete it, rebuild it, and you get the same bytes. If that ever
 * stops holding, SQLite has quietly become a second source of truth, which
 * AD-20 forbids and this phase's exit gate tests for.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { openIndex, type IndexProjector } from "../../src/store/index-store.js";
import { openRunLog } from "../../src/store/runlog.js";

/** A stand-in domain: the core owns the mechanism, a caller owns the shape. */
const projector: IndexProjector = {
  schema: {
    version: 1,
    tables: [
      "CREATE TABLE thing (id TEXT PRIMARY KEY, label TEXT NOT NULL, n INTEGER NOT NULL)",
      "CREATE TABLE note (seq INTEGER PRIMARY KEY, thing TEXT NOT NULL, body TEXT NOT NULL)",
      "CREATE INDEX note_by_thing ON note (thing)",
    ],
  },
  apply(event, write) {
    if (event["kind"] === "thing_added") {
      write.run("INSERT OR REPLACE INTO thing (id, label, n) VALUES (?, ?, ?)", String(event["id"]), String(event["label"]), 0);
    } else if (event["kind"] === "note_added") {
      write.run("INSERT INTO note (seq, thing, body) VALUES (?, ?, ?)", event.seq, String(event["thing"]), String(event["body"]));
      write.run("UPDATE thing SET n = n + 1 WHERE id = ?", String(event["thing"]));
    } else if (event["kind"] === "thing_removed") {
      write.run("DELETE FROM note WHERE thing = ?", String(event["id"]));
      write.run("DELETE FROM thing WHERE id = ?", String(event["id"]));
    }
  },
};

function seeded(): { root: string; indexPath: string } {
  const root = mkdtempSync(join(tmpdir(), "forge-index-"));
  const log = openRunLog(root);
  log.append({ kind: "thing_added", id: "a", label: "Alpha" });
  log.append({ kind: "note_added", thing: "a", body: "first" });
  log.append({ kind: "thing_added", id: "b", label: "Beta" });
  log.append({ kind: "note_added", thing: "b", body: "second" });
  log.append({ kind: "note_added", thing: "a", body: "third" });
  log.append({ kind: "thing_added", id: "c", label: "Gamma" });
  log.append({ kind: "thing_removed", id: "c" });
  return { root, indexPath: join(root, "index.sqlite") };
}

const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("the index is derived from the log (WS-R17)", () => {
  it("answers queries about state folded from events", () => {
    const { root } = seeded();
    const index = openIndex(root, projector);
    expect(index.query<{ id: string; label: string; n: number }>("SELECT id, label, n FROM thing ORDER BY id")).toEqual([
      { id: "a", label: "Alpha", n: 2 },
      { id: "b", label: "Beta", n: 1 },
    ]);
    index.close();
  });

  it("builds itself on first open, because it is not a thing to be created by hand", () => {
    const { root, indexPath } = seeded();
    expect(existsSync(indexPath)).toBe(false);
    openIndex(root, projector).close();
    expect(existsSync(indexPath)).toBe(true);
  });

  it("AC-032: deleting the index and rebuilding reproduces it byte for byte", () => {
    const { root, indexPath } = seeded();
    openIndex(root, projector).close();
    const before = digest(indexPath);

    rmSync(indexPath);
    expect(existsSync(indexPath)).toBe(false);
    openIndex(root, projector).close();

    expect(digest(indexPath)).toBe(before);
  });

  it("AC-032 holds after further events, and after repeated rebuilds", () => {
    const { root, indexPath } = seeded();
    openIndex(root, projector).close();
    openRunLog(root).append({ kind: "note_added", thing: "b", body: "fourth" });

    const digests = new Set<string>();
    for (let i = 0; i < 3; i++) {
      rmSync(indexPath, { force: true });
      openIndex(root, projector).close();
      digests.add(digest(indexPath));
    }
    expect(digests.size).toBe(1);
  });

  it("two stores with the same log produce the same index bytes", () => {
    const first = seeded();
    const second = seeded();
    openIndex(first.root, projector).close();
    openIndex(second.root, projector).close();
    expect(digest(second.indexPath)).toBe(digest(first.indexPath));
  });

  it("rebuilds rather than trusting an index built for an older schema", () => {
    const { root, indexPath } = seeded();
    openIndex(root, projector).close();
    const v1 = digest(indexPath);

    const v2: IndexProjector = {
      schema: { version: 2, tables: [...projector.schema.tables, "CREATE TABLE extra (x TEXT)"] },
      apply: projector.apply,
    };
    const index = openIndex(root, v2);
    expect(index.query("SELECT name FROM sqlite_master WHERE name = 'extra'")).toHaveLength(1);
    index.close();
    expect(digest(indexPath)).not.toBe(v1);
  });

  it("rebuilds an index that is corrupt rather than failing to open", () => {
    const { root, indexPath } = seeded();
    openIndex(root, projector).close();
    const good = digest(indexPath);
    rmSync(indexPath);
    writeFileSync(indexPath, "this is not a database", "utf8");
    const index = openIndex(root, projector);
    expect(index.query("SELECT id FROM thing ORDER BY id")).toHaveLength(2);
    index.close();
    expect(digest(indexPath)).toBe(good);
  });

  it("reflects events appended since the index was last opened", () => {
    const { root } = seeded();
    openIndex(root, projector).close();
    openRunLog(root).append({ kind: "thing_added", id: "d", label: "Delta" });
    const index = openIndex(root, projector);
    expect(index.query<{ id: string }>("SELECT id FROM thing ORDER BY id").map((r) => r.id)).toEqual(["a", "b", "d"]);
    index.close();
  });

  it("an index opened after new events matches one rebuilt from scratch", () => {
    const { root, indexPath } = seeded();
    openIndex(root, projector).close();
    openRunLog(root).append({ kind: "thing_added", id: "d", label: "Delta" });
    openIndex(root, projector).close();
    const incremental = digest(indexPath);
    rmSync(indexPath);
    openIndex(root, projector).close();
    expect(digest(indexPath)).toBe(incremental);
  });

  it("is empty, not absent, for a store with no events", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-index-"));
    const index = openIndex(root, projector);
    expect(index.query("SELECT id FROM thing")).toEqual([]);
    index.close();
  });

  it("refuses a write outside a projection, so nothing can edit the index directly", () => {
    const { root } = seeded();
    const index = openIndex(root, projector);
    expect(() => index.query("DELETE FROM thing")).toThrow(/read-only|readonly/i);
    index.close();
  });
});

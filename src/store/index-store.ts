/**
 * The derivable index (AD-20, PS-R3, WS-R17, AC-032).
 *
 * SQLite here is an **optimization over the log, never a second source of
 * truth**. The property that keeps it honest is mechanical: delete the file,
 * open it again, and the same bytes come back, because the index is a pure
 * fold of the run log through a caller-supplied projector.
 *
 * **The index is always built in full, never updated in place.** That is a
 * deliberate choice and it is what makes AC-032 true by construction rather
 * than by luck. An incrementally updated SQLite file and a linearly rebuilt
 * one hold the same rows but not the same bytes — page layout, freelist and
 * the header's change counter all differ, and VACUUM does not converge them.
 * With an incremental path, "delete it and rebuild it reproduces it exactly"
 * would hold only rebuild-to-rebuild, while the file the product actually
 * deletes would be an incremental one. The criterion would pass for the wrong
 * reason. Rebuilding is cheap — the log is local and read anyway — and it also
 * removes the entire class of bug where a watermark and the rows disagree.
 *
 * Two further decisions keep the bytes reproducible:
 *
 *  - **No clock, no randomness, no environment.** A projector sees only the
 *    event. `apply` reading a timestamp of its own would make every rebuild
 *    differ and quietly retire the exit gate.
 *  - **Deterministic file layout.** Journal mode is `DELETE` (no `-wal`
 *    sidecar holding un-checkpointed state) and page size and encoding are
 *    pinned before any table exists.
 *
 * `node:sqlite` sits behind this interface because AD-20 requires it to:
 * the module is flagged experimental, so replacing it must be a file rather
 * than a migration.
 */
import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { openRunLog, type RunEvent, type RunLog } from "./runlog.js";

/** The one table this module owns. A projector may not name it. */
const META = "forge_index_meta";

export interface IndexSchema {
  /** Bump when `tables` or `apply` changes meaning. */
  readonly version: number;
  /** DDL run in order on a fresh index. */
  readonly tables: readonly string[];
}

export interface IndexWriter {
  run(sql: string, ...params: SQLInputValue[]): void;
}

export interface IndexProjector {
  readonly schema: IndexSchema;
  /**
   * Fold one event into the index.
   *
   * Must be deterministic: the same event yields the same rows, forever. No
   * clock, no randomness, no reads outside the index — anything else breaks
   * PS-R3 and the exit gate that tests it.
   */
  apply(event: RunEvent, write: IndexWriter): void;
}

export interface StoreIndex {
  /** Read-only. A statement that would write is refused. */
  query<T = Record<string, unknown>>(sql: string, ...params: SQLInputValue[]): T[];
  /** The last log sequence folded in. */
  readonly appliedThrough: number;
  close(): void;
}

const WRITE_STATEMENT = /^\s*(insert|update|delete|drop|alter|create|replace|vacuum|pragma|attach|begin|commit)\b/i;

function build(path: string, projector: IndexProjector, events: readonly RunEvent[]): number {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });

  const db = new DatabaseSync(path);
  try {
    // Pinned before any table exists, so the header is fixed for the file's life.
    db.exec("PRAGMA journal_mode = DELETE");
    db.exec("PRAGMA page_size = 4096");
    db.exec("PRAGMA encoding = 'UTF-8'");
    db.exec("PRAGMA auto_vacuum = NONE");

    db.exec(`CREATE TABLE ${META} (key TEXT PRIMARY KEY, value INTEGER NOT NULL)`);
    for (const ddl of projector.schema.tables) {
      if (ddl.includes(META)) {
        throw new Error(`An index projector may not define ${META}: the store owns it.`);
      }
      db.exec(ddl);
    }

    const writer: IndexWriter = {
      run(sql, ...params) {
        db.prepare(sql).run(...params);
      },
    };
    let applied = 0;
    for (const event of events) {
      projector.apply(event, writer);
      applied = event.seq;
    }
    db.prepare(`INSERT INTO ${META} (key, value) VALUES ('schema_version', ?)`).run(projector.schema.version);
    db.prepare(`INSERT INTO ${META} (key, value) VALUES ('applied_through', ?)`).run(applied);
    return applied;
  } finally {
    db.close();
  }
}

/**
 * Open the index for a store, rebuilding it from the log.
 *
 * Absent, stale, or corrupt are not distinguished and none is reported,
 * because none of them is a loss: the log still holds everything (PS-R3).
 * The rebuild is written to a temp path and renamed in, so a reader never
 * observes a half-built index and a failed build leaves the old one intact.
 */
export function openIndex(root: string, projector: IndexProjector, log: RunLog = openRunLog(root)): StoreIndex {
  const path = join(root, "index.sqlite");
  const staging = `${path}.building`;
  const applied = build(staging, projector, log.readAll());
  renameSync(staging, path);

  const handle = new DatabaseSync(path);
  return {
    appliedThrough: applied,
    query(sql, ...params) {
      if (WRITE_STATEMENT.test(sql)) {
        throw new Error("The index is read-only: state changes belong in the run log, not here.");
      }
      return handle.prepare(sql).all(...params) as never[];
    },
    close() {
      handle.close();
    },
  };
}

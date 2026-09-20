/**
 * The content-addressed object store (PS-R1, PS-R2, WS-R17).
 *
 * Half of what "truth" means in this system: immutable objects named by the
 * hash of their content, plus the append-only run log next door. An index may
 * be derived from both and deleted at will (PS-R3); neither of these two may.
 *
 * Two properties carry the weight:
 *
 *  - **A name is a claim about content, and the claim is checked.** `get`
 *    rehashes what it read and refuses a mismatch. A store that silently
 *    returned tampered or truncated content would be a source of truth that
 *    can drift, which is exactly what PS-R2 forbids.
 *  - **Writing is idempotent and never destructive.** Putting content that
 *    already exists is a no-op, so nothing in this API can change what a hash
 *    means. There is deliberately no `delete` and no `set`.
 *
 * Canonicalization comes from `src/ir/canonical.ts`, so an object and an IR
 * are hashed by the same rule and key order cannot change identity.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalStringify, contentHash, isHash, rawHash, type Json } from "../ir/canonical.js";

export interface ObjectStore {
  /** The store root (the directory that contains `objects/`). */
  readonly root: string;
  /** Write content if absent; return the hash that names it. */
  put(value: unknown): string;
  /** Read content by hash, or null when this store does not hold it. */
  get(hash: string): Json | null;
  has(hash: string): boolean;
  /** Every hash held, sorted — so two equal stores list identically. */
  list(): string[];
}

function assertHash(hash: string): void {
  if (!isHash(hash)) {
    throw new Error(`Not an object hash: ${JSON.stringify(hash)}. Expected "sha256:" and 64 hex digits.`);
  }
}

export function openObjectStore(root: string): ObjectStore {
  const dir = join(root, "objects");

  const pathFor = (hash: string): string => {
    assertHash(hash);
    // The hash is validated above, so the filename cannot traverse.
    return join(dir, `${hash.slice("sha256:".length)}.json`);
  };

  return {
    root,

    put(value) {
      const text = canonicalStringify(value);
      const hash = `sha256:${rawHash(text).slice("sha256:".length)}`;
      const path = pathFor(hash);
      mkdirSync(dir, { recursive: true });
      try {
        readFileSync(path);
        return hash; // Already present. Immutable, so there is nothing to do.
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      // Written through a temp name so a reader never sees a partial object.
      const tmp = `${path}.${hash.slice(7, 15)}.tmp`;
      writeFileSync(tmp, text, "utf8");
      renameSync(tmp, path);
      return hash;
    },

    get(hash) {
      const path = pathFor(hash);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      const actual = rawHash(text);
      if (actual !== hash) {
        throw new Error(
          `Object ${hash} does not match its content (found ${actual}). The store has been modified outside FORGE.`,
        );
      }
      return JSON.parse(text) as Json;
    },

    has(hash) {
      try {
        readFileSync(pathFor(hash));
        return true;
      } catch {
        return false;
      }
    },

    list() {
      let files: string[];
      try {
        files = readdirSync(dir);
      } catch {
        return [];
      }
      return files
        .filter((name) => name.endsWith(".json"))
        .map((name) => `sha256:${name.slice(0, -".json".length)}`)
        .filter(isHash)
        .sort();
    },
  };
}

/** The hash `put` would return for this value, without writing it. */
export function objectHash(value: unknown): string {
  return contentHash(value);
}

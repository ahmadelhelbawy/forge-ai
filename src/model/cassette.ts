/**
 * Cassette record/replay for model boundaries (FR-048, NFR-007).
 *
 * The full suite runs deterministically with no network and no API key
 * (AC-019): a cassette hit replays byte-identical output; a miss in an
 * offline context is a hard failure, never a live call.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

import { sha256Hex } from "./provider.js";

export const CASSETTE_VERSION = 1;

const CassetteFileSchema = z.strictObject({
  version: z.literal(CASSETTE_VERSION),
  key: z.string(),
  boundaryId: z.string(),
  boundaryVersion: z.string(),
  model: z.string(),
  responseText: z.string(),
  recordedAt: z.string(),
});

export type CassetteEntry = z.infer<typeof CassetteFileSchema>;

/**
 * The replay key: content-addressed over boundary identity + fully-rendered
 * prompt (docs/architecture.md §13.3). Any prompt change is a different key,
 * so stale cassettes can never silently match a new template.
 */
export function cassetteKey(boundaryId: string, boundaryVersion: string, renderedPrompt: string): string {
  return sha256Hex(`${boundaryId}\n${boundaryVersion}\n${renderedPrompt}`);
}

const fileNameFor = (key: string): string => {
  const hex = key.startsWith("sha256:") ? key.slice("sha256:".length) : key;
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new CassetteError(`Cassette key is malformed: ${key}`);
  return `${hex}.json`;
};

/** The key has no recording in `dir`. Callers decide: live call or hard fail. */
export class CassetteMissError extends Error {
  constructor(
    readonly key: string,
    readonly dir: string,
  ) {
    super(
      `No cassette for key ${key} in ${dir}, and no live provider is available. ` +
        `Record one with network access (--cassette <dir> with an API key set), ` +
        `or supply the key the cassette was recorded with.`,
    );
    this.name = "CassetteMissError";
  }
}

export class CassetteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CassetteError";
  }
}

/** Null on miss — the caller, not this module, decides what a miss means. */
export function readCassette(dir: string, key: string): CassetteEntry | null {
  let raw: string;
  try {
    raw = readFileSync(join(resolve(dir), fileNameFor(key)), "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
  const parsed = CassetteFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new CassetteError(`Cassette ${fileNameFor(key)} failed validation: ${parsed.error.message}`);
  }
  if (parsed.data.key !== key) {
    throw new CassetteError(
      `Cassette ${fileNameFor(key)} is labelled for key ${parsed.data.key} — refusing to replay it.`,
    );
  }
  return parsed.data;
}

export function writeCassette(dir: string, entry: CassetteEntry): void {
  const parsed = CassetteFileSchema.parse(entry);
  const root = resolve(dir);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, fileNameFor(parsed.key)), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

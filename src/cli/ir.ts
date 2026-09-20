/**
 * Shared CLI input helpers.
 *
 * One reader for user-supplied IR files, one collector for repeatable
 * flags — every command uses these rather than carrying its own copy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { migrateIr } from "../ir/migrate.js";
import { parseTaskIR, type TaskIR } from "../ir/schema.js";

export function readIr(path: string): TaskIR {
  const raw: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
  return parseTaskIR(migrateIr(raw));
}

export function collectFiles(value: string, previous: string[]): string[] {
  return [...previous, value];
}

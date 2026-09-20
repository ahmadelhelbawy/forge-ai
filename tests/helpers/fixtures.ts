/**
 * Fixture loading for tests.
 *
 * Filesystem access here is test-only. INV-011 constrains *context* reads, which flow
 * through WorkspaceGuard from P2; loading a checked-in fixture is not a context read.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..");
export const FIXTURE_DIR = join(REPO_ROOT, "fixtures", "ir");

export const FIXTURE_NAMES = [
  "auth-debug",
  "bloated",
  "empty-state",
  "untrusted-instruction",
  "semi-trusted-instruction",
  "laundered-influence",
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** Raw fixture JSON, exactly as authored on disk. */
export function readFixtureRaw(name: FixtureName): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Fixture parsed through the schema. ALWAYS hash this, never the raw form. */
export function loadFixture(name: FixtureName): TaskIR {
  return parseTaskIR(readFixtureRaw(name));
}

/** Deep clone via JSON, adequate because a TaskIR is by construction plain JSON. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

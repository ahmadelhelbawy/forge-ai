/**
 * IR schema migration (FR-009, NFR-012).
 *
 * Policy:
 *   - An unknown MAJOR version is REFUSED. A silently mis-parsed IR is worse than a
 *     hard failure, because every downstream artifact inherits the corruption.
 *   - A known older MINOR is migrated forward through registered steps, then re-hashed
 *     by the caller (migration changes content, so the old hash is void by design).
 *
 * There are no real migrations yet -- `MIGRATIONS` is empty because only IR 1.0
 * exists. The machinery is built and tested now anyway, because retrofitting migration
 * after fixtures and stored objects exist is far more expensive than carrying an empty
 * registry. `migrateIr` accepts a registry parameter so the mechanism can be tested
 * against a synthetic migration without inventing a fake schema version in production
 * code (plan.md P0).
 */
import {
  IR_VERSION,
  UnsupportedIrVersionError,
  compareIrVersions,
  parseIrVersion,
} from "./version.js";

export interface Migration {
  readonly from: string;
  readonly to: string;
  /** Pure transform. Must not mutate its input. */
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Registered migrations, ordered oldest first. Empty: only IR 1.0 exists. */
export const MIGRATIONS: readonly Migration[] = Object.freeze([]);

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Read `ir_version` from unparsed input, defaulting the way the schema would. */
export function readIrVersion(raw: unknown): string {
  if (typeof raw !== "object" || raw === null) {
    throw new MigrationError("Cannot read ir_version: input is not an object.");
  }
  const value = (raw as Record<string, unknown>)["ir_version"];
  if (value === undefined) return IR_VERSION;
  if (typeof value !== "string") {
    throw new UnsupportedIrVersionError(String(value), "must be a string");
  }
  return value;
}

/**
 * Bring raw IR input up to the target schema version.
 *
 * Returns the input unchanged when it is already at the target. Throws
 * `UnsupportedIrVersionError` for an unknown or future major/minor, and
 * `MigrationError` when the document is older than the target but no registered path
 * reaches it.
 *
 * `registry` and `targetVersion` are injectable so the mechanism can be exercised
 * before any real migration exists. Production callers pass neither: with only IR 1.0
 * released there is no chain to walk, and building the walker now is far cheaper than
 * retrofitting it once fixtures and stored objects are in the wild.
 */
export function migrateIr(
  raw: unknown,
  registry: readonly Migration[] = MIGRATIONS,
  targetVersion: string = IR_VERSION,
): Record<string, unknown> {
  const startVersion = readIrVersion(raw);
  const parsed = parseIrVersion(startVersion);
  const target = parseIrVersion(targetVersion);

  if (parsed.major !== target.major) {
    throw new UnsupportedIrVersionError(
      startVersion,
      `this build reads IR major version ${target.major} only`,
    );
  }

  if (compareIrVersions(startVersion, targetVersion) > 0) {
    throw new UnsupportedIrVersionError(
      startVersion,
      `it is newer than this build's IR version ${targetVersion}`,
    );
  }

  let current = { ...(raw as Record<string, unknown>) };
  let version = startVersion;
  const visited = new Set<string>([version]);

  while (compareIrVersions(version, targetVersion) < 0) {
    const step = registry.find((m) => m.from === version);
    if (!step) {
      throw new MigrationError(
        `No migration registered from IR version ${version} to ${targetVersion}. ` +
          `This IR cannot be read by this build.`,
      );
    }
    current = { ...step.migrate(current), ir_version: step.to };
    version = step.to;
    if (visited.has(version)) {
      throw new MigrationError(
        `Migration cycle detected: version ${version} was reached twice. ` +
          `Check the migration registry.`,
      );
    }
    visited.add(version);
  }

  return current;
}

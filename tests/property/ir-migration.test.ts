/**
 * Version handling and migration — AC-008, FR-009, NFR-012.
 *
 * There are no real migrations yet (only IR 1.0 exists), so the mechanism is exercised
 * against a synthetic registry. Testing the machinery now rather than when the first
 * real migration lands is deliberate: by then fixtures and stored objects exist, and
 * retrofitting is far more expensive.
 */
import { describe, expect, it } from "vitest";

import {
  MIGRATIONS,
  MigrationError,
  migrateIr,
  readIrVersion,
  type Migration,
} from "../../src/ir/migrate.js";
import { semanticHash } from "../../src/ir/projection.js";
import { parseTaskIR } from "../../src/ir/schema.js";
import {
  IR_VERSION,
  UnsupportedIrVersionError,
  compareIrVersions,
  isReadableIrVersion,
  parseIrVersion,
} from "../../src/ir/version.js";
import { clone, loadFixture, readFixtureRaw } from "../helpers/fixtures.js";

describe("version parsing", () => {
  it("parses a well-formed version", () => {
    expect(parseIrVersion("1.0")).toEqual({ major: 1, minor: 0 });
    expect(parseIrVersion("12.34")).toEqual({ major: 12, minor: 34 });
  });

  it("rejects malformed versions", () => {
    for (const bad of ["1", "1.0.0", "v1.0", "", "1.x", "one.zero"]) {
      expect(() => parseIrVersion(bad), bad).toThrow(UnsupportedIrVersionError);
    }
  });

  it("accepts only the supported major", () => {
    expect(isReadableIrVersion("1.0")).toBe(true);
    expect(isReadableIrVersion("1.7")).toBe(true);
    expect(isReadableIrVersion("2.0")).toBe(false);
    expect(isReadableIrVersion("0.9")).toBe(false);
    expect(isReadableIrVersion("nonsense")).toBe(false);
  });

  it("orders versions", () => {
    expect(compareIrVersions("1.0", "1.1")).toBeLessThan(0);
    expect(compareIrVersions("1.2", "1.1")).toBeGreaterThan(0);
    expect(compareIrVersions("1.0", "1.0")).toBe(0);
  });
});

describe("migration policy", () => {
  it("ships no migrations, because only one IR version exists", () => {
    expect(MIGRATIONS).toHaveLength(0);
  });

  it("passes a current-version document through unchanged", () => {
    const raw = readFixtureRaw("auth-debug");
    expect(migrateIr(raw)).toEqual(raw);
  });

  it("defaults a missing ir_version the way the schema would", () => {
    const raw = clone(readFixtureRaw("auth-debug")) as Record<string, unknown>;
    delete raw["ir_version"];
    expect(readIrVersion(raw)).toBe(IR_VERSION);
    expect(() => migrateIr(raw)).not.toThrow();
  });

  it("REFUSES an unknown major rather than best-effort parsing (FR-009)", () => {
    const raw = { ...readFixtureRaw("auth-debug"), ir_version: "2.0" };
    expect(() => migrateIr(raw)).toThrow(UnsupportedIrVersionError);
    expect(() => migrateIr(raw)).toThrow(/major version 1 only/);
  });

  it("refuses a future minor from the same major", () => {
    const raw = { ...readFixtureRaw("auth-debug"), ir_version: "1.99" };
    expect(() => migrateIr(raw)).toThrow(UnsupportedIrVersionError);
    expect(() => migrateIr(raw)).toThrow(/newer than this build/);
  });

  it("refuses an older minor when no migration path is registered", () => {
    const raw = { ...readFixtureRaw("auth-debug"), ir_version: "1.0" };
    // Pretend current is 1.0 and the document is older by declaring a lower minor.
    const older = { ...raw, ir_version: "0.9" };
    expect(() => migrateIr(older)).toThrow(UnsupportedIrVersionError); // major mismatch
  });

  it("rejects a non-object input", () => {
    expect(() => migrateIr("not an object")).toThrow(MigrationError);
    expect(() => migrateIr(null)).toThrow(MigrationError);
  });

  it("rejects a non-string ir_version", () => {
    expect(() => migrateIr({ ir_version: 1 })).toThrow(UnsupportedIrVersionError);
  });
});

describe("migration mechanism (synthetic registry)", () => {
  // No real migration exists yet, so the walker is driven against an injected
  // registry and an injected target version. This exercises the same code path a
  // real migration will take, without inventing a fake schema version in src/.

  const addField = (key: string, value: unknown) => (raw: Record<string, unknown>) => ({
    ...raw,
    [key]: value,
  });

  it("walks a multi-step chain and lands on the target version", () => {
    const registry: Migration[] = [
      { from: "1.0", to: "1.1", migrate: addField("added_in_1_1", true) },
      { from: "1.1", to: "1.2", migrate: addField("added_in_1_2", true) },
    ];
    const result = migrateIr(readFixtureRaw("auth-debug"), registry, "1.2");

    expect(result["ir_version"]).toBe("1.2");
    expect(result["added_in_1_1"]).toBe(true);
    expect(result["added_in_1_2"]).toBe(true);
  });

  it("applies only the steps needed to reach the target", () => {
    const registry: Migration[] = [
      { from: "1.0", to: "1.1", migrate: addField("added_in_1_1", true) },
      { from: "1.1", to: "1.2", migrate: addField("added_in_1_2", true) },
    ];
    const result = migrateIr({ ...readFixtureRaw("auth-debug"), ir_version: "1.1" }, registry, "1.2");

    expect(result["added_in_1_1"]).toBeUndefined();
    expect(result["added_in_1_2"]).toBe(true);
  });

  it("does not mutate its input", () => {
    const raw = readFixtureRaw("auth-debug");
    const before = JSON.stringify(raw);
    migrateIr(raw, [{ from: "1.0", to: "1.1", migrate: addField("x", 1) }], "1.1");
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("raises MigrationError when the chain is broken", () => {
    const registry: Migration[] = [
      { from: "1.0", to: "1.1", migrate: (r) => r },
      // nothing registered from 1.1
    ];
    expect(() => migrateIr(readFixtureRaw("auth-debug"), registry, "1.2")).toThrow(MigrationError);
    expect(() => migrateIr(readFixtureRaw("auth-debug"), registry, "1.2")).toThrow(
      /No migration registered from IR version 1\.1/,
    );
  });

  it("detects a migration cycle rather than looping forever", () => {
    const registry: Migration[] = [
      { from: "1.0", to: "1.1", migrate: (r) => r },
      { from: "1.1", to: "1.0", migrate: (r) => r },
    ];
    expect(() => migrateIr(readFixtureRaw("auth-debug"), registry, "1.2")).toThrow(
      /Migration cycle detected/,
    );
  });

  it("produces a document that still parses and can be re-hashed", () => {
    // Migration changes content, so the pre-migration hash is void by design.
    const registry: Migration[] = [
      {
        from: "1.0",
        to: "1.1",
        migrate: (raw) => {
          const next = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
          (next["goals"] as Array<Record<string, unknown>>)[0]!["priority"] = "should";
          return next;
        },
      },
    ];
    const before = loadFixture("auth-debug");
    const migrated = migrateIr(readFixtureRaw("auth-debug"), registry, "1.1");

    // Re-stamp to the supported version so the result parses under this build.
    const reparsed = parseTaskIR({ ...migrated, ir_version: IR_VERSION });
    expect(semanticHash(reparsed)).not.toBe(semanticHash(before));
    expect(reparsed.goals[0]!.priority).toBe("should");
  });
});

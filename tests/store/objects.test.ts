/**
 * The content-addressed object store (PS-R1, PS-R2, WS-R17).
 *
 * Truth is immutable objects plus an append-only log. This file covers the
 * objects half: a hash names its content, writing the same content twice
 * changes nothing, and nothing in the API can rewrite an object that exists.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { contentHash } from "../../src/ir/canonical.js";
import { openObjectStore } from "../../src/store/objects.js";

function store() {
  return openObjectStore(mkdtempSync(join(tmpdir(), "forge-objects-")));
}

describe("objects are content-addressed (PS-R2)", () => {
  it("names an object by the hash of its canonical content", () => {
    const objects = store();
    const hash = objects.put({ b: 2, a: 1 });
    expect(hash).toBe(contentHash({ a: 1, b: 2 }));
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("gives key order no effect on identity", () => {
    const objects = store();
    expect(objects.put({ a: 1, b: 2 })).toBe(objects.put({ b: 2, a: 1 }));
  });

  it("round-trips every JSON shape a conversation uses", () => {
    const objects = store();
    for (const value of ["plain text", "", 0, 42, true, false, null, [], {}, { nested: [1, { x: "y" }] }]) {
      const hash = objects.put(value);
      expect(objects.get(hash), JSON.stringify(value)).toEqual(value);
    }
  });

  it("round-trips a large text blob byte for byte", () => {
    const objects = store();
    const text = `${"Requirement: validate every input before acting.\n".repeat(5000)}— end`;
    expect(objects.get(objects.put(text))).toBe(text);
  });

  it("writing the same content twice is one object and one write", () => {
    const objects = store();
    const first = objects.put("same");
    const before = objects.list();
    const second = objects.put("same");
    expect(second).toBe(first);
    expect(objects.list()).toEqual(before);
    expect(objects.list()).toHaveLength(1);
  });

  it("reports absence rather than inventing content", () => {
    const objects = store();
    const absent = contentHash("never stored");
    expect(objects.has(absent)).toBe(false);
    expect(objects.get(absent)).toBeNull();
  });

  it("rejects a hash that is not a hash, rather than reading a path", () => {
    const objects = store();
    for (const bad of ["../escape", "sha256:zz", "", "sha256:", "/etc/passwd", "sha256:abc"]) {
      expect(() => objects.get(bad), bad).toThrow(/hash/i);
    }
  });

  it("refuses an object whose content does not match its name (PS-R2)", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-objects-"));
    const objects = openObjectStore(root);
    const hash = objects.put("honest");
    writeFileSync(join(root, "objects", `${hash.slice(7)}.json`), JSON.stringify("tampered"), "utf8");
    expect(() => objects.get(hash)).toThrow(/does not match/i);
  });

  it("stores each object as one canonical JSON file under objects/ (PS-R1)", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-objects-"));
    const objects = openObjectStore(root);
    const hash = objects.put({ b: 2, a: 1 });
    const raw = readFileSync(join(root, "objects", `${hash.slice(7)}.json`), "utf8");
    expect(raw).toBe('{"a":1,"b":2}');
  });

  it("lists hashes in a stable order regardless of insertion order", () => {
    const a = store();
    const b = store();
    for (const value of ["one", "two", "three"]) a.put(value);
    for (const value of ["three", "one", "two"]) b.put(value);
    expect(a.list()).toEqual(b.list());
  });
});

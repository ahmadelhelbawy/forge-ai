/**
 * Hashing properties — AC-005, AC-008, INV-013, INV-015, IR-R12, IR-R13.
 *
 * The central guarantee: identity is computed over an ALLOWLIST projection, so a field
 * that nobody has declared semantic cannot influence it. Architecture revision 1 used a
 * denylist, where the failure mode was silent; these tests exist to keep the inversion
 * honest.
 */
import { describe, expect, it } from "vitest";

import { canonicalStringify, contentHash, rawHash, canonicalize } from "../../src/ir/canonical.js";
import {
  CONTEXT_REF_SEMANTIC_FIELDS,
  IR_SEMANTIC_FIELDS,
  semanticHash,
  semanticProjection,
} from "../../src/ir/projection.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import { SHA256_PATTERN } from "../../src/ir/canonical.js";
import { FIXTURE_NAMES, clone, loadFixture, readFixtureRaw } from "../helpers/fixtures.js";

describe("semantic hash — stability", () => {
  it("is stable across 100 recomputations", () => {
    const ir = loadFixture("auth-debug");
    const first = semanticHash(ir);
    for (let i = 0; i < 100; i++) {
      expect(semanticHash(ir)).toBe(first);
    }
  });

  it("is stable across independent parses of the same file", () => {
    const a = semanticHash(loadFixture("auth-debug"));
    const b = semanticHash(loadFixture("auth-debug"));
    expect(a).toBe(b);
  });

  it("is independent of key order in the source document (IR-R12)", () => {
    const raw = readFixtureRaw("auth-debug");
    const reversed = Object.fromEntries(Object.entries(raw).reverse());
    expect(semanticHash(parseTaskIR(reversed))).toBe(semanticHash(parseTaskIR(raw)));
  });

  it("produces the one documented hash format for every fixture (§3.4)", () => {
    for (const name of FIXTURE_NAMES) {
      expect(semanticHash(loadFixture(name))).toMatch(SHA256_PATTERN);
    }
  });

  it("distinguishes different fixtures", () => {
    const hashes = FIXTURE_NAMES.map((n) => semanticHash(loadFixture(n)));
    expect(new Set(hashes).size).toBe(FIXTURE_NAMES.length);
  });
});

describe("semantic hash — allowlist projection (INV-015, AC-008)", () => {
  it("ignores a field nobody has declared semantic", () => {
    const ir = loadFixture("auth-debug");
    const withNewField = { ...clone(ir), some_field_added_later: "surprise" } as unknown as TaskIR;
    expect(semanticHash(withNewField)).toBe(semanticHash(ir));
  });

  it("ignores several new fields of differing shapes", () => {
    const ir = loadFixture("auth-debug");
    const polluted = {
      ...clone(ir),
      created_at: "2026-09-07T10:12:00Z",
      run_id: "01J8Z2K3M4N5P6Q7R8S9T0V1W2",
      latency_ms: 1234,
      model: "some-model-identifier",
      host: { os: "linux", arch: "x64" },
    } as unknown as TaskIR;
    expect(semanticHash(polluted)).toBe(semanticHash(ir));
  });

  it("ignores semantic_hash itself, which is derived from the projection", () => {
    const ir = loadFixture("auth-debug");
    const withStoredHash = { ...clone(ir), semantic_hash: semanticHash(ir) };
    const withWrongHash = { ...clone(ir), semantic_hash: `sha256:${"0".repeat(64)}` };
    expect(semanticHash(withStoredHash)).toBe(semanticHash(ir));
    expect(semanticHash(withWrongHash)).toBe(semanticHash(ir));
  });

  it("ignores run-instance fields added to a context reference (INV-013)", () => {
    const ir = loadFixture("auth-debug");
    const polluted = clone(ir);
    (polluted.context_refs[0] as unknown as Record<string, unknown>)["score"] = 0.91;
    (polluted.context_refs[0] as unknown as Record<string, unknown>)["retrieved_at"] =
      "2026-09-07T10:11:58Z";
    (polluted.context_refs[0] as unknown as Record<string, unknown>)["retrieved_by"] = "ripgrep";
    (polluted.context_refs[0] as unknown as Record<string, unknown>)["est_tokens"] = 780;
    expect(semanticHash(polluted)).toBe(semanticHash(ir));
  });

  it("projects context references to exactly the declared semantic fields", () => {
    const ir = loadFixture("auth-debug");
    const projected = semanticProjection(ir) as Record<string, unknown>;
    const refs = projected["context_refs"] as Array<Record<string, unknown>>;
    for (const ref of refs) {
      expect(Object.keys(ref).sort()).toEqual([...CONTEXT_REF_SEMANTIC_FIELDS].sort());
    }
  });

  it("projects the IR to exactly the declared semantic fields", () => {
    const projected = semanticProjection(loadFixture("auth-debug")) as Record<string, unknown>;
    expect(Object.keys(projected).sort()).toEqual([...IR_SEMANTIC_FIELDS].sort());
  });

  it("excludes semantic_hash from the projection", () => {
    const projected = semanticProjection(loadFixture("auth-debug")) as Record<string, unknown>;
    expect(projected).not.toHaveProperty("semantic_hash");
  });
});

describe("semantic hash — sensitivity", () => {
  it("changes when any declared semantic field changes", () => {
    const ir = loadFixture("auth-debug");
    const baseline = semanticHash(ir);
    for (const field of IR_SEMANTIC_FIELDS) {
      const perturbed = clone(ir) as unknown as Record<string, unknown>;
      // A sentinel replacement works uniformly across strings, arrays and objects,
      // and cannot collide with any real value in the fixture.
      perturbed[field] = "__perturbed__";
      expect(
        semanticHash(perturbed as unknown as TaskIR),
        `changing "${field}" must change the hash`,
      ).not.toBe(baseline);
    }
  });

  it("changes when a nested statement changes", () => {
    const ir = loadFixture("auth-debug");
    const perturbed = clone(ir);
    perturbed.goals[0]!.statement = `${perturbed.goals[0]!.statement} (revised)`;
    expect(semanticHash(perturbed)).not.toBe(semanticHash(ir));
  });

  it("changes when a declared semantic context-ref field changes", () => {
    const ir = loadFixture("auth-debug");
    for (const field of CONTEXT_REF_SEMANTIC_FIELDS) {
      const perturbed = clone(ir);
      const ref = perturbed.context_refs[0] as unknown as Record<string, unknown>;
      ref[field] = "__perturbed__";
      expect(semanticHash(perturbed), `changing ref.${field} must change the hash`).not.toBe(
        semanticHash(ir),
      );
    }
  });

  it("changes when array order changes, because order is semantic (IR-R12)", () => {
    const ir = loadFixture("auth-debug");
    const reordered = clone(ir);
    reordered.goals.reverse();
    expect(semanticHash(reordered)).not.toBe(semanticHash(ir));
  });
});

describe("semantic hash — parse normalization", () => {
  it("treats an omitted defaulted field and its explicit default as the same task", () => {
    // Zod defaults are applied at parse time and several defaulted fields are semantic.
    // Hashing only parsed values is what makes these two documents agree.
    const raw = readFixtureRaw("auth-debug");
    const withoutConstraints = { ...raw };
    delete withoutConstraints["constraints"];
    const withEmptyConstraints = { ...raw, constraints: [] };

    expect(semanticHash(parseTaskIR(withoutConstraints))).toBe(
      semanticHash(parseTaskIR(withEmptyConstraints)),
    );
  });

  it("normalizes CRLF inside string values (NFR-009)", () => {
    const raw = readFixtureRaw("auth-debug");
    const crlf = clone(raw) as Record<string, unknown>;
    const objective = crlf["objective"] as Record<string, unknown>;
    objective["statement"] = "Line one\r\nline two";
    const lf = clone(crlf) as Record<string, unknown>;
    (lf["objective"] as Record<string, unknown>)["statement"] = "Line one\nline two";

    expect(semanticHash(parseTaskIR(crlf))).toBe(semanticHash(parseTaskIR(lf)));
  });

  it("normalizes backslash separators in context URIs (NFR-009)", () => {
    const raw = readFixtureRaw("auth-debug");
    const backslashed = clone(raw) as Record<string, unknown>;
    const refs = backslashed["context_refs"] as Array<Record<string, unknown>>;
    refs[0]!["uri"] = "forge://repo\\src\\auth\\provider.ts#L40-L118";

    const forwardSlashed = clone(raw) as Record<string, unknown>;
    (forwardSlashed["context_refs"] as Array<Record<string, unknown>>)[0]!["uri"] =
      "forge://repo/src/auth/provider.ts#L40-L118";

    expect(semanticHash(parseTaskIR(backslashed))).toBe(semanticHash(parseTaskIR(forwardSlashed)));
  });
});

describe("canonicalization (IR-R12)", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalStringify([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined properties but preserves null", () => {
    expect(canonicalStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("normalizes -0 to 0", () => {
    expect(canonicalStringify({ v: -0 })).toBe('{"v":0}');
  });

  it("rejects non-finite numbers rather than coercing them", () => {
    expect(() => canonicalize({ v: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ v: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("rejects BigInt", () => {
    expect(() => canonicalize({ v: 1n })).toThrow(/BigInt/);
  });

  it("rejects non-plain objects rather than silently emitting {}", () => {
    expect(() => canonicalize({ when: new Date(0) })).toThrow(/Date/);
    expect(() => canonicalize({ m: new Map() })).toThrow(/Map/);
  });

  it("reports the path of the offending value", () => {
    expect(() => canonicalize({ a: { b: [1, Number.NaN] } })).toThrow(/a\.b\[1\]/);
  });

  it("hashes raw text with CRLF normalized", () => {
    expect(rawHash("a\r\nb")).toBe(rawHash("a\nb"));
  });

  it("contentHash is order-independent for object keys", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});

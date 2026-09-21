/**
 * Execution Package determinism and portability (`AC-005`, `PK-R1`–`PK-R8`).
 *
 * `AC-005` is the criterion this phase most easily fakes: freeze the clock and
 * everything is byte-identical. `TS-R3` names that as the forbidden fix, and
 * these tests are written so it would not even help — the volatile value is
 * supplied by the caller, and the test asserts that two packages built with
 * **different** timestamps still agree on every semantic file and disagree on
 * `run.json`. A frozen clock would make the second assertion fail.
 *
 * The other half is `PK-R7`/`PK-R8`: a package must be readable by a stranger.
 * A schema-only reader test lives in `tests/contract/package-portable.test.ts`;
 * what is asserted here is that nothing leaks a path from the machine that
 * built it.
 */
import { describe, expect, it } from "vitest";

import { assemblePackage, semanticIdInputs, PACKAGE_FORMAT_VERSION } from "../../src/package/assemble.js";
import { verifyRelocatable } from "../../src/package/export.js";
import { compile } from "../../src/compile/compile.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { loadFixture } from "../helpers/fixtures.js";
import type { TaskIR } from "../../src/ir/schema.js";

const PROFILES = builtinProfiles();

function build(ir: TaskIR, profileId: string, generatedAt: string) {
  const profile = PROFILES.get(profileId);
  const result = compile(ir, profile, { taskSlug: "package" });
  return assemblePackage({ ir, profile, result, generatedAt });
}

const IR = (): TaskIR => loadFixture("auth-debug");

describe("two packages of the same inputs agree on everything semantic", () => {
  it("produces the same semantic_id at different wall-clock times", () => {
    const a = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const b = build(IR(), "claude-code", "2031-07-04T12:34:56.000Z");
    expect(a.semanticId).toBe(b.semanticId);
  });

  it("produces byte-identical semantic files, and a DIFFERENT run.json", () => {
    const a = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const b = build(IR(), "claude-code", "2031-07-04T12:34:56.000Z");

    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    for (const [i, f] of a.files.entries()) {
      expect(f.content, `${f.path} differs between runs`).toBe(b.files[i]!.content);
    }
    // The clock is not frozen, so this MUST differ (TS-R3). If a future change
    // made run.json constant, the determinism claim above would become vacuous.
    expect(a.run.content).not.toBe(b.run.content);
  });

  it("holds on every shipped profile", () => {
    for (const id of PROFILES.ids) {
      const a = build(IR(), id, "2026-01-01T00:00:00.000Z");
      const b = build(IR(), id, "2031-07-04T12:34:56.000Z");
      expect(a.semanticId, `${id} semantic_id is unstable`).toBe(b.semanticId);
      expect(a.files.map((f) => f.content)).toEqual(b.files.map((f) => f.content));
    }
  });

  it("changes semantic_id when the profile changes", () => {
    const a = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const b = build(IR(), "kiro", "2026-01-01T00:00:00.000Z");
    expect(a.semanticId).not.toBe(b.semanticId);
  });
});

describe("what semantic identity covers, and what it must not", () => {
  it("covers the §6.4 tuple, the requirement manifest and every artifact hash (PK-R3)", () => {
    const ir = IR();
    const profile = PROFILES.get("claude-code");
    const result = compile(ir, profile, { taskSlug: "package" });
    const inputs = semanticIdInputs({ ir, profile, result, generatedAt: "x" });

    expect(Object.keys(inputs).sort()).toEqual([
      "artifacts",
      "context_refs",
      "forge_compiler_version",
      "ir_semantic_hash",
      "ir_version",
      "profile",
      "requirement_manifest",
      "strategy_semantic_hash",
      "tokenizer",
    ]);
  });

  /**
   * `INV-013`: no volatile value may participate in a semantic hash. Asserted
   * structurally rather than by inspection, because "we were careful" is not a
   * property a future change preserves.
   */
  it("contains no timestamp, latency, model identity or host metadata (INV-013)", () => {
    const ir = IR();
    const profile = PROFILES.get("claude-code");
    const result = compile(ir, profile, { taskSlug: "package" });
    const serialized = JSON.stringify(
      semanticIdInputs({ ir, profile, result, generatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    expect(serialized).not.toContain("2026-01-01");
    for (const forbidden of ["latency", "generated_at", "hostname", "model", "duration"]) {
      expect(serialized.toLowerCase(), `semantic id inputs mention "${forbidden}"`).not.toContain(forbidden);
    }
  });

  /**
   * PK-R3 as corrected in the V2-F closure audit. `semantic_id` names the
   * Execution Contract, not only the compilation, and V2-G binds evidence to it
   * (`EV-R2`). If two packages with different requirement manifests shared an
   * id, evidence produced against one would be silently accepted for the other,
   * and `INV-005` — fixed semantic inputs, byte-identical semantic outputs —
   * would be false of `requirements.json` and `package.json`.
   */
  it("covers the requirement manifest — a pin changes the package's identity", () => {
    const ir = IR();
    const profile = PROFILES.get("claude-code");
    const result = compile(ir, profile, { taskSlug: "package" });
    const base = { ir, profile, result, generatedAt: "2026-01-01T00:00:00.000Z" };
    const withoutPins = assemblePackage(base);
    const withPins = assemblePackage({
      ...base,
      ledger: [{ id: "k1", text: "Never widen the scope", contentHash: "sha256:x", origin: "user_input" }],
    });

    expect(withPins.semanticId).not.toBe(withoutPins.semanticId);
    // The compilation itself is unchanged: same artifacts, byte for byte.
    const artifactsOf = (p: typeof withPins): string[] =>
      p.files.filter((f) => f.path.startsWith("artifacts/")).map((f) => f.content);
    expect(artifactsOf(withPins)).toEqual(artifactsOf(withoutPins));
  });

  /**
   * The origin-only case, which is the one a count-based check would miss: the
   * user pins the exact text the extraction already captured as a constraint.
   * The manifest has the same ids, but one entry is now `user_stated` rather
   * than `inferred` (`RQ-R3`). That is a different contract.
   */
  it("changes identity when only a requirement's origin changes", () => {
    const ir = IR();
    const profile = PROFILES.get("claude-code");
    const result = compile(ir, profile, { taskSlug: "package" });
    const base = { ir, profile, result, generatedAt: "2026-01-01T00:00:00.000Z" };
    const text = ir.constraints[0]!.statement;
    const pinned = assemblePackage({
      ...base,
      ledger: [{ id: "k1", text, contentHash: "sha256:x", origin: "user_input" }],
    });
    const unpinned = assemblePackage(base);

    const idsOf = (p: typeof pinned): string[] =>
      (JSON.parse(p.files.find((f) => f.path === "requirements.json")!.content).requirements as Array<{
        id: string;
      }>)
        .map((r) => r.id)
        .sort();
    expect(idsOf(pinned)).toEqual(idsOf(unpinned));
    expect(pinned.semanticId).not.toBe(unpinned.semanticId);
  });

  /**
   * The property V2-G's evidence binding actually relies on, stated directly:
   * **one `semantic_id`, one package.** Across every ledger variation, packages
   * that share an id must agree on every semantic file, byte for byte.
   */
  it("never gives two packages with different semantic files the same id (INV-005)", () => {
    const ir = IR();
    const entry = (id: string, text: string) =>
      ({ id, text, contentHash: "sha256:x", origin: "user_input" }) as const;
    const ledgers = [
      [],
      [entry("a", "Never widen the scope")],
      [entry("b", "Keep the public API stable")],
      [entry("a", "Never widen the scope"), entry("b", "Keep the public API stable")],
      [entry("c", ir.constraints[0]!.statement)],
      // Same text, different storage key: identity is the text (RQ-R2), so
      // this one MUST collide with the ledger above, and agree on every byte.
      [entry("zz", ir.constraints[0]!.statement)],
    ];
    const byId = new Map<string, string[]>();
    for (const profileId of ["claude-code", "kiro"]) {
      const profile = PROFILES.get(profileId);
      const result = compile(ir, profile, { taskSlug: "package" });
      for (const ledger of ledgers) {
        const p = assemblePackage({ ir, profile, result, ledger, generatedAt: "2026-01-01T00:00:00.000Z" });
        const contents = p.files.map((f) => `${f.path}\n${f.content}`);
        const seen = byId.get(p.semanticId);
        if (seen) expect(contents, `two different packages share ${p.semanticId}`).toEqual(seen);
        else byId.set(p.semanticId, contents);
      }
    }
    // 2 profiles x 5 distinct contracts (the last two ledgers are one contract).
    expect(byId.size).toBe(10);
  });
});

describe("the package layout (PK-R1, PK-R2)", () => {
  it("contains exactly the declared semantic files plus artifacts", () => {
    const pkg = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const paths = pkg.files.map((f) => f.path);
    for (const required of [
      "package.json",
      "task-ir.json",
      "strategy.json",
      "requirements.json",
      "trace.json",
      "provenance.json",
      "runtime-contract.json",
      "verification.json",
      "diagnostics.json",
    ]) {
      expect(paths, `missing ${required}`).toContain(required);
    }
    expect(paths.some((p) => p.startsWith("artifacts/"))).toBe(true);
    expect(pkg.run.path).toBe("run.json");
    // run.json is NOT among the semantic files — that separation is the whole
    // mechanism behind AC-005.
    expect(paths).not.toContain("run.json");
  });

  it("lists the content hash of every other file in package.json (PK-R2)", () => {
    const pkg = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const manifest = JSON.parse(pkg.files.find((f) => f.path === "package.json")!.content) as {
      semantic_id: string;
      package_format_version: string;
      files: Array<{ path: string; content_hash: string }>;
    };
    expect(manifest.package_format_version).toBe(PACKAGE_FORMAT_VERSION);
    expect(manifest.semantic_id).toBe(pkg.semanticId);

    const listed = new Set(manifest.files.map((f) => f.path));
    for (const f of pkg.files) {
      if (f.path === "package.json") continue;
      expect(listed, `package.json does not list ${f.path}`).toContain(f.path);
    }
    // Hashes must be the real ones, so tampering is detectable without recompiling.
    for (const entry of manifest.files) {
      const actual = pkg.files.find((f) => f.path === entry.path)!;
      expect(entry.content_hash).toBe(actual.contentHash);
    }
  });

  it("declares without granting (PK-R4, INV-004)", () => {
    const pkg = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const contract = JSON.parse(
      pkg.files.find((f) => f.path === "runtime-contract.json")!.content,
    ) as Record<string, unknown>;
    expect(contract["declares_only"]).toBe(true);
    expect(contract["grants"]).toBeNull();
    // No repository is bound in V2-F, and inventing a commit would be a claim
    // about a repository this package was never checked against.
    expect(contract["repository"]).toEqual({ commit: null, dirty: null });
  });

  it("publishes verification as data FORGE did not run (PK-R5, FR-042)", () => {
    const pkg = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const verification = JSON.parse(
      pkg.files.find((f) => f.path === "verification.json")!.content,
    ) as { executed_by_forge: boolean; entries: Array<Record<string, unknown>> };
    expect(verification.executed_by_forge).toBe(false);
    for (const entry of verification.entries) {
      expect(Object.keys(entry)).toContain("spec");
      expect(Object.keys(entry)).toContain("expected");
      expect(Object.keys(entry)).toContain("satisfies");
    }
  });

  it("separates deterministic from judged findings with its own hash (PK-R6)", () => {
    const pkg = build(IR(), "claude-code", "2026-01-01T00:00:00.000Z");
    const diagnostics = JSON.parse(
      pkg.files.find((f) => f.path === "diagnostics.json")!.content,
    ) as { deterministic: unknown[]; judged: unknown[]; deterministic_hash: string };
    expect(Array.isArray(diagnostics.deterministic)).toBe(true);
    expect(Array.isArray(diagnostics.judged)).toBe(true);
    expect(diagnostics.deterministic_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("a package is relocatable (PK-R7)", () => {
  it("leaks no absolute path from the machine that built it", () => {
    for (const id of PROFILES.ids) {
      const pkg = build(IR(), id, "2026-01-01T00:00:00.000Z");
      expect(verifyRelocatable(pkg), `${id} leaks a host path`).toEqual([]);
    }
  });
});

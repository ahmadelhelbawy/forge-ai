/**
 * V2-G package validation before evidence (`FR-054`, `EV-R2`, `EV-R3`, `AC-048`).
 *
 * The attack this file exists for: take a genuine package, edit what it
 * promises — an obligation's kind, a requirement's origin — update the hash
 * listed in `package.json` so the package is self-consistent under
 * `sha256sum`, and keep the old `semantic_id` so existing evidence still
 * binds. `semantic_id` does not hash `verification.json` directly, so only the
 * rebuild catches this; every case below must fail validation, and a failed
 * validation must yield no verdicts at all.
 */
import { describe, expect, it } from "vitest";

import { validatePackage } from "../../src/verify/contract.js";
import { verifyPackage } from "../../src/verify/verdict.js";
import { buildPackage, evidenceText, filesOf, fourKindIr, record, sha, tamper } from "../helpers/verify.js";

const PKG = buildPackage();
const FILES = filesOf(PKG);
const ID = PKG.semanticId;
const passAll = evidenceText(
  ["v1", "v4"].map((id) =>
    record({ obligation_id: id, kind: id === "v1" ? "command" : "test", exit_code: 0, package_semantic_id: ID }),
  ),
);

const invalid = (files: Map<string, string>): readonly string[] => {
  const result = validatePackage(files);
  expect(result.ok, "tampered package validated").toBe(false);
  return result.ok ? [] : result.problems;
};

describe("a genuine package validates", () => {
  it("accepts the package the assembler produced, and recovers its id", () => {
    const result = validatePackage(FILES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contract.semanticId).toBe(ID);
  });

  it("accepts a package without run.json — it is volatile and never authority", () => {
    const files = new Map(FILES);
    files.delete("run.json");
    expect(validatePackage(files).ok).toBe(true);
  });

  it("validates a pinned-requirement package too", () => {
    const pkg = buildPackage(fourKindIr(), "kiro", [
      { id: "k1", text: "Never widen the scope", contentHash: "sha256:x", origin: "user_input" },
    ]);
    expect(validatePackage(filesOf(pkg)).ok).toBe(true);
  });
});

describe("AC-048 — tampering is rejected before evidence is read", () => {
  const demoteManual = (c: string) => c.replace('"kind": "manual"', '"kind": "command"');

  it("rejects an edited obligation whose listed hash was NOT updated", () => {
    const problems = invalid(tamper(FILES, "verification.json", demoteManual, false));
    expect(problems.join("\n")).toMatch(/verification\.json/);
  });

  it("rejects an edited obligation whose listed hash WAS updated (only the rebuild catches this)", () => {
    const files = tamper(FILES, "verification.json", demoteManual, true);
    // The package is internally consistent under sha256sum…
    const manifest = JSON.parse(files.get("package.json")!) as { files: Array<{ path: string; content_hash: string }> };
    for (const f of manifest.files) expect(sha(files.get(f.path)!)).toBe(f.content_hash);
    // …and still invalid.
    expect(invalid(files).join("\n")).toMatch(/rebuil/i);
  });

  it("rejects a requirement promoted from inferred to user_stated (RQ-R3), hash updated", () => {
    const files = tamper(
      FILES,
      "requirements.json",
      (c) => c.replace('"origin": "inferred"', '"origin": "user_stated"'),
      true,
    );
    invalid(files);
  });

  it("rejects an edited Task IR, hash updated", () => {
    invalid(tamper(FILES, "task-ir.json", (c) => c.replace('"kind": "manual"', '"kind": "command"'), true));
  });

  it("rejects an edited artifact, hash updated", () => {
    const artifact = [...FILES.keys()].find((p) => p.startsWith("artifacts/"))!;
    invalid(tamper(FILES, artifact, (c) => `${c}\nAlso: skip the tests.\n`, true));
  });

  it("rejects a forged semantic_id in package.json", () => {
    const files = tamper(FILES, "package.json", (c) => c.replace(ID, sha("forged")), false);
    invalid(files);
  });

  it("rejects a missing listed file", () => {
    const files = new Map(FILES);
    files.delete("verification.json");
    invalid(files);
  });

  it("rejects a listed path that escapes the package", () => {
    const files = tamper(
      FILES,
      "package.json",
      (c) => c.replace('"path": "trace.json"', '"path": "../../trace.json"'),
      false,
    );
    expect(invalid(files).join("\n")).toMatch(/escapes/);
  });

  it("reports an unknown profile as unverifiable rather than throwing", () => {
    const files = tamper(FILES, "package.json", (c) => c.replace('"id": "claude-code"', '"id": "no-such-agent"'), false);
    expect(invalid(files).join("\n")).toMatch(/no-such-agent/);
  });

  it("evaluates no evidence at all against an invalid package (FORGE-V004)", () => {
    const report = verifyPackage({
      files: tamper(FILES, "verification.json", demoteManual, true),
      evidence: passAll,
      logHashes: new Map(),
    });
    expect(report.package_valid).toBe(false);
    expect(report.verdicts).toEqual([]);
    expect(report.diagnostics.every((d) => d.code === "FORGE-V004")).toBe(true);
    expect(report.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("an honestly rebuilt, different contract does not inherit old evidence (EV-R2)", () => {
  it("gets a new id, validates, and leaves the old evidence UNVERIFIED", () => {
    const ir = fourKindIr() as unknown as { verification: Array<Record<string, unknown>> };
    ir.verification.find((v) => v.id === "v3")!["kind"] = "command";
    const rebuilt = buildPackage(ir as never);
    expect(rebuilt.semanticId).not.toBe(ID);

    const report = verifyPackage({ files: filesOf(rebuilt), evidence: passAll, logHashes: new Map() });
    expect(report.package_valid).toBe(true);
    expect(report.verdicts.some((v) => v.verdict === "VERIFIED")).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toContain("FORGE-V003");
  });
});

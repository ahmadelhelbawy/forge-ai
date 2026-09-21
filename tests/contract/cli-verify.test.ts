/**
 * `forge verify` and `forge explain --package --evidence` end to end, through
 * the real binary and a real exported directory (V2-G, `FR-053`, `FR-054`).
 */
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { exportPackage } from "../../src/package/export.js";
import { EXIT, runCli } from "../helpers/cli.js";
import { buildPackage, evidenceText, record, sha } from "../helpers/verify.js";

const PKG = buildPackage();
const ID = PKG.semanticId;
let dir: string;
let pkgDir: string;

function evidenceFile(name: string, records: Record<string, unknown>[]): string {
  const path = join(dir, name);
  writeFileSync(path, evidenceText(records));
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "forge-verify-"));
  pkgDir = join(dir, "pkg");
  exportPackage(PKG, pkgDir);
});

describe("forge verify", () => {
  it("exits 0 with VERIFIED when every executable obligation passed", async () => {
    const ev = evidenceFile("pass.json", [
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID }),
      record({ obligation_id: "v4", kind: "test", exit_code: 0, package_semantic_id: ID }),
    ]);
    const r = await runCli(["verify", "--package", pkgDir, "--evidence", ev, "--json"]);
    expect(r.code).toBe(EXIT.ok);
    const report = JSON.parse(r.stdout) as { verdicts: Array<{ obligation_id: string; verdict: string }> };
    expect(report.verdicts.map((v) => `${v.obligation_id}:${v.verdict}`)).toEqual([
      "v1:VERIFIED",
      "v2:REVIEW_REQUIRED",
      "v3:REVIEW_REQUIRED",
      "v4:VERIFIED",
    ]);
  });

  it("exits 1 when an obligation FAILED, and the output is byte-identical across runs", async () => {
    const ev = evidenceFile("fail.json", [
      record({ obligation_id: "v1", kind: "command", exit_code: 1, package_semantic_id: ID }),
    ]);
    const a = await runCli(["verify", "--package", pkgDir, "--evidence", ev, "--json"]);
    const b = await runCli(["verify", "--package", pkgDir, "--evidence", ev, "--json"]);
    expect(a.code).toBe(EXIT.diagnostics);
    expect(a.stdout).toBe(b.stdout);
    expect(a.stdout).toContain('"verdict": "FAILED"');
  });

  it("exits 3 and evaluates nothing when the package was tampered with", async () => {
    const tampered = join(dir, "tampered");
    exportPackage(PKG, tampered);
    const vpath = join(tampered, "verification.json");
    const edited = readFileSync(vpath, "utf8").replace('"kind": "manual"', '"kind": "command"');
    writeFileSync(vpath, edited);
    const manifestPath = join(tampered, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Array<{ path: string; content_hash: string }> };
    for (const f of manifest.files) if (f.path === "verification.json") f.content_hash = sha(edited);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const ev = evidenceFile("any.json", [
      record({ obligation_id: "v3", kind: "command", exit_code: 0, package_semantic_id: ID }),
    ]);
    const r = await runCli(["verify", "--package", tampered, "--evidence", ev]);
    expect(r.code).toBe(EXIT.refused);
    expect(r.stdout).toContain("REJECTED");
    expect(r.stdout).not.toContain("VERIFIED");
  });

  it("never opens a listed file that is a symlink out of the package", async () => {
    const linked = join(dir, "linked");
    exportPackage(PKG, linked);
    const secret = join(dir, "outside-secret.txt");
    writeFileSync(secret, "AWS_SECRET_ACCESS_KEY=planted\n");
    unlinkSync(join(linked, "trace.json"));
    symlinkSync(secret, join(linked, "trace.json"));
    const ev = evidenceFile("none.json", []);
    const r = await runCli(["verify", "--package", linked, "--evidence", ev, "--json"]);
    expect(r.code).toBe(EXIT.refused);
    expect(r.stdout).toContain("trace.json is listed in package.json but missing");
    expect(r.stdout).not.toContain("planted");
  });

  it("checks a named log against its recorded hash", async () => {
    mkdirSync(join(dir, "logs"), { recursive: true });
    writeFileSync(join(dir, "logs", "v1.out"), "PASS\n");
    const good = evidenceFile("logged.json", [
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID, stdout_hash: sha("PASS\n"), logs: { stdout: "logs/v1.out" } }),
    ]);
    const ok = await runCli(["verify", "--package", pkgDir, "--evidence", good, "--json"]);
    expect(ok.stdout).toContain('"verdict": "VERIFIED"');

    writeFileSync(join(dir, "logs", "v1.out"), "PASS\n(edited after the fact)\n");
    const edited = await runCli(["verify", "--package", pkgDir, "--evidence", good, "--json"]);
    expect(edited.stdout).not.toContain('"verdict": "VERIFIED"');
    expect(edited.stdout).toContain("FORGE-V005");
  });

  it("exits 2 for a malformed evidence file", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, '{"records":[{"obligation_id":"v1"}]}');
    const r = await runCli(["verify", "--package", pkgDir, "--evidence", path]);
    expect(r.code).toBe(EXIT.usage);
  });
});

describe("forge explain --package --evidence", () => {
  it("shows obligation → evidence → verdict beneath the package explanation", async () => {
    const ev = evidenceFile("explain.json", [
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: ID }),
      record({ obligation_id: "v4", kind: "test", exit_code: 2, package_semantic_id: ID }),
    ]);
    const r = await runCli(["explain", "--package", pkgDir, "--evidence", ev]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain("=== requirements");
    expect(r.stdout).toContain("=== obligation → evidence → verdict ===");
    expect(r.stdout).toMatch(/\[v1\] command: .*\n\s+→ record #0 \(ci, exit 0\)\n\s+→ VERIFIED/);
    expect(r.stdout).toMatch(/\[v4\] test: .*\n\s+→ record #1 \(ci, exit 2\)\n\s+→ FAILED/);
    expect(r.stdout).toMatch(/\[v3\] manual: .*\n\s+→ no accepted evidence\n\s+→ REVIEW_REQUIRED/);
  });
});

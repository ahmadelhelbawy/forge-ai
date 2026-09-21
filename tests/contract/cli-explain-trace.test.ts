/**
 * `forge explain --package` renders the traceability chain (V2-H, `FR-058`,
 * `spec.md` §22.10 TM-R4, `AC-056`, `AC-057`).
 *
 * One explanation engine: the CLI renders the same `buildTraceabilityMatrix`
 * the Studio uses, through the real binary and a real exported package. The
 * chain for one requirement must read, top to bottom: provenance → lifecycle →
 * IR node → artifact span → file/test links → obligation → evidence → verdict.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { contentHash } from "../../src/ir/canonical.js";
import { exportPackage } from "../../src/package/export.js";
import { requirementId } from "../../src/requirement/identity.js";
import { EXIT, runCli } from "../helpers/cli.js";
import { buildPackage, evidenceText, fourKindIr, record } from "../helpers/verify.js";

const FAKE_KEY = "AKIA" + "Q7XJ4MZ2KD9PL3WB";
const PINNED = "Never log a session token in plain text";
const G2 = "Apply a fix that does not alter the session provider's public interface";
const PKG = buildPackage(fourKindIr(), "claude-code", [
  { id: "k1", text: PINNED, contentHash: contentHash(PINNED), origin: "user_input" },
]);
let dir: string;
let pkgDir: string;
let workspace: string;
let governance: string;
let evidence: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "forge-explain-trace-"));
  pkgDir = join(dir, "pkg");
  exportPackage(PKG, pkgDir);
  workspace = join(dir, "repo");
  mkdirSync(join(workspace, "src", "auth"), { recursive: true });
  mkdirSync(join(workspace, "tests"), { recursive: true });
  writeFileSync(
    join(workspace, "src", "auth", "provider.ts"),
    "// Apply the fix without letting anyone alter the session provider public interface.\n",
  );
  writeFileSync(join(workspace, "tests", "session-provider.test.ts"), "// covers the provider\n");
  writeFileSync(join(workspace, "src", "auth", "keys.ts"), `// apply fix alter session provider public interface\nconst k = "${FAKE_KEY}";\n`);
  governance = join(dir, "governance.json");
  writeFileSync(
    governance,
    JSON.stringify({ decisions: [{ kind: "supersede", requirement_id: requirementId(PINNED), successor_id: requirementId(G2) }] }),
  );
  evidence = join(dir, "evidence.json");
  writeFileSync(
    evidence,
    evidenceText([
      record({ obligation_id: "v1", kind: "command", exit_code: 0, package_semantic_id: PKG.semanticId }),
      record({ obligation_id: "v4", kind: "test", exit_code: 0, package_semantic_id: PKG.semanticId }),
    ]),
  );
});

const full = () => ["explain", "--package", pkgDir, "--workspace", workspace, "--governance", governance, "--evidence", evidence];

describe("forge explain --package: the traceability chain (TM-R4)", () => {
  it("renders provenance → lifecycle → node → span → links → obligation → verdict for one requirement", async () => {
    const r = await runCli([...full(), "--requirement", requirementId(G2)]);
    expect(r.code, r.stderr).toBe(EXIT.ok);
    const out = r.stdout;
    const order = [
      `[${requirementId(G2)}]`,
      "provenance   inferred",
      "lifecycle    open",
      "IR node      g2 (goal)",
      "artifact     ",
      "files        src/auth/keys.ts ← rg_term 7/7",
      "src/auth/provider.ts ← rg_term 7/7",
      "tests        tests/session-provider.test.ts ← test_naming",
      "ADVISORY     (none supplied)",
      "obligation   [v1] command:",
      "VERIFIED",
    ];
    let at = out.indexOf("=== requirement traceability");
    expect(at).toBeGreaterThan(-1);
    for (const needle of order) {
      const next = out.indexOf(needle, at);
      expect(next, `"${needle}" after position ${at}`).toBeGreaterThan(-1);
      at = next;
    }
    expect(out).toContain("taken at its word");
  });

  it("shows the superseded pinned requirement with its successor, and reports it (FORGE-R002)", async () => {
    const r = await runCli(full());
    expect(r.stdout).toContain(`lifecycle    superseded · pinned · superseded by ${requirementId(G2)}`);
    expect(r.stdout).toContain("provenance   user_stated · ledger (pinned verbatim)");
    expect(r.stdout).toContain("FORGE-R002");
  });

  it("emits the matrix as JSON, byte-identical across runs, with no credential in it", async () => {
    const a = await runCli([...full(), "--json"]);
    const b = await runCli([...full(), "--json"]);
    expect(a.code, a.stderr).toBe(EXIT.ok);
    expect(a.stdout).toBe(b.stdout);
    const matrix = JSON.parse(a.stdout) as { rows: Array<{ files: Array<{ advisory: boolean }> }>; repository_bound: boolean };
    expect(matrix.repository_bound).toBe(true);
    for (const row of matrix.rows) for (const f of row.files) expect(f.advisory).toBe(false);
    expect(a.stdout).not.toContain(FAKE_KEY);
    expect((await runCli(full())).stdout).not.toContain(FAKE_KEY);
  });

  it("still explains a package with nothing bound, stating the absence", async () => {
    const r = await runCli(["explain", "--package", pkgDir]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain("repository   not bound — no file or test links");
    expect(r.stdout).toContain("files        (no repository bound)");
  });

  it("refuses a governance file that carries an origin or makes a cycle, and a missing workspace", async () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ decisions: [{ kind: "accept", requirement_id: requirementId(G2), origin: "user_stated" }] }));
    expect((await runCli(["explain", "--package", pkgDir, "--governance", bad])).code).toBe(EXIT.usage);
    const cycle = join(dir, "cycle.json");
    const g1 = requirementId("Identify the root cause of session loss during token refresh");
    writeFileSync(
      cycle,
      JSON.stringify({
        decisions: [
          { kind: "supersede", requirement_id: g1, successor_id: requirementId(G2) },
          { kind: "supersede", requirement_id: requirementId(G2), successor_id: g1 },
        ],
      }),
    );
    expect((await runCli(["explain", "--package", pkgDir, "--governance", cycle])).code).toBe(EXIT.usage);
    expect((await runCli(["explain", "--package", pkgDir, "--workspace", join(dir, "nope")])).code).toBe(EXIT.usage);
  });
});

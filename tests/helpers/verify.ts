/**
 * Shared builders for the V2-G verification tests.
 *
 * Packages are assembled in memory by the real assembler — never hand-written —
 * so a test that passes here passes against the bytes FORGE actually emits.
 */
import { createHash } from "node:crypto";

import { assemblePackage, type ExecutionPackage } from "../../src/package/assemble.js";
import { compile } from "../../src/compile/compile.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import type { TaskIR } from "../../src/ir/schema.js";
import type { LedgerEntry } from "../../src/critic/deterministic/ledger.js";
import { clone, loadFixture } from "./fixtures.js";

/** `auth-debug` with one obligation of every kind: command, test, review, manual. */
export function fourKindIr(): TaskIR {
  const ir = clone(loadFixture("auth-debug")) as TaskIR & { verification: Array<Record<string, unknown>> };
  const command = ir.verification.find((v) => v.id === "v1")!;
  ir.verification.push({ ...command, id: "v4", kind: "test", spec: "pnpm vitest run src/auth/session.test.ts" });
  return ir as TaskIR;
}

export function buildPackage(
  ir: TaskIR = fourKindIr(),
  profileId = "claude-code",
  ledger: readonly LedgerEntry[] = [],
): ExecutionPackage {
  const profile = builtinProfiles().get(profileId);
  const result = compile(ir, profile, { taskSlug: ir.objective.kind });
  return assemblePackage({ ir, profile, result, ledger, generatedAt: "2026-01-01T00:00:00.000Z" });
}

/** The package as the verifier receives it: path → bytes, `run.json` included. */
export function filesOf(pkg: ExecutionPackage): Map<string, string> {
  return new Map([...pkg.files, pkg.run].map((f) => [f.path, f.content]));
}

export const sha = (text: string): string => `sha256:${createHash("sha256").update(text).digest("hex")}`;

export interface RecordInput {
  obligation_id: string;
  kind: string;
  exit_code: number | null;
  package_semantic_id: string;
  logs?: { stdout?: string; stderr?: string };
  stdout_hash?: string | null;
}

export function record(input: RecordInput): Record<string, unknown> {
  return {
    obligation_id: input.obligation_id,
    kind: input.kind,
    exit_code: input.exit_code,
    stdout_hash: input.stdout_hash === undefined ? sha(`stdout ${input.obligation_id}`) : input.stdout_hash,
    stderr_hash: sha(""),
    started_at: "2026-09-21T10:00:00.000Z",
    duration_ms: 1234,
    runner: "ci",
    repo_commit: null,
    package_semantic_id: input.package_semantic_id,
    ...(input.logs ? { logs: input.logs } : {}),
  };
}

export const evidenceText = (records: readonly Record<string, unknown>[]): string =>
  `${JSON.stringify({ records }, null, 2)}\n`;

/** Replace one file's bytes, optionally re-listing its hash in `package.json`. */
export function tamper(
  files: Map<string, string>,
  path: string,
  edit: (content: string) => string,
  relist: boolean,
): Map<string, string> {
  const out = new Map(files);
  const next = edit(out.get(path)!);
  out.set(path, next);
  if (relist) {
    const manifest = JSON.parse(out.get("package.json")!) as { files: Array<{ path: string; content_hash: string }> };
    for (const f of manifest.files) if (f.path === path) f.content_hash = sha(next);
    out.set("package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return out;
}

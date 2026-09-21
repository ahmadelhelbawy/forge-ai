/**
 * `forge verify` — did an external execution satisfy this Execution Contract?
 * (V2-G, `FR-053`, `FR-054`, `spec.md` §11.1)
 *
 * The CLI half is only file reading: the package directory, the evidence file,
 * and any logs the evidence names. Every decision is `src/verify/`, which the
 * workspace shares, so the two cannot disagree about a verdict.
 *
 * **It executes nothing** (`INV-004`, `AC-020`). The commands in
 * `verification.json` were run — or not — by someone else; this reads what
 * they reported. Two reads are guarded because both paths are untrusted: the
 * files a received `package.json` lists, and the logs an evidence file names.
 * Each goes through the export path jail (`safeJoin`) and must be a regular
 * file, so neither `../../.ssh/id_rsa` nor a symlink to it is ever opened.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Command } from "commander";

import { safeJoin } from "../package/export.js";
import { BUILTIN_PROFILE_DIR, builtinProfiles, loadProfilesFrom, type ProfileRegistry } from "../profile/registry.js";
import { isSafePackagePath } from "../verify/contract.js";
import { logPathsOf, parseEvidence } from "../verify/evidence.js";
import { verifyPackage, type VerdictReport } from "../verify/verdict.js";
import { EXIT, fatal } from "./errors.js";

/** A regular file inside `root`, or null. Never follows a symlink out. */
function readInside(root: string, relative: string): Buffer | null {
  if (!isSafePackagePath(relative)) return null;
  let target: string;
  try {
    target = safeJoin(root, relative);
  } catch {
    return null;
  }
  try {
    if (!lstatSync(target).isFile()) return null;
    return readFileSync(target);
  } catch {
    return null;
  }
}

/**
 * The package as `path → text`: `package.json` plus every file it lists that
 * can be read safely. A listed file that cannot be read is simply absent, and
 * validation reports it; nothing here decides validity.
 */
export function readPackageDir(dir: string): Map<string, string> {
  const root = resolve(dir);
  const files = new Map<string, string>();
  const manifest = readInside(root, "package.json");
  if (manifest === null) return files;
  const text = manifest.toString("utf8");
  files.set("package.json", text);
  let listed: unknown;
  try {
    listed = (JSON.parse(text) as { files?: unknown }).files;
  } catch {
    return files;
  }
  if (!Array.isArray(listed)) return files;
  for (const entry of listed) {
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== "string") continue;
    const bytes = readInside(root, path);
    if (bytes !== null) files.set(path, bytes.toString("utf8"));
  }
  return files;
}

/** Verify a package directory against an evidence file, reading only files. */
export function verifyDirectory(
  packageDir: string,
  evidencePath: string,
  registry: ProfileRegistry = builtinProfiles(),
): VerdictReport {
  const evidence = readFileSync(resolve(evidencePath), "utf8");
  const evidenceRoot = dirname(resolve(evidencePath));
  const logHashes = new Map<string, string | null>();
  // parseEvidence throws for a malformed file — but only the verdict pass
  // decides, after the package validated; here it just tells us which logs to hash.
  let parsed;
  try {
    parsed = parseEvidence(evidence);
  } catch {
    parsed = null;
  }
  for (const path of parsed ? logPathsOf(parsed) : []) {
    const bytes = readInside(evidenceRoot, path);
    logHashes.set(path, bytes === null ? null : `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  }
  return verifyPackage({ files: readPackageDir(packageDir), evidence, logHashes, registry });
}

/** Human rendering: obligation → evidence → verdict. Shared with `forge explain`. */
export function writeVerdicts(report: VerdictReport, out: NodeJS.WritableStream): void {
  if (!report.package_valid) {
    out.write(`package    REJECTED — no evidence was evaluated (EV-R3)\n`);
    out.write(`claimed    ${report.package_semantic_id ?? "(unreadable)"}\n`);
    for (const d of report.diagnostics) out.write(`  ${d.severity}[${d.code}] ${d.message}\n`);
    return;
  }
  out.write(`package    ${report.package_semantic_id}  (validated: rebuilt byte-for-byte from its own inputs)\n`);
  out.write(`\n=== obligation → evidence → verdict ===\n`);
  for (const v of report.verdicts) {
    const evidence =
      v.records.length === 0
        ? "no accepted evidence"
        : v.records.map((r) => `record #${r.index} (${r.runner}, exit ${r.exit_code ?? "-"})`).join(", ");
    out.write(`  [${v.obligation_id}] ${v.kind}: ${v.spec}\n`);
    out.write(`      → ${evidence}\n      → ${v.verdict}\n`);
  }
  const counts = (["VERIFIED", "FAILED", "UNVERIFIED", "REVIEW_REQUIRED"] as const)
    .map((k) => `${k} ${report.verdicts.filter((v) => v.verdict === k).length}`)
    .join(" · ");
  out.write(`\n${counts}\n`);
  if (report.diagnostics.length > 0) {
    out.write(`\n=== diagnostics ===\n`);
    for (const d of report.diagnostics) out.write(`  ${d.severity}[${d.code}] ${d.message}\n`);
  }
  out.write(`\n${(JSON.parse(report.json) as { caveat: string }).caveat}\n`);
}

export function registerVerifyCommand(program: Command): void {
  program
    .command("verify")
    .description("Evaluate externally produced evidence against an Execution Package. Executes nothing.")
    .requiredOption("--package <dir>", "an exported Execution Package")
    .requiredOption("--evidence <file>", "an evidence file produced by whoever ran the obligations")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--json", "print the verdict report (byte-stable for fixed inputs)")
    .action((opts: { package: string; evidence: string; profileDir?: string; json?: boolean }) => {
      try {
        const registry = opts.profileDir
          ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
          : builtinProfiles();
        const report = verifyDirectory(opts.package, opts.evidence, registry);
        if (opts.json) process.stdout.write(report.json);
        else writeVerdicts(report, process.stdout);
        // An unverifiable package is a refusal; a recorded failure is a finding.
        if (!report.package_valid) process.exit(EXIT.refused);
        process.exit(report.verdicts.some((v) => v.verdict === "FAILED") ? EXIT.diagnostics : EXIT.ok);
      } catch (error) {
        fatal(error);
      }
    });
}

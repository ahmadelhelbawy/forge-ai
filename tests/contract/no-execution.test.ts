/**
 * `AC-020` / `INV-004`: no code path executes a command derived from an IR or
 * a package.
 *
 * This criterion has been in `spec.md` since P0 and has never had a test — a
 * gap that mattered little while FORGE only rendered text, and matters a great
 * deal now that it emits a `verification.json` full of command strings and a
 * runtime contract describing what an executor would need. The temptation this
 * guards against is concrete and will arrive: "it would be so useful if
 * `forge package` just ran the tests".
 *
 * The check is **static and structural**, over the shipped core. It asserts two
 * things:
 *
 *  1. No module under `src/` imports a process-spawning API, with a small
 *     allowlist of modules that legitimately shell out for reasons unrelated to
 *     an IR — and each allowlisted module is named here with its reason, so the
 *     list cannot quietly grow.
 *  2. The values that an executor would run — `verification[].spec`, the
 *     runtime contract's tool names — never reach a spawn call, which follows
 *     from (1) for every module that is not allowlisted.
 *
 * A static test is the right shape here. A runtime test could only prove that
 * execution did not happen on one input; this proves the capability is absent.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO_ROOT, "src");

/**
 * Modules permitted to spawn a process, each for a reason that has nothing to
 * do with an IR or a package. Adding an entry is a deliberate act that must be
 * justified here, in this list, where a reviewer will see it.
 */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  [
    "context/retrievers/ripgrep.ts",
    "runs `rg` to FIND candidate files (FR-025). Its arguments are query terms " +
      "derived from instruction nodes and scope globs; its output is read as data. " +
      "It never runs anything an IR asked for.",
  ],
  [
    "context/retrievers/git-history.ts",
    "runs `git log` over paths inside the resolved scope (FR-025). Fixed " +
      "subcommand, path arguments only, output read as data.",
  ],
  [
    "context/secrets.ts",
    "probes for an optional `gitleaks` binary as defense in depth (SC-R6). It runs " +
      "`gitleaks version` with literal arguments and nothing from any IR.",
  ],
]);

const SPAWN_PATTERN =
  /\b(execFileSync|execFile|execSync|spawnSync|spawn|fork)\b|require\(["']child_process["']\)|from\s+["']node:child_process["']/;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("FORGE cannot execute what it emits (INV-004, AC-020)", () => {
  const files = sourceFiles(SRC);

  it("finds the core to scan", () => {
    // Guards the scanner: a walker that found nothing would pass everything.
    expect(files.length).toBeGreaterThan(40);
  });

  it("spawns a process only from modules on the documented allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (ALLOWED.has(rel)) continue;
      if (SPAWN_PATTERN.test(readFileSync(file, "utf8"))) offenders.push(rel);
    }
    expect(
      offenders,
      `these modules can spawn a process and are not on the allowlist: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still exists and still spawns", () => {
    for (const [rel, reason] of ALLOWED) {
      const full = join(SRC, rel);
      const source = readFileSync(full, "utf8");
      expect(SPAWN_PATTERN.test(source), `${rel} no longer spawns; remove it from the allowlist`).toBe(
        true,
      );
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  /**
   * The specific temptation: the package modules hold every command string an
   * executor would run, so they are the likeliest place for execution to appear.
   */
  it("keeps the package and verification modules entirely free of execution", () => {
    for (const rel of [
      "package/assemble.ts",
      "package/export.ts",
      "package/schema.ts",
      "cli/package.ts",
      "cli/explain.ts",
      // V2-G: verification ingests evidence; it never produces it (EV-R1,
      // INV-004). These hold every command string an executor would run AND
      // decide what a run proved, so they are the likeliest place for "just
      // run it and see" to appear.
      "verify/contract.ts",
      "verify/evidence.ts",
      "verify/obligations.ts",
      "verify/verdict.ts",
      "cli/verify.ts",
    ]) {
      const source = readFileSync(join(SRC, rel), "utf8");
      expect(SPAWN_PATTERN.test(source), `${rel} can spawn a process`).toBe(false);
    }
  });

  it("keeps the workspace's verification surface free of execution too", () => {
    for (const rel of ["web/lib/verify.ts", "web/app/api/conversations/[id]/verify/route.ts"]) {
      const source = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(SPAWN_PATTERN.test(source), `${rel} can spawn a process`).toBe(false);
    }
  });

  it("says so in the package itself, not only in the specification", () => {
    // A consumer reading `verification.json` must not have to infer that FORGE
    // did not run these; the file states it (PK-R5).
    const assemble = readFileSync(join(SRC, "package", "assemble.ts"), "utf8");
    expect(assemble).toContain("executed_by_forge");
  });
});

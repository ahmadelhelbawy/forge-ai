/**
 * `forge package` — emit an Execution Package (`FR-040`, `FR-046`).
 *
 * The end of the pipeline `intent.md` has always described and FORGE has never
 * reached: a directory a developer or a CI job can hand to an external agent,
 * readable with JSON parsing and the published schema alone.
 *
 * It **executes nothing** (`INV-004`). `verification.json` is data; the runtime
 * contract declares and grants nothing; no command in either is ever run, and
 * `tests/contract/no-execution.test.ts` asserts statically that no code path
 * could.
 */
import { resolve } from "node:path";

import type { Command } from "commander";

import { compile } from "../compile/compile.js";
import { semanticHash } from "../ir/projection.js";
import { BUILTIN_PROFILE_DIR, builtinProfiles, loadProfilesFrom } from "../profile/registry.js";
import { assemblePackage } from "../package/assemble.js";
import { exportPackage, verifyRelocatable } from "../package/export.js";
import { EXIT, fatal } from "./errors.js";
import { readIr } from "./ir.js";

export function registerPackageCommand(program: Command): void {
  program
    .command("package")
    .description("Emit a portable Execution Package for a Task IR and target.")
    .requiredOption("--ir <path>", "path to a Task IR JSON file")
    .requiredOption("--target <profile>", "agent profile to compile for")
    .requiredOption("--out <dir>", "directory to write the package into")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--json", "machine-readable summary on stdout")
    .action((opts: { ir: string; target: string; out: string; profileDir?: string; json?: boolean }) => {
      try {
        const ir = readIr(opts.ir);
        const registry = opts.profileDir
          ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
          : builtinProfiles();
        const profile = registry.get(opts.target);
        const result = compile(ir, profile, { taskSlug: ir.objective.kind });

        const pkg = assemblePackage({
          ir,
          profile,
          result,
          // The one impure value in the whole assembly, and it reaches nothing
          // but `run.json` (`INV-013`).
          generatedAt: new Date().toISOString(),
        });

        // PK-R7 is checked before anything is written, so a package that would
        // leak a host path is never created rather than created and regretted.
        const leaks = verifyRelocatable(pkg);
        if (leaks.length > 0) {
          process.stderr.write(`Refusing to export: ${leaks.join("; ")}\n`);
          process.exit(EXIT.refused);
        }

        const exported = exportPackage(pkg, opts.out);

        if (opts.json) {
          process.stdout.write(
            `${JSON.stringify(
              {
                semantic_id: pkg.semanticId,
                ir_semantic_hash: semanticHash(ir),
                target: profile.id,
                refused: result.refused,
                root: exported.root,
                files: exported.paths,
              },
              null,
              2,
            )}\n`,
          );
        } else {
          process.stdout.write(`${pkg.semanticId}\n`);
          for (const path of exported.paths) process.stdout.write(`  ${path}\n`);
          process.stderr.write(
            `Wrote ${exported.paths.length} file(s) to ${exported.root}\n` +
              `FORGE executed nothing: verification.json is data and the runtime contract grants nothing (INV-004).\n`,
          );
        }

        // A refused compilation still produces a package — the diagnostics are
        // the useful part — but it exits 3 so a pipeline notices.
        process.exit(result.refused ? EXIT.refused : EXIT.ok);
      } catch (error) {
        fatal(error);
      }
    });
}

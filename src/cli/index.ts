#!/usr/bin/env node
/**
 * The FORGE command line (CLI-R1..CLI-R6).
 *
 * P1 surface: `compile`, `agents`, `ir`. P1.5 adds `task` (registered from
 * `./task.js`). A command is added in the phase that implements it, never before.
 *
 * Exit codes (CLI-R5): 0 ok · 1 error diagnostics · 2 usage · 3 refused · 4 internal.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Command } from "commander";

import { compile } from "../compile/compile.js";
import { checkIntegrity } from "../ir/integrity.js";
import { codesOf, hasErrors, type Diagnostic } from "../ir/diagnostic.js";
import { semanticHash } from "../ir/projection.js";
import { builtinProfiles, loadProfilesFrom, BUILTIN_PROFILE_DIR } from "../profile/registry.js";
import { resolveArchetype } from "../strategy/source.js";
import { builtinStrategies, StrategyNotFoundError } from "../strategy/registry.js";
import { EXIT, fatal } from "./errors.js";
import { readIr } from "./ir.js";
import { registerContextCommand } from "./context.js";
import { registerStrategiesCommand } from "./strategies.js";
import { registerTaskCommand } from "./task.js";

function registryFor(profileDir?: string) {
  return profileDir ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(profileDir)) : builtinProfiles();
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  if (diagnostics.length === 0) {
    process.stderr.write("No diagnostics.\n");
    return;
  }
  const sorted = [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
  for (const d of sorted) {
    const cited = d.evidence
      .map((e) =>
        e.kind === "node"
          ? e.node_id
          : e.kind === "measure"
            ? `${e.label}=${e.value}${e.unit}`
            : `${e.artifact_path}:${e.start}-${e.end}`,
      )
      .join(" ");
    process.stderr.write(`${d.severity}[${d.code}] ${d.name}: ${d.message}\n  evidence: ${cited}\n`);
  }
}

const program = new Command();
program
  .name("forge")
  .description("Compile a Task IR into agent-specific execution artifacts.")
  .version("0.1.0-alpha.0")
  // CLI-R5: a usage error exits 2. Commander's default is 1, which collides with
  // "diagnostics at error severity" and would make an unparseable command line
  // indistinguishable from a task that failed its checks. `--help` and `--version`
  // still exit 0.
  .exitOverride((err) => process.exit(err.exitCode === 0 ? EXIT.ok : EXIT.usage));

/* ------------------------------- forge ir -------------------------------- */

const ir = program.command("ir").description("Inspect and validate a Task IR.");

ir.command("validate")
  .argument("<path>", "path to a Task IR JSON file")
  .option("--strict", "treat warnings as errors")
  .option("--json", "machine-readable output")
  .action((path: string, opts: { strict?: boolean; json?: boolean }) => {
    const parsed = readIr(path);
    const diagnostics = checkIntegrity(parsed);
    const failed = opts.strict ? diagnostics.length > 0 : hasErrors(diagnostics);
    if (opts.json) {
      process.stdout.write(
        `${JSON.stringify({ semantic_hash: semanticHash(parsed), diagnostics, ok: !failed }, null, 2)}\n`,
      );
    } else {
      process.stdout.write(`${semanticHash(parsed)}\n`);
      printDiagnostics(diagnostics);
    }
    process.exit(failed ? EXIT.diagnostics : EXIT.ok);
  });

ir.command("hash")
  .argument("<path>", "path to a Task IR JSON file")
  .action((path: string) => {
    process.stdout.write(`${semanticHash(readIr(path))}\n`);
  });

ir.command("show")
  .argument("<path>", "path to a Task IR JSON file")
  .action((path: string) => {
    process.stdout.write(`${JSON.stringify(readIr(path), null, 2)}\n`);
  });

/* ----------------------------- forge agents ------------------------------ */

const agents = program
  .command("agents")
  .description("List available agent profiles.")
  .option("--profile-dir <dir>", "additional directory of profile YAML files")
  .option("--json", "machine-readable output")
  .action((opts: { profileDir?: string; json?: boolean }) => {
    const registry = registryFor(opts.profileDir);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(registry.all, null, 2)}\n`);
      return;
    }
    for (const profile of registry.all) {
      process.stdout.write(
        `${profile.id.padEnd(20)} ${profile.fidelity.padEnd(16)} ` +
          `search=${profile.retrieval.autonomous_search.padEnd(6)} ` +
          `${profile.output.artifacts.length} artifact(s)\n`,
      );
    }
  });

agents
  .command("show")
  .argument("<id>", "profile id")
  .option("--profile-dir <dir>", "additional directory of profile YAML files")
  .action((id: string, opts: { profileDir?: string }) => {
    const profile = registryFor(opts.profileDir).get(id);
    process.stdout.write(`${profile.display_name} (${profile.id}) v${profile.version}\n`);
    process.stdout.write(`  fidelity          ${profile.fidelity}\n`);
    process.stdout.write(`  verified against  ${profile.verified_against}\n`);
    process.stdout.write(`  autonomous search ${profile.retrieval.autonomous_search}\n`);
    process.stdout.write(`  artifacts\n`);
    for (const a of profile.output.artifacts) {
      process.stdout.write(`    ${a.path}  [${a.sections.join(", ")}]\n`);
    }
    if (profile.limits.known_gaps.length > 0) {
      process.stdout.write(`  known gaps\n`);
      for (const gap of profile.limits.known_gaps) process.stdout.write(`    - ${gap}\n`);
    }
  });

/* ----------------------------- forge compile ----------------------------- */

program
  .command("compile")
  .description("Compile a Task IR for one target.")
  .requiredOption("--ir <path>", "path to a Task IR JSON file")
  .requiredOption("--target <profile>", "agent profile id")
  .option("--out <dir>", "write artifacts to this directory")
  .option("--profile-dir <dir>", "additional directory of profile YAML files")
  .option("--task-slug <slug>", "value for the {task_slug} path variable")
  .option("--strategy <archetype>", "apply a strategy overlay before compiling (P4)")
  .option("--strict", "treat warnings as errors")
  .option("--json", "machine-readable output")
  .action(
    (opts: {
      ir: string;
      target: string;
      out?: string;
      profileDir?: string;
      taskSlug?: string;
      strategy?: string;
      strict?: boolean;
      json?: boolean;
    }) => {
      const parsed = readIr(opts.ir);
      const profile = registryFor(opts.profileDir).get(opts.target);
      const overlay = opts.strategy === undefined
        ? null
        : (() => {
            const strategies = builtinStrategies();
            const id = opts.strategy as string;
            if (!strategies.has(id)) throw new StrategyNotFoundError(id, strategies.ids);
            // ST-R6: the user chooses. An explicit choice applies even at
            // fit score 0; the rationale says so honestly.
            const { overlay, candidate } = resolveArchetype(strategies.get(id), parsed, profile);
            process.stderr.write(
              `strategy: ${candidate ? candidate.rationale : `${id} selected explicitly (fit score 0)`}\n`,
            );
            return overlay;
          })();
      const result = compile(parsed, profile, { taskSlug: opts.taskSlug, overlay });

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        for (const artifact of result.artifacts) {
          process.stdout.write(`--- ${artifact.path} (${artifact.content_hash}) ---\n`);
          if (!opts.out) process.stdout.write(artifact.content);
        }
        printDiagnostics(result.diagnostics);
      }

      if (opts.out && !result.refused) {
        for (const artifact of result.artifacts) {
          const target = join(resolve(opts.out), artifact.path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, artifact.content, "utf8");
        }
        process.stderr.write(
          `Wrote ${result.artifacts.length} artifact(s) to ${resolve(opts.out)}\n`,
        );
      }

      if (result.refused) process.exit(EXIT.refused);
      const failed = opts.strict ? result.diagnostics.length > 0 : hasErrors(result.diagnostics);
      process.exit(failed ? EXIT.diagnostics : EXIT.ok);
    },
  );

registerContextCommand(program);
registerStrategiesCommand(program);
registerTaskCommand(program);

// `parseAsync`, not `parse`: a synchronous try/catch cannot observe a rejected promise
// from an async action handler, so an async command (`forge task`, P1.5) would escape
// the handler entirely and lose its CLI-R5 exit code. Wiring it now means the primary
// P1.5 command inherits correct behaviour instead of needing it retrofitted.
program.parseAsync().catch(fatal);

export { codesOf };

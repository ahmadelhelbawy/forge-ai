/**
 * `forge strategies` — deterministic strategy candidates (FR-032, FR-038).
 *
 * Shows fit-ranked archetype candidates with the rationale that selected
 * each (FR-033). With `--target`, every candidate is compiled and ranked by
 * the published lexicographic rule, naming the step that decided (DG-R6).
 * Without `--target`, fit uses claude-code as the reference target (stated
 * in any profile-dependent rationale line). Selection is never fully
 * automatic (ST-R6): FORGE presents, the user chooses, and
 * `forge compile --strategy <id>` applies the choice.
 *
 * Exit codes (CLI-R5): 0 ok · 2 usage · 4 internal.
 */
import { resolve } from "node:path";

import type { Command } from "commander";

import { compile } from "../compile/compile.js";
import { DEFAULT_TOKEN_ESTIMATOR } from "../compile/tokenizer.js";
import { rankStrategies } from "../critic/rank.js";
import { builtinProfiles, loadProfilesFrom, BUILTIN_PROFILE_DIR } from "../profile/registry.js";
import { ArchetypeSource } from "../strategy/source.js";
import { builtinStrategies } from "../strategy/registry.js";
import { checkDistinctness } from "../strategy/distinctness.js";
import { EXIT, exitCodeFor } from "./errors.js";
import { readIr } from "./ir.js";

/** Reference target for target-less fit: the dogfooding profile. */
const REFERENCE_TARGET = "claude-code";

export function registerStrategiesCommand(program: Command): void {
  program
    .command("strategies")
    .description("Show deterministic strategy candidates for a Task IR.")
    .requiredOption("--ir <path>", "path to a Task IR JSON file")
    .option("--target <profile>", "rank candidates by compiling for this target (lexicographic rule)")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--json", "machine-readable output")
    .action(
      (opts: { ir: string; target?: string; profileDir?: string; json?: boolean }) => {
        try {
          const ir = readIr(opts.ir);
          const registry = builtinStrategies();
          const profiles = opts.profileDir
            ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
            : builtinProfiles();
          const reference = profiles.get(opts.target ?? REFERENCE_TARGET);
          const candidates = new ArchetypeSource(registry).propose(ir, reference);
          const distinctness = checkDistinctness(candidates.map((c) => c.overlay));

          let ranking = null;
          if (opts.target !== undefined) {
            const profile = profiles.get(opts.target);
            const entries = candidates.map((c) => {
              const result = compile(ir, profile, { taskSlug: "strategies", overlay: c.overlay });
              const estTokens = result.artifacts.reduce(
                (sum, a) => sum + DEFAULT_TOKEN_ESTIMATOR.count(a.content),
                0,
              );
              return { archetype: c.overlay.archetypeId, diagnostics: result.diagnostics, estTokens };
            });
            ranking = rankStrategies(entries);
          }

          if (opts.json === true) {
            process.stdout.write(
              `${JSON.stringify({ candidates, distinctness, ranking }, null, 2)}\n`,
            );
          } else {
            for (const c of candidates) {
              process.stdout.write(`${c.overlay.archetypeId} (fit score ${c.score})\n  ${c.rationale}\n`);
            }
            const minPair = distinctness.pairs[0];
            if (minPair) {
              process.stdout.write(
                `distinctness: min pairwise distance ${minPair.distance.toFixed(2)} (${minPair.a}-${minPair.b})\n`,
              );
            }
            if (distinctness.rejected.length > 0) {
              process.stdout.write(
                `rejected as duplicates: ${distinctness.rejected.map((r) => `${r.a}/${r.b}`).join(", ")}\n`,
              );
            }
            if (ranking !== null) {
              process.stdout.write(`rank: ${ranking.order.join(" > ") || "(none survived)"}\n`);
              process.stdout.write(`decided by: ${ranking.decidedBy}\n`);
              if (ranking.disqualified.length > 0) {
                process.stdout.write(`disqualified: ${ranking.disqualified.join(", ")}\n`);
              }
            }
          }
          process.exit(EXIT.ok);
        } catch (error) {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(exitCodeFor(error));
        }
      },
    );
}

/**
 * `forge context resolve` — inspect retrieval and justification (FR-026).
 *
 * Reads a Task IR, resolves context against a workspace, and prints the
 * ranked, justified references plus the run record (scores, drops,
 * redactions, provenance). Optionally attempts evidence-first answers to
 * the IR's open questions.
 *
 * Exit codes (CLI-R5): 0 ok · 2 usage · 4 internal. Resolution itself has
 * no error diagnostics: drops and rejections are recorded data, not
 * failures, so a resolution that retains nothing still exits 0 and says so.
 */
import { resolve } from "node:path";

import type { Command } from "commander";

import { disambiguate, type EvidenceCandidate } from "../context/disambiguate.js";
import { resolveContext } from "../context/resolve.js";
import { GuardDeniedError, WorkspaceGuard } from "../context/workspace.js";
import { EXIT, exitCodeFor } from "./errors.js";
import { collectFiles, readIr } from "./ir.js";

export function registerContextCommand(program: Command): void {
  const context = program.command("context").description("Inspect context resolution.");

  context
    .command("resolve")
    .description("Resolve justified context references for a Task IR.")
    .requiredOption("--ir <path>", "path to a Task IR JSON file")
    .requiredOption("--workspace <dir>", "workspace root to resolve against")
    .option("--max-refs <n>", "keep at most N references", String)
    .option("--file <path>", "explicit file to include (repeatable)", collectFiles, [] as string[])
    .option("--justifies <ids>", "justification ids for the preceding --file (repeatable)", collectFiles, [] as string[])
    .option("--answer-questions", "attempt evidence-first answers to open questions")
    .option("--json", "machine-readable output")
    .action(
      (opts: {
        ir: string;
        workspace: string;
        maxRefs?: string;
        file: string[];
        justifies: string[];
        answerQuestions?: boolean;
        json?: boolean;
      }) => {
        try {
          const ir = readIr(opts.ir);
          const guard = WorkspaceGuard.open(resolve(opts.workspace));
          if (opts.file.length !== opts.justifies.length) {
            const error = new Error(
              `each --file needs exactly one --justifies (got ${opts.file.length} file(s), ${opts.justifies.length} justifies).`,
            );
            error.name = "CommanderError";
            throw error;
          }
          const explicit = opts.file.map((path, i) => ({
            path,
            justifies: (opts.justifies[i] as string).split(",").map((s) => s.trim()).filter((s) => s.length > 0),
          }));
          const maxRefs = opts.maxRefs === undefined ? undefined : Number.parseInt(opts.maxRefs, 10);
          if (maxRefs !== undefined && !(maxRefs > 0)) {
            const error = new Error(`--max-refs must be a positive integer (got ${opts.maxRefs}).`);
            error.name = "CommanderError";
            throw error;
          }
          const { refs, run } = resolveContext(ir, guard, { maxRefs, explicit });

          let disambiguation = undefined;
          if (opts.answerQuestions === true) {
            const evidence: EvidenceCandidate[] = [];
            for (const ref of refs) {
              const read = guard.readText(ref.uri.slice("forge://".length));
              evidence.push({ refId: ref.id, uri: ref.uri, role: ref.role, trust: ref.trust, content: read.content });
            }
            disambiguation = disambiguate(ir.open_questions, evidence);
          }

          if (opts.json === true) {
            process.stdout.write(`${JSON.stringify({ refs, run, disambiguation: disambiguation ?? null }, null, 2)}\n`);
          } else {
            if (refs.length === 0) {
              process.stdout.write("No justified references. Nothing in the workspace matched a node query.\n");
            }
            for (const ref of refs) {
              const score = run.scores.find((s) => s.refId === ref.id);
              process.stdout.write(
                `${ref.id} [${ref.role} | ${ref.trust}] ${ref.uri} (for ${ref.justifies.join(", ")}, score=${score?.score.toFixed(3) ?? "n/a"})\n`,
              );
            }
            if (run.dropped.length > 0) {
              process.stdout.write(`Dropped ${run.dropped.length} candidate(s):\n`);
              for (const drop of run.dropped) {
                process.stdout.write(`  - ${drop.relPath} (${drop.reason}: ${drop.detail})\n`);
              }
            }
            if (disambiguation !== undefined) {
              for (const a of disambiguation.answered) {
                process.stdout.write(`Answered ${a.questionId}: ${a.answer}\n`);
              }
              for (const e of disambiguation.escalated) {
                process.stdout.write(`Escalate ${e.questionId} [${e.reason}]: ${e.detail}\n`);
              }
            }
          }
          process.exit(EXIT.ok);
        } catch (error) {
          process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
          // A denied workspace (missing root, jail escape) is the user's
          // path being wrong, not an internal fault (CLI-R5).
          if (error instanceof GuardDeniedError) process.exit(EXIT.usage);
          process.exit(exitCodeFor(error));
        }
      },
    );
}

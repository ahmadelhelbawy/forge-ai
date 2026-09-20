/**
 * `forge task` — the P3 pipeline (FR-001–FR-004).
 *
 * Natural language → intent.extract → context resolution (P2, when
 * --workspace) → evidence-backed answers → remaining blocking questions
 * (interactive, or halt under --yes) → one refine round → compile.
 *
 * Exit codes (CLI-R5): 0 ok · 1 error diagnostics · 2 usage · 3 refused · 4 internal.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import type { Command } from "commander";

import { compile } from "../compile/compile.js";
import { resolveContext, type ResolutionRun } from "../context/resolve.js";
import { disambiguate, type AnsweredQuestion, type EvidenceCandidate } from "../context/disambiguate.js";
import { GuardDeniedError, WorkspaceGuard } from "../context/workspace.js";
import {
  BoundaryError,
  NoModelSourceError,
  extractIntent,
  refineIntent,
  type ClarificationAnswer,
  type ExtractDeps,
  type ExtractResult,
} from "../intent/extract.js";
import {
  applyEvidenceAnswers,
  applyUserAnswers,
  finalizeNonBlocking,
  routeQuestions,
  type QuestionResolution,
} from "../intent/clarify.js";
import { collectSignals, type RepoSignals } from "../intent/signals.js";
import { hasErrors, type Diagnostic } from "../ir/diagnostic.js";
import { semanticHash } from "../ir/projection.js";
import type { ContextRef, OpenQuestion, TaskIR } from "../ir/schema.js";
import { AnthropicProvider } from "../model/anthropic.js";
import { OpenAiCompatProvider } from "../model/openai-compat.js";
import type { ModelProvider } from "../model/provider.js";
import { builtinProfiles, loadProfilesFrom, BUILTIN_PROFILE_DIR } from "../profile/registry.js";
import { EXIT, exitCodeFor } from "./errors.js";
import { collectFiles } from "./ir.js";

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

export interface ProviderSelection {
  readonly provider: ModelProvider | undefined;
  /** Selection summary for logs. Contains NO secret material — never a key. */
  readonly summary: string;
}

/**
 * Provider selection is EXTERNAL configuration (NFR-003): FORGE never couples
 * to a vendor. An explicit `FORGE_PROVIDER` wins; otherwise the legacy keys
 * preserve previous behaviour. Returns undefined (not a guess) when no source
 * is configured — the caller refuses loudly (CLI-R4).
 */
export function selectProvider(
  opts: { model?: string },
  env: NodeJS.ProcessEnv = process.env,
): ProviderSelection {
  // Empty strings count as unset: several harnesses (including our own CLI
  // test helper) clear credentials by exporting them empty rather than
  // unsetting them. Treating "" as a configured value would turn a cleared
  // credential into an "unknown provider" usage error.
  const forgeProvider = env["FORGE_PROVIDER"] || undefined;
  if (forgeProvider !== undefined) {
    if (forgeProvider === "openai-compatible") {
      const apiKey = env["FORGE_API_KEY"] || env["OPENAI_API_KEY"] || "";
      if (!apiKey) return { provider: undefined, summary: "openai-compatible (no key configured)" };
      return {
        provider: new OpenAiCompatProvider(
          apiKey,
          env["FORGE_BASE_URL"] || env["OPENAI_BASE_URL"],
          opts.model ?? (env["FORGE_MODEL"] || undefined),
        ),
        summary: `openai-compatible base=${env["FORGE_BASE_URL"] || env["OPENAI_BASE_URL"] || "(default)"} model=${opts.model ?? (env["FORGE_MODEL"] || "(provider default)")}`,
      };
    }
    if (forgeProvider === "anthropic") {
      const apiKey = env["FORGE_API_KEY"] || env["ANTHROPIC_API_KEY"] || "";
      if (!apiKey) return { provider: undefined, summary: "anthropic (no key configured)" };
      return {
        provider: new AnthropicProvider(apiKey, opts.model ?? (env["FORGE_MODEL"] || undefined)),
        summary: `anthropic model=${opts.model ?? (env["FORGE_MODEL"] || "(provider default)")}`,
      };
    }
    throw new BoundaryError(
      `Unknown FORGE_PROVIDER ${JSON.stringify(forgeProvider)} — expected "openai-compatible" or "anthropic".`,
    );
  }
  if (env["ANTHROPIC_API_KEY"]) {
    return {
      provider: new AnthropicProvider(env["ANTHROPIC_API_KEY"], opts.model ?? (env["FORGE_MODEL"] || undefined)),
      summary: `anthropic model=${opts.model ?? (env["FORGE_MODEL"] || "(provider default)")}`,
    };
  }
  if (env["OPENAI_API_KEY"] ?? env["OPENAI_BASE_URL"]) {
    return {
      provider: new OpenAiCompatProvider(env["OPENAI_API_KEY"] ?? "unused"),
      summary: "openai-compatible (legacy env)",
    };
  }
  return { provider: undefined, summary: "(no provider configured)" };
}

export interface TaskOptions {
  target: string;
  out?: string;
  cassette?: string;
  profileDir?: string;
  taskSlug?: string;
  model?: string;
  strict?: boolean;
  json?: boolean;
  /** Commander negation: `--no-llm` arrives as `llm === false`, not `noLlm`. */
  llm?: boolean;
  /** Fail on blocking questions instead of asking (FR-004). */
  yes?: boolean;
  /** Workspace root for context resolution and evidence (P2 engine). */
  workspace?: string;
  /** Explicit files to include; each needs a matching --justifies (FR-001). */
  file?: string[];
  justifies?: string[];
  maxRefs?: string;
}

export function registerTaskCommand(program: Command): void {
  program
    .command("task")
    .description("Compile a natural-language task into agent-specific artifacts.")
    .argument("<text>", "the task in the user's own words")
    .requiredOption("--target <profile>", "agent profile id")
    .option("--out <dir>", "write artifacts to this directory")
    .option("--cassette <dir>", "replay/record directory for the intent boundary (offline without a key)")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--task-slug <slug>", "value for the {task_slug} path variable")
    .option("--model <id>", "model id (default: provider default, or FORGE_MODEL)")
    .option("--strict", "treat warnings as errors")
    .option("--json", "machine-readable output")
    .option("--no-llm", "refuse any model boundary (CLI-R4)")
    .option("--yes", "fail on blocking questions instead of asking (FR-004)")
    .option("--workspace <dir>", "workspace root for context resolution and evidence")
    .option("--file <path>", "explicit file to include (repeatable; needs --justifies)", collectFiles, [] as string[])
    .option("--justifies <ids>", "comma-separated justification ids for the preceding --file", collectFiles, [] as string[])
    .option("--max-refs <n>", "keep at most N context references")
    .action(async (text: string, opts: TaskOptions) => {
      try {
        await runTask(text, opts);
      } catch (error) {
        if (error instanceof NoModelSourceError || (error as { name?: string }).name === "CassetteMissError") {
          process.stderr.write(`${(error as Error).message}\n`);
          process.exit(EXIT.refused);
        }
        if ((error as { name?: string }).name === "BoundaryError") {
          process.stderr.write(`${(error as Error).message}\n`);
          process.exit(EXIT.usage);
        }
        // Usage-shape failures (unknown target, malformed profile, …) exit 2
        // via the shared allowlist; anything else is loud and internal.
        const code = exitCodeFor(error);
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`forge task failed: ${message}\n`);
        if (code === EXIT.internal && error instanceof Error && error.stack) {
          process.stderr.write(`${error.stack}\n`);
        }
        process.exit(code);
      }
    });
}

function printBlocking(blocking: readonly OpenQuestion[]): void {
  for (const q of blocking) {
    process.stderr.write(`blocking[${q.id}]: ${q.question}\n`);
    if (q.options.length > 0) {
      for (const option of q.options) process.stderr.write(`  - ${option}\n`);
    }
  }
}

/** Re-read resolved refs as evidence. Guarded reads only — by construction. */
function readEvidence(guard: WorkspaceGuard, refs: readonly ContextRef[]): EvidenceCandidate[] {
  return refs.map((ref) => {
    const read = guard.readText(ref.uri.slice("forge://".length));
    return { refId: ref.id, uri: ref.uri, role: ref.role, trust: ref.trust, content: read.content };
  });
}

/**
 * Ask blocking questions interactively. A numeric reply selects an option;
 * anything else is taken verbatim. Empty replies skip (the caller halts on
 * the uncovered remainder). One round only — no loops.
 */
async function askQuestions(blocking: readonly OpenQuestion[]): Promise<Map<string, string>> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answers = new Map<string, string>();
  try {
    for (const q of blocking) {
      process.stderr.write(`blocking[${q.id}]: ${q.question}\n`);
      q.options.forEach((option, index) => process.stderr.write(`  ${index + 1}. ${option}\n`));
      const raw = (await rl.question("answer (empty skips): ")).trim();
      if (raw === "") continue;
      const n = Number.parseInt(raw, 10);
      answers.set(
        q.id,
        q.options.length > 0 && Number.isInteger(n) && n >= 1 && n <= q.options.length
          ? (q.options[n - 1] as string)
          : raw,
      );
    }
  } finally {
    rl.close();
  }
  return answers;
}

interface EvidencePass {
  readonly ir: TaskIR;
  readonly run: ResolutionRun;
  readonly resolutions: readonly QuestionResolution[];
}

async function runTask(text: string, opts: TaskOptions): Promise<never> {
  if (opts.llm === false) {
    process.stderr.write("forge task refuses under --no-llm: intent extraction needs a model (CLI-R4).\n");
    process.exit(EXIT.refused);
  }

  const selection = selectProvider(opts);
  process.stderr.write(`provider: ${selection.summary}\n`);
  // One volatile gateway session per invocation, shared by the initial call
  // and its repair. Headers only — never prompt, IR, or hash.
  const sessionHeader = process.env["FORGE_SESSION_HEADER"] || undefined;
  const deps: ExtractDeps = {
    provider: selection.provider,
    model: opts.model,
    cassetteDir: opts.cassette,
    sessionHeaders: sessionHeader !== undefined ? { [sessionHeader]: randomUUID() } : undefined,
  };
  const extracted = await extractIntent(text, deps);
  let ir = extracted.ir;
  let refineRecord: ExtractResult["record"] | null = null;
  const clarification: QuestionResolution[] = [];
  let contextRun: ResolutionRun | null = null;

  // A denied workspace is the user's path being wrong (usage).
  let guard: WorkspaceGuard | null = null;
  let signals: RepoSignals | undefined;
  if (opts.workspace !== undefined) {
    try {
      guard = WorkspaceGuard.open(resolve(opts.workspace));
    } catch (error) {
      if (error instanceof GuardDeniedError) {
        process.stderr.write(`${(error as Error).message}\n`);
        process.exit(EXIT.usage);
      }
      throw error;
    }
    signals = collectSignals(guard);
  }
  const files = opts.file ?? [];
  const justifiesList = opts.justifies ?? [];
  if (files.length !== justifiesList.length) {
    throw new BoundaryError(
      `each --file needs exactly one --justifies (got ${files.length} file(s), ${justifiesList.length} justifies).`,
    );
  }
  const explicit = files.map((path, i) => ({
    path,
    justifies: (justifiesList[i] as string)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  }));
  const maxRefs = opts.maxRefs === undefined ? undefined : Number.parseInt(opts.maxRefs, 10);
  if (maxRefs !== undefined && !(maxRefs > 0)) {
    throw new BoundaryError(`--max-refs must be a positive integer (got ${opts.maxRefs}).`);
  }

  // The post-refine pass re-grounds against the restructured IR, whose
  // node ids differ — stale justifies would dangle (C010).
  const evidencePass = (current: TaskIR, via: WorkspaceGuard): EvidencePass => {
    const resolved = resolveContext(current, via, { maxRefs, explicit });
    const merged: TaskIR = { ...current, context_refs: [...resolved.refs] };
    const dis = disambiguate(merged.open_questions, readEvidence(via, resolved.refs));
    for (const a of dis.answered) {
      process.stderr.write(
        `evidence: ${a.questionId} answered from ${a.evidence.map((e) => e.refId).join(", ")}.\n`,
      );
    }
    for (const e of dis.escalated) {
      process.stderr.write(`evidence: ${e.questionId} stays open [${e.reason}].\n`);
    }
    const applied = applyEvidenceAnswers(merged, dis.answered);
    return { ir: applied.ir, run: resolved.run, resolutions: applied.resolutions };
  };

  // Evidence before escalation (P1.6): resolvable questions never reach
  // the human. Superseded below when a refine restructures the IR.
  let provisional: readonly QuestionResolution[] = [];
  if (guard) {
    const pass = evidencePass(ir, guard);
    ir = pass.ir;
    contextRun = pass.run;
    provisional = pass.resolutions;
  }

  const blocking = routeQuestions(ir).blocking;
  if (blocking.length > 0) {
    if (opts.yes === true || process.stdin.isTTY !== true) {
      printBlocking(blocking);
      process.exit(EXIT.refused);
    }
    const userAnswers = await askQuestions(blocking);
    const uncovered = blocking.filter((q) => !userAnswers.has(q.id));
    if (uncovered.length > 0) {
      printBlocking(uncovered);
      process.exit(EXIT.refused);
    }
    const clar: ClarificationAnswer[] = blocking.map((q) => ({
      questionId: q.id,
      question: q.question,
      answer: userAnswers.get(q.id) as string,
    }));
    const refined: ExtractResult = await refineIntent(
      text,
      extracted.draft,
      clar,
      deps,
      signals ? { signals } : {},
    );
    refineRecord = refined.record;
    process.stderr.write(
      `intent.extract refine via ${refineRecord.provider}/${refineRecord.model} ` +
        `(repairs=${refineRecord.repairs}, replayed=${refineRecord.replayed}, latency=${refineRecord.latencyMs}ms)\n`,
    );
    ir = refined.ir;
    let fresh: readonly QuestionResolution[] = [];
    if (guard) {
      const pass = evidencePass(ir, guard);
      ir = pass.ir;
      contextRun = pass.run;
      fresh = pass.resolutions;
    }
    for (const c of clar) {
      if (!ir.open_questions.some((q) => q.id === c.questionId)) {
        clarification.push({
          questionId: c.questionId,
          disposition: "ANSWERED_FROM_USER",
          detail: "incorporated by the refine boundary into task structure.",
        });
      }
    }
    const remaining = new Map(
      [...userAnswers].filter(([qid]) => ir.open_questions.some((q) => q.id === qid)),
    );
    const backstop = applyUserAnswers(ir, remaining);
    ir = backstop.ir;
    clarification.push(...fresh, ...backstop.resolutions);
  } else {
    clarification.push(...provisional);
  }
  const fin = finalizeNonBlocking(ir);
  ir = fin.ir;
  clarification.push(...fin.resolutions);
  for (const r of clarification) {
    process.stderr.write(`clarify[${r.disposition}]: ${r.questionId} — ${r.detail}\n`);
  }
  const record = extracted.record;
  process.stderr.write(
    `intent.extract via ${record.provider}/${record.model} ` +
      `(repairs=${record.repairs}, replayed=${record.replayed}, latency=${record.latencyMs}ms)\n`,
  );

  const registry = opts.profileDir
    ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
    : builtinProfiles();
  const profile = registry.get(opts.target);
  const result = compile(ir, profile, { taskSlug: opts.taskSlug });
  const hash = semanticHash(ir);

  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          semantic_hash: hash,
          ir,
          artifacts: result.artifacts.map((a) => ({ path: a.path, content_hash: a.content_hash })),
          diagnostics: result.diagnostics,
          model_call: record,
          refine_call: refineRecord,
          clarification,
          context_run: contextRun,
          refused: result.refused,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    process.stdout.write(`${hash}\n`);
    if (!result.refused) {
      for (const artifact of result.artifacts) {
        process.stdout.write(`--- ${artifact.path} (${artifact.content_hash}) ---\n`);
        if (!opts.out) process.stdout.write(artifact.content);
      }
    }
    printDiagnostics(result.diagnostics);
  }

  if (opts.out && !result.refused) {
    for (const artifact of result.artifacts) {
      const target = join(resolve(opts.out), artifact.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, artifact.content, "utf8");
    }
    process.stderr.write(`Wrote ${result.artifacts.length} artifact(s) to ${resolve(opts.out)}\n`);
  }

  if (result.refused) process.exit(EXIT.refused);
  const failed = opts.strict ? result.diagnostics.length > 0 : hasErrors(result.diagnostics);
  process.exit(failed ? EXIT.diagnostics : EXIT.ok);
}

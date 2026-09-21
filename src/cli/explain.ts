/**
 * `forge explain` — render the trace instead of the artifact (V2-R step 8).
 *
 * FORGE's strongest claim is that every byte of every artifact is attributable
 * to a named origin, and `verifyCoverage()` has enforced it since P1. Until now
 * there was no way for a user to SEE that. `explain` is the window: it
 * recompiles the IR (deterministic, sub-100ms, no persistence and no model
 * call) and prints where each byte came from, which constraints reached which
 * sections, and what the compiler decided along the way.
 *
 * With `--package` it also renders the requirement traceability chain (V2-H,
 * §22.10 TM-R4) through the same `buildTraceabilityMatrix` the Studio uses —
 * one explanation engine, not two. `--workspace` reads a repository only
 * through `WorkspaceGuard`; `--governance` applies human decisions by the same
 * rules as the workspace. Still no model call.
 *
 * It is pure presentation of facts `CompileResult` already carries. It infers
 * nothing, scores nothing (INV-008) and recomputes nothing the compiler did not
 * already compute. If a line here is not backed by a field of `CompileResult`,
 * it does not belong in this file.
 *
 * Section attribution is DERIVED, and the derivation is stated rather than
 * hidden: `Span` carries an origin but no section key, and only
 * `renderer_template` origins name one. So a span is attributed to the section
 * of the nearest `renderer_template` span at or before it. Every section starts
 * with its heading, which is a `renderer_template` span, so in practice this is
 * exact — but it is a derivation, and a reader should know that.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Command } from "commander";

import { compile } from "../compile/compile.js";
import type { CompileResult } from "../compile/types.js";
import { semanticHash } from "../ir/projection.js";
import type { TaskIR } from "../ir/schema.js";
import { BUILTIN_PROFILE_DIR, builtinProfiles, loadProfilesFrom } from "../profile/registry.js";
import type { Span, TraceOrigin } from "../trace/span.js";
import { WorkspaceGuard } from "../context/workspace.js";
import type { LedgerEntry } from "../critic/deterministic/ledger.js";
import { contentHash } from "../ir/canonical.js";
import { parseTaskIR } from "../ir/schema.js";
import { governRequirements, parseGovernanceFile, recordDecisions, type GovernanceRecord } from "../requirement/governance.js";
import { linkRequirements, type AuthoritativeLink } from "../requirement/linkage.js";
import {
  buildTraceabilityMatrix,
  type MatrixObligation,
  type MatrixSpan,
  type TraceabilityMatrix,
} from "../requirement/traceability.js";
import { EXIT, fatal } from "./errors.js";
import { readIr } from "./ir.js";
import { REPORT_CAVEAT, verifyDirectory, writeVerdicts, type VerdictReport } from "./verify.js";

/** One line per origin kind, in the vocabulary the trace itself uses. */
function describeOrigin(origin: TraceOrigin): string {
  switch (origin.kind) {
    case "ir_node":
      return `ir_node ${origin.node_id}`;
    case "strategy":
      return `strategy ${origin.strategy_id} (${origin.overlay_path})`;
    case "agent_profile":
      return `agent_profile ${origin.profile_id} (${origin.profile_path})`;
    case "context_ref":
      return `context_ref ${origin.ref_id} [${origin.materialization}]`;
    case "compiler_rule":
      return `compiler_rule ${origin.rule_id}`;
    case "renderer_template":
      return `renderer_template ${origin.renderer_id}:${origin.section_key}.${origin.slot}`;
  }
}

/** The derived section key for each span. See the file header for the rule. */
function sectionKeys(spans: readonly Span[]): string[] {
  let current = "(before the first section)";
  return spans.map((span) => {
    if (span.origin.kind === "renderer_template") current = span.origin.section_key;
    return current;
  });
}

/** Artifact text with newlines and long runs made visible on one line. */
function quote(text: string, limit = 64): string {
  const flat = text.replace(/\n/g, "\\n");
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

/**
 * Spans are UTF-8 BYTE offsets (`src/trace/span.ts` measures with
 * `Buffer.byteLength`), and a JavaScript string is indexed in UTF-16 code
 * units. Slicing the string by a span's numbers would silently misquote every
 * artifact containing an em dash or an arrow — which is most of them. So the
 * content is sliced as bytes and decoded back.
 */
function sliceBytes(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("utf8");
}

function explainArtifact(result: CompileResult, path: string, content: string, out: NodeJS.WriteStream): void {
  const spans = result.spans
    .filter((s) => s.artifact_path === path)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const keys = sectionKeys(spans);
  const bytes = Buffer.from(content, "utf8");

  out.write(`\n=== ${path} (${bytes.length} bytes, ${spans.length} spans) ===\n`);
  let section: string | null = null;
  spans.forEach((span, i) => {
    const key = keys[i]!;
    if (key !== section) {
      section = key;
      out.write(`\n  [${key}]\n`);
    }
    out.write(
      `    ${String(span.start).padStart(6)}–${String(span.end).padStart(6)}  ` +
        `${describeOrigin(span.origin).padEnd(52)}  "${quote(sliceBytes(bytes, span.start, span.end))}"\n`,
    );
  });
}

/**
 * Which sections each constraint reached.
 *
 * INV-003 says a hard constraint always reaches the artifact, and FORGE-C002
 * enforces it. This shows the reader the evidence behind that verdict rather
 * than asking them to trust it — and a hard constraint appearing here with no
 * destination is the same fact C002 reports, seen from the other side.
 */
function explainConstraints(ir: TaskIR, result: CompileResult, out: NodeJS.WriteStream): void {
  out.write("\n=== constraints → where they landed ===\n");
  if (ir.constraints.length === 0) {
    out.write("  (none)\n");
    return;
  }
  const byArtifact = new Map<string, Span[]>();
  for (const span of result.spans) {
    byArtifact.set(span.artifact_path, [...(byArtifact.get(span.artifact_path) ?? []), span]);
  }
  for (const c of ir.constraints) {
    const places: string[] = [];
    for (const [path, spans] of byArtifact) {
      const sorted = spans.slice().sort((a, b) => a.start - b.start || a.end - b.end);
      const keys = sectionKeys(sorted);
      sorted.forEach((span, i) => {
        if (span.origin.kind === "ir_node" && span.origin.node_id === c.id) {
          places.push(`${path}:${keys[i]}`);
        }
      });
    }
    const where = places.length > 0 ? [...new Set(places)].join(", ") : "NOWHERE";
    out.write(`  [${c.id}] ${c.hardness}/${c.kind} → ${where}\n`);
  }
}

/**
 * Explain an already-exported package (V2-F).
 *
 * A package is a finished record, so this is a pure READ of it — no
 * recompilation, no model, and deliberately no FORGE-specific parsing beyond
 * `JSON.parse`, which is the same contract `PK-R8` offers a stranger. If this
 * needed anything a third party could not do, the package would not be portable.
 */
function explainPackage(root: string, out: NodeJS.WriteStream): void {
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(join(root, name), "utf8")) as T;

  const manifest = read<{
    semantic_id: string;
    forge_version: string;
    ir_version: string;
    profile: { id: string; version: string; fidelity: string };
    tokenizer: { id: string; version: string };
    strategy: { archetype: string; version: number } | null;
    refused: boolean;
    files: Array<{ path: string; content_hash: string }>;
  }>("package.json");

  out.write(`package    ${resolve(root)}\n`);
  out.write(`semantic   ${manifest.semantic_id}\n`);
  out.write(`target     ${manifest.profile.id}@${manifest.profile.version} (${manifest.profile.fidelity})\n`);
  out.write(`tokenizer  ${manifest.tokenizer.id}@${manifest.tokenizer.version}\n`);
  out.write(
    `strategy   ${manifest.strategy ? `${manifest.strategy.archetype} v${manifest.strategy.version}` : "(identity)"}\n`,
  );
  if (manifest.refused) out.write(`\nCOMPILATION WAS REFUSED — this package carries no artifacts.\n`);

  const requirements = read<{
    requirements: Array<{ id: string; text: string; origin: string; node_id: string | null; kind: string }>;
  }>("requirements.json").requirements;
  out.write(`\n=== requirements (${requirements.length}) ===\n`);
  for (const r of requirements) {
    out.write(
      `  ${r.id}  ${r.origin.padEnd(11)} ${r.kind.padEnd(11)} ${r.node_id ?? "-"}\n` +
        `      ${quote(r.text, 88)}\n`,
    );
  }

  const verification = read<{
    executed_by_forge: boolean;
    entries: Array<{ id: string; kind: string; spec: string; expected: string; satisfies: string[] }>;
  }>("verification.json");
  out.write(`\n=== verification obligations (${verification.entries.length}) ===\n`);
  // Stated rather than assumed: a reader must not have to infer that these
  // were not run (PK-R5, INV-004).
  out.write(`  FORGE executed none of these: executed_by_forge=${verification.executed_by_forge}\n`);
  for (const v of verification.entries) {
    out.write(`  [${v.id}] ${v.kind}: ${quote(v.spec, 72)}\n      expect ${quote(v.expected, 72)}\n`);
  }

  const diagnostics = read<{
    deterministic: Array<{ code: string; severity: string; message: string }>;
    judged: Array<{ code: string; severity: string; message: string }>;
    deterministic_hash: string;
  }>("diagnostics.json");
  out.write(`\n=== diagnostics ===\n`);
  if (diagnostics.deterministic.length + diagnostics.judged.length === 0) out.write("  (none)\n");
  for (const d of diagnostics.deterministic) out.write(`  ${d.severity}[${d.code}] ${d.message}\n`);
  for (const d of diagnostics.judged) out.write(`  judged ${d.severity}[${d.code}] ${d.message}\n`);
  out.write(`  deterministic_hash ${diagnostics.deterministic_hash}\n`);

  const trace = read<{ spans: Array<{ artifact_path: string }> }>("trace.json");
  const byArtifact = new Map<string, number>();
  for (const span of trace.spans) {
    byArtifact.set(span.artifact_path, (byArtifact.get(span.artifact_path) ?? 0) + 1);
  }
  out.write(`\n=== artifacts ===\n`);
  for (const entry of manifest.files.filter((f) => f.path.startsWith("artifacts/"))) {
    const artifactPath = entry.path.slice("artifacts/".length);
    out.write(`  ${entry.path}  ${byArtifact.get(artifactPath) ?? 0} spans  ${entry.content_hash}\n`);
  }
  out.write(
    `\nevery content hash above is sha256 over the file's bytes — verifiable with sha256sum (PK-R8)\n`,
  );
}

/* -------------------------------------------------------------------------- */
/* Traceability (V2-H, spec.md §22.10 TM-R4)                                   */
/* -------------------------------------------------------------------------- */

/** A refused explain input — a bad governance file or an unreadable workspace. Exit 2. */
class ExplainInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExplainInputError";
  }
}

interface TraceOptions {
  readonly workspace?: string;
  readonly governance?: string;
  readonly report?: VerdictReport;
}

/**
 * The matrix for an exported package: the SAME `buildTraceabilityMatrix` the
 * Studio calls, over the package's own files. `--workspace` is the user's
 * explicit, invocation-scoped binding (RB-R2) and is read only through
 * `WorkspaceGuard`; `--governance` is a file of human decisions, applied in
 * order with the same checks as a click in the workspace. No model, and no
 * fact the inputs do not hold.
 */
function packageMatrix(root: string, options: TraceOptions): TraceabilityMatrix {
  const read = <T>(name: string): T => JSON.parse(readFileSync(join(root, name), "utf8")) as T;
  const manifest = read<{ semantic_id: string }>("package.json");
  const requirements = read<{ requirements: Array<{ text: string; kind: string }> }>("requirements.json").requirements;
  // The pinned half of the manifest is the ledger it was built from (EV-R3 uses the same reading).
  const ledger: LedgerEntry[] = requirements
    .filter((r) => r.kind === "pinned")
    .map((r, i) => ({ id: `pinned-${i + 1}`, text: r.text, contentHash: contentHash(r.text), origin: "user_input" as const }));
  const ir = parseTaskIR(read<unknown>("task-ir.json"));

  let log: GovernanceRecord[] = [];
  if (options.governance !== undefined) {
    try {
      log = recordDecisions({ ledger, ir }, parseGovernanceFile(readFileSync(resolve(options.governance), "utf8")));
    } catch (error) {
      throw new ExplainInputError(`--governance refused: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let linkage = null;
  if (options.workspace !== undefined) {
    let guard: WorkspaceGuard;
    try {
      guard = WorkspaceGuard.open(options.workspace);
    } catch (error) {
      throw new ExplainInputError(`--workspace refused: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rows = governRequirements({ ledger, ir, log }).requirements;
    linkage = linkRequirements(
      rows.map((r) => ({ id: r.id, text: r.text })),
      guard,
      { scope: { include: ir.scope.include, exclude: ir.scope.exclude } },
    );
  }

  const report = options.report;
  return buildTraceabilityMatrix({
    ledger,
    ir,
    log,
    package_semantic_id: manifest.semantic_id,
    spans: read<{ spans: MatrixSpan[] }>("trace.json").spans,
    obligations: read<{ entries: MatrixObligation[] }>("verification.json").entries,
    verdicts:
      report === undefined
        ? null
        : {
            package_valid: report.package_valid,
            package_semantic_id: report.package_semantic_id,
            caveat: REPORT_CAVEAT,
            verdicts: report.verdicts,
          },
    linkage,
    // The CLI has no source of advisory links; the absence is printed, not hidden.
    advisory: [],
  });
}

function describeLink(link: AuthoritativeLink): string {
  const evidence = link.evidence.map((e) => {
    switch (e.type) {
      case "rg_term":
        return `rg_term ${e.matched}/${e.of} [${e.matched_terms.join(", ")}]`;
      case "test_naming":
        return `test_naming [${e.matched_terms.join(", ")}]`;
      case "scope_glob":
        return `scope_glob ${e.glob}`;
      case "git_history":
        return `git_history #${e.commit_position}`;
    }
  });
  return `${link.path} ← ${evidence.join(" · ")}`;
}

/** Human rendering of the matrix: one block per requirement, in chain order. */
function writeMatrix(matrix: TraceabilityMatrix, out: NodeJS.WritableStream, only?: string): void {
  const rows = only === undefined ? matrix.rows : matrix.rows.filter((r) => r.id === only);
  out.write(`\n=== requirement traceability (${rows.length} of ${matrix.rows.length}) ===\n`);
  out.write(
    `repository   ${matrix.repository_bound ? "bound — links are deterministic evidence only" : "not bound — no file or test links"}\n`,
  );
  out.write(
    `verdicts     ${matrix.verdicts_rejected ? "package REJECTED — none shown" : matrix.verdicts_supplied ? "joined from the supplied evidence" : "no evidence supplied"}\n`,
  );
  const pad = "             ";
  const list = (label: string, items: readonly string[], empty: string): void => {
    if (items.length === 0) {
      out.write(`    ${label.padEnd(12)} ${empty}\n`);
      return;
    }
    items.forEach((item, i) => out.write(`    ${i === 0 ? label.padEnd(12) : pad.slice(0, 12)} ${item}\n`));
  };
  for (const r of rows) {
    out.write(`\n  [${r.id}] "${quote(r.text, 96)}"\n`);
    const sources = r.sources.map((s) =>
      s.kind === "ledger" ? "ledger (pinned verbatim)" : `IR ${s.node_kind} ${s.node_id}`,
    );
    out.write(`    provenance   ${r.origin} · ${sources.length > 0 ? sources.join(" · ") : "in no current version"}\n`);
    const lifecycle = [
      r.status,
      ...(r.pinned ? ["pinned"] : []),
      ...(r.superseded_by ? [`superseded by ${r.superseded_by}`] : []),
      ...(r.conflicts_with.length > 0 ? [`conflicts with ${r.conflicts_with.join(", ")}`] : []),
      ...(r.active ? [] : ["inactive"]),
    ];
    out.write(`    lifecycle    ${lifecycle.join(" · ")}\n`);
    list(
      "IR node",
      r.sources.flatMap((s) => (s.kind === "ir_node" ? [`${s.node_id} (${s.node_kind})`] : [])),
      "(none — not in the IR)",
    );
    list("artifact", r.artifact_spans.map((s) => `${s.artifact_path}:${s.start}–${s.end} (${s.node_id})`), "(no span)");
    const noRepo = "(no repository bound)";
    list("files", r.files.map(describeLink), matrix.repository_bound ? "(none — no deterministic evidence)" : noRepo);
    list("tests", r.tests.map(describeLink), matrix.repository_bound ? "(none — no deterministic evidence)" : noRepo);
    // LK-R4: never among the authoritative lines, and always labelled.
    list(
      "ADVISORY",
      r.advisory_links.map((l) => `${l.path} (${l.source}) — asserted, not evidence`),
      "(none supplied)",
    );
    list(
      "obligation",
      r.obligations.map(
        (o) => `[${o.id}] ${o.kind}: ${quote(o.spec, 56)} → ${o.accepted_records} record(s) → ${o.verdict ?? "no verdict"}`,
      ),
      "(no obligation satisfies it)",
    );
  }
  if (matrix.diagnostics.length > 0) {
    out.write(`\n`);
    for (const d of matrix.diagnostics) out.write(`  ${d.severity}[${d.code}] ${d.message}\n`);
  }
  if (matrix.caveat !== null) out.write(`\n${matrix.caveat}\n`);
}

export function registerExplainCommand(program: Command): void {
  program
    .command("explain")
    .description("Show how an artifact was built: byte ranges, origins, constraints, decisions.")
    .option("--ir <path>", "path to a Task IR JSON file")
    .option("--target <profile>", "agent profile to compile for")
    .option("--package <dir>", "an exported Execution Package to explain instead of recompiling")
    .option("--evidence <file>", "with --package: show obligation → evidence → verdict (V2-G)")
    .option("--workspace <dir>", "with --package: link requirements to this repository's files and tests (V2-H)")
    .option("--governance <file>", "with --package: apply these human governance decisions (V2-H)")
    .option("--requirement <id>", "with --package: explain only this requirement's chain")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--json", "machine-readable output")
    .action(
      (opts: {
        ir?: string;
        target?: string;
        package?: string;
        evidence?: string;
        workspace?: string;
        governance?: string;
        requirement?: string;
        profileDir?: string;
        json?: boolean;
      }) => {
      try {
        if (opts.package !== undefined) {
          let report: VerdictReport | undefined;
          if (opts.evidence !== undefined) {
            // The verdict chain needs a VALIDATED package (EV-R3), so this path
            // rebuilds it; plain `--package` stays a JSON.parse-only read (PK-R8).
            const registry = opts.profileDir
              ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
              : builtinProfiles();
            report = verifyDirectory(opts.package, opts.evidence, registry);
            if (!report.package_valid) {
              writeVerdicts(report, process.stdout);
              process.exit(EXIT.refused);
            }
          }
          let matrix: TraceabilityMatrix;
          try {
            matrix = packageMatrix(opts.package, {
              ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
              ...(opts.governance !== undefined ? { governance: opts.governance } : {}),
              ...(report !== undefined ? { report } : {}),
            });
          } catch (error) {
            if (error instanceof ExplainInputError) {
              process.stderr.write(`${error.message}\n`);
              process.exit(EXIT.usage);
            }
            throw error;
          }
          if (opts.json) {
            // The matrix's canonical JSON: byte-identical for identical inputs (TM-R3).
            process.stdout.write(matrix.json);
            process.exit(EXIT.ok);
          }
          explainPackage(opts.package, process.stdout);
          if (report !== undefined) {
            process.stdout.write("\n");
            writeVerdicts(report, process.stdout);
          }
          writeMatrix(matrix, process.stdout, opts.requirement);
          process.exit(EXIT.ok);
        }
        if (opts.ir === undefined || opts.target === undefined) {
          process.stderr.write("explain needs either --package <dir>, or both --ir <path> and --target <profile>.\n");
          process.exit(EXIT.usage);
        }
        const ir = readIr(opts.ir);
        const registry = opts.profileDir
          ? loadProfilesFrom(BUILTIN_PROFILE_DIR, resolve(opts.profileDir))
          : builtinProfiles();
        const profile = registry.get(opts.target);
        const result = compile(ir, profile, { taskSlug: "explain" });
        const out = process.stdout;

        if (opts.json) {
          const spans = result.spans.slice().sort((a, b) =>
            a.artifact_path.localeCompare(b.artifact_path) || a.start - b.start,
          );
          out.write(
            `${JSON.stringify(
              {
                semantic_hash: semanticHash(ir),
                target: profile.id,
                tokenizer: result.tokenizer,
                strategy: result.strategy,
                refused: result.refused,
                artifacts: result.artifacts.map((a) => ({
                  path: a.path,
                  // UTF-8 bytes, because that is the unit spans are measured
                  // in; `a.content.length` is UTF-16 code units and disagrees
                  // with every span the moment the artifact is not ASCII.
                  bytes: Buffer.byteLength(a.content, "utf8"),
                  content_hash: a.content_hash,
                })),
                spans: spans.map((s) => ({
                  artifact_path: s.artifact_path,
                  start: s.start,
                  end: s.end,
                  origin: s.origin,
                })),
                diagnostics: result.diagnostics,
                materialization: result.materialization,
                degradations: result.degradations,
                dropped_context: result.droppedContext,
                topology_gaps: result.topologyGaps,
              },
              null,
              2,
            )}\n`,
          );
          process.exit(result.refused ? EXIT.refused : EXIT.ok);
        }

        out.write(`IR         ${semanticHash(ir)}\n`);
        out.write(`target     ${profile.id} (fidelity: ${profile.fidelity})\n`);
        out.write(`tokenizer  ${result.tokenizer.id}@${result.tokenizer.version}\n`);
        out.write(
          `strategy   ${result.strategy ? `${result.strategy.archetype} v${result.strategy.version}` : "(identity)"}\n`,
        );

        if (result.refused) {
          // A refusal is the most important thing explain can say, so it is said
          // first and nothing pretends an artifact exists.
          out.write(`\nCOMPILATION REFUSED — no artifacts were produced.\n`);
        }

        for (const artifact of result.artifacts) {
          explainArtifact(result, artifact.path, artifact.content, out);
        }

        explainConstraints(ir, result, out);

        out.write("\n=== compiler decisions ===\n");
        for (const d of result.degradations) {
          out.write(`  degraded: ${d.rule_id} — ${d.effect} (${d.reason})\n`);
        }
        for (const d of result.droppedContext) {
          out.write(`  dropped context ${d.ref_id}: ${d.reason} (~${d.est_tokens} tokens)\n`);
        }
        for (const gap of result.topologyGaps) {
          out.write(
            `  topology gap [${gap.severity}]: ${gap.content_class} — would have gone to ` +
              `${gap.destinations.join(", ") || "(no declared destination)"}; nodes ${gap.node_ids.join(", ")}\n`,
          );
        }
        if (
          result.degradations.length === 0 &&
          result.droppedContext.length === 0 &&
          result.topologyGaps.length === 0
        ) {
          out.write("  (none)\n");
        }

        out.write("\n=== diagnostics ===\n");
        if (result.diagnostics.length === 0) {
          out.write("  (none)\n");
        }
        for (const d of result.diagnostics) {
          out.write(`  ${d.severity}[${d.code}] ${d.name}: ${d.message}\n`);
          for (const e of d.evidence) {
            out.write(
              `      evidence: ${
                e.kind === "node"
                  ? `node ${e.node_id}`
                  : e.kind === "measure"
                    ? `${e.label}=${e.value}${e.unit}`
                    : `${e.artifact_path}:${e.start}-${e.end} "${quote(e.quote, 40)}"`
              }\n`,
            );
          }
        }

        // The claim, restated as a check the reader just watched happen: every
        // non-whitespace byte above carries an origin, or FORGE-C100 is here.
        const untraced = result.diagnostics.filter((d) => d.code === "FORGE-C100").length;
        out.write(
          `\ncoverage   ${untraced === 0 ? "every non-whitespace byte is attributed (INV-010)" : `${untraced} untraced span(s) — FORGE-C100`}\n`,
        );

        process.exit(result.refused ? EXIT.refused : EXIT.ok);
      } catch (error) {
        fatal(error);
      }
    });
}

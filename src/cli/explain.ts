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
import { resolve } from "node:path";

import type { Command } from "commander";

import { compile } from "../compile/compile.js";
import type { CompileResult } from "../compile/types.js";
import { semanticHash } from "../ir/projection.js";
import type { TaskIR } from "../ir/schema.js";
import { BUILTIN_PROFILE_DIR, builtinProfiles, loadProfilesFrom } from "../profile/registry.js";
import type { Span, TraceOrigin } from "../trace/span.js";
import { EXIT, fatal } from "./errors.js";
import { readIr } from "./ir.js";

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

export function registerExplainCommand(program: Command): void {
  program
    .command("explain")
    .description("Show how an artifact was built: byte ranges, origins, constraints, decisions.")
    .requiredOption("--ir <path>", "path to a Task IR JSON file")
    .requiredOption("--target <profile>", "agent profile to compile for")
    .option("--profile-dir <dir>", "additional directory of profile YAML files")
    .option("--json", "machine-readable output")
    .action((opts: { ir: string; target: string; profileDir?: string; json?: boolean }) => {
      try {
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

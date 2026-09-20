/**
 * Typed trace origins and the traced-text builder (INV-010, FR-023, PV-R2).
 *
 * ARCHITECTURAL NOTE — why a builder exists at all.
 *
 * `AOC-10` recorded byte-level total attribution as an unproven claim. The practical
 * risk is not the invariant itself but the *implementation order*: emitters that
 * concatenate strings and then try to compute spans afterwards make coverage a
 * best-effort reconstruction, which is exactly how INV-010 would get quietly abandoned.
 *
 * `TracedTextBuilder` inverts that. Text can only enter an artifact through `add()`
 * (which requires an origin) or `gap()` (which THROWS on anything but whitespace).
 * Coverage therefore holds by construction, and `verifyCoverage` becomes a check on
 * the assembly step rather than the thing carrying the guarantee.
 *
 * Offsets are BYTE offsets into the UTF-8 encoding, not UTF-16 code units, so a
 * statement containing non-ASCII text does not silently misalign the trace.
 */
import type { CompilerRuleId, Materialization, SectionKey } from "../compile/vocabulary.js";

/** An IR node id, a strategy id, or one of the singleton names `objective` / `scope`. */
export type NodeId = string;

/**
 * Where a span of rendered output came from (docs/architecture.md §9.2).
 *
 * Revision 1 required every span to map to an IR node, which was unachievable: renderer
 * headings, degradation notices and profile-driven idiom have no IR node. Six typed
 * kinds cover every producer.
 */
export type TraceOrigin =
  | { readonly kind: "ir_node"; readonly node_id: NodeId }
  | { readonly kind: "strategy"; readonly strategy_id: string; readonly overlay_path: string }
  | { readonly kind: "agent_profile"; readonly profile_id: string; readonly profile_path: string }
  | {
      readonly kind: "context_ref";
      readonly ref_id: string;
      readonly materialization: Materialization;
    }
  | { readonly kind: "compiler_rule"; readonly rule_id: CompilerRuleId }
  | {
      readonly kind: "renderer_template";
      readonly renderer_id: string;
      readonly section_key: SectionKey;
      readonly slot: string;
    };

export const TRACE_ORIGIN_KINDS = [
  "ir_node",
  "strategy",
  "agent_profile",
  "context_ref",
  "compiler_rule",
  "renderer_template",
] as const;
export type TraceOriginKind = (typeof TRACE_ORIGIN_KINDS)[number];

/** A span relative to the start of a single section's text. */
export interface LocalSpan {
  readonly start: number;
  readonly end: number;
  readonly origin: TraceOrigin;
}

/** A span relative to the start of an artifact. */
export interface Span extends LocalSpan {
  readonly artifact_path: string;
}

export interface SectionOutput {
  readonly text: string;
  readonly spans: readonly LocalSpan[];
}

export class UntracedTextError extends Error {
  constructor(text: string) {
    super(
      `Refusing to emit untraced non-whitespace text ${JSON.stringify(
        text.length > 60 ? `${text.slice(0, 60)}…` : text,
      )}. Structural text must be added with an origin (use a renderer_template origin ` +
        `for headings and separators); only whitespace may pass through gap().`,
    );
    this.name = "UntracedTextError";
  }
}

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

const isWhitespaceOnly = (text: string): boolean => text.trim().length === 0;

/**
 * Builds section text such that every non-whitespace byte carries an origin.
 *
 * The class is the enforcement point for INV-010. Everything else in the renderer is
 * ordinary, boring string assembly.
 */
export class TracedTextBuilder {
  #chunks: string[] = [];
  #spans: LocalSpan[] = [];
  #offset = 0;

  /** Append traced text. Empty input is a no-op so no zero-length spans are created. */
  add(text: string, origin: TraceOrigin): this {
    if (text.length === 0) return this;
    const start = this.#offset;
    const end = start + byteLength(text);
    this.#chunks.push(text);
    this.#spans.push({ start, end, origin });
    this.#offset = end;
    return this;
  }

  /** Append text and a trailing newline, traced as one span. */
  line(text: string, origin: TraceOrigin): this {
    return this.add(text, origin).gap("\n");
  }

  /**
   * Append whitespace-only separator text. Throws on anything else — that throw is the
   * mechanism preventing untraced content from ever reaching an artifact.
   */
  gap(text: string): this {
    if (text.length === 0) return this;
    if (!isWhitespaceOnly(text)) throw new UntracedTextError(text);
    this.#chunks.push(text);
    this.#offset += byteLength(text);
    return this;
  }

  /** True when nothing has been added yet, so callers can skip empty sections. */
  get isEmpty(): boolean {
    return this.#spans.length === 0;
  }

  build(): SectionOutput {
    return { text: this.#chunks.join(""), spans: this.#spans };
  }
}

/** Rebase section-local spans onto an artifact, at a byte offset. */
export function rebase(
  spans: readonly LocalSpan[],
  artifactPath: string,
  offset: number,
): Span[] {
  return spans.map((s) => ({
    artifact_path: artifactPath,
    start: s.start + offset,
    end: s.end + offset,
    origin: s.origin,
  }));
}

/** Stable, human-readable rendering of an origin, used by diagnostics and `explain`. */
export function describeOrigin(origin: TraceOrigin): string {
  switch (origin.kind) {
    case "ir_node":
      return `ir_node ${origin.node_id}`;
    case "strategy":
      return `strategy ${origin.strategy_id} (${origin.overlay_path})`;
    case "agent_profile":
      return `agent_profile ${origin.profile_id} (${origin.profile_path})`;
    case "context_ref":
      return `context_ref ${origin.ref_id} (${origin.materialization})`;
    case "compiler_rule":
      return `compiler_rule ${origin.rule_id}`;
    case "renderer_template":
      return `renderer_template ${origin.renderer_id}:${origin.section_key}/${origin.slot}`;
  }
}

/**
 * Layer 2 — semantic drift between two versions' Task IRs (WS-R26, DG-R3, DG-R4).
 *
 * This is **advice**, and the whole module is arranged so it cannot be mistaken
 * for anything else. It emits one code, `FORGE-W006`, whose registry entry is
 * `judged` / `warning`; it reads two IRs that a model produced; and it never
 * sees the ledger except as a list of texts to *stay out of the way of*. What
 * it cannot do is stated in `preservation.ts`, where the two layers meet.
 *
 * The comparison is fuzzy on purpose and the reason is recorded in
 * `docs/architecture.md` §23.4: node ids are model-assigned per call, so
 * matching across versions can only be done on text. A reworded constraint may
 * read as a dropped one. That residual risk is survivable precisely because
 * this layer advises and Layer 1 guarantees — invert the two and the product's
 * central promise would be only as good as an extraction call.
 *
 * The rule, published so a reader can predict it:
 *
 *   - Requirement-bearing statements are goals, constraints and non-goals.
 *   - Similarity is Jaccard over the same normalized token set Layer 1 uses,
 *     so reformatting, punctuation and case alone always score 1.0 and can
 *     never produce a finding.
 *   - Below `VANISHED_BELOW`, the closest match is not a match: **vanished**.
 *   - Between that and `CHANGED_BELOW`, the closest match is recognisably the
 *     same statement saying something different: **changed**.
 *   - A statement covered by a pinned ledger entry is skipped entirely. It
 *     belongs to Layer 1, which answers about it with a guarantee (WS-R26).
 */
import { diagnostic, type Diagnostic, type Evidence } from "../../ir/diagnostic.js";
import type { TaskIR } from "../../ir/schema.js";
import { containsSequence, tokenize } from "../deterministic/ledger.js";

/** Below this, the closest statement is not the same statement any more. */
export const VANISHED_BELOW = 0.5;
/** Below this (and at or above the previous), it is the same one, changed. */
export const CHANGED_BELOW = 0.95;

export type StatementKind = "goal" | "constraint" | "non_goal";

export interface DriftStatement {
  readonly id: string;
  readonly kind: StatementKind;
  readonly statement: string;
}

export interface DriftFinding {
  readonly kind: "vanished" | "changed";
  readonly from: DriftStatement;
  /** The closest statement in the later version. Cited either way (WS-R26). */
  readonly nearest: DriftStatement;
  readonly similarity: number;
  readonly diagnostic: Diagnostic;
}

export interface DriftReport {
  /** The two versions compared, in order. */
  readonly from: number;
  readonly to: number;
  readonly findings: readonly DriftFinding[];
  /** Advisory, always. Carried on the report so a surface cannot forget. */
  readonly layer: "judged";
  /** How many statements were examined, so "no findings" has a denominator. */
  readonly compared: number;
  /** How many were skipped as pinned — Layer 1's business, not this one's. */
  readonly skippedPinned: number;
  /** Discarded because their citation did not resolve (DG-R4). */
  readonly discarded: number;
}

/** The requirement-bearing statements of an IR, in a fixed order. */
export function driftStatements(ir: TaskIR): DriftStatement[] {
  return [
    ...ir.goals.map((g) => ({ id: g.id, kind: "goal" as const, statement: g.statement })),
    ...ir.constraints.map((c) => ({ id: c.id, kind: "constraint" as const, statement: c.statement })),
    ...ir.non_goals.map((n) => ({ id: n.id, kind: "non_goal" as const, statement: n.statement })),
  ];
}

/**
 * The text a citation resolves against.
 *
 * DG-R4 requires a judged finding's citation to resolve or be discarded, which
 * means the evidence has to point into something reproducible rather than into
 * a model's memory. This rendering is that something: deterministic, derived
 * only from the IR, and returned to the caller so the user can check a quote
 * for themselves.
 */
export function renderStatements(statements: readonly DriftStatement[]): string {
  return statements.map((s) => `${s.kind} ${s.id}: ${s.statement}`).join("\n");
}

const line = (s: DriftStatement): string => `${s.kind} ${s.id}: ${s.statement}`;

/** Jaccard over the published token normalization. Reformatting scores 1.0. */
export function similarity(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** True when a pinned entry and a statement are about the same obligation. */
function coveredByPin(statement: string, pinned: readonly string[]): boolean {
  const tokens = tokenize(statement);
  return pinned.some((text) => {
    const pin = tokenize(text);
    return containsSequence(tokens, pin) || containsSequence(pin, tokens);
  });
}

function nearestIn(
  statement: DriftStatement,
  candidates: readonly DriftStatement[],
): { nearest: DriftStatement; score: number } | null {
  let best: DriftStatement | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = similarity(statement.statement, candidate.statement);
    // `>` rather than `>=`: ties keep the earlier candidate, so the result does
    // not depend on iteration accidents.
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best === null ? null : { nearest: best, score: bestScore };
}

/** A span that must resolve in `rendered`, or the finding is discarded. */
function spanFor(rendered: string, statement: DriftStatement, path: string): Evidence | null {
  const quote = line(statement);
  const start = rendered.indexOf(quote);
  if (start === -1) return null;
  return { kind: "span", artifact_path: path, start, end: start + quote.length, quote };
}

export interface DriftInput {
  readonly v: number;
  readonly ir: TaskIR;
}

/**
 * Compare two versions' IRs.
 *
 * Direction matters: statements are looked for **from** the earlier version
 * **in** the later one, because the question this layer answers is "did
 * something I already asked for quietly change?" — not "what is new?". New
 * material is what a revision is for, and reporting it would be noise.
 */
export function compareVersionIrs(
  from: DriftInput,
  to: DriftInput,
  options: { readonly pinned?: readonly string[] } = {},
): DriftReport {
  const pinned = options.pinned ?? [];
  const before = driftStatements(from.ir);
  const after = driftStatements(to.ir);
  const renderedBefore = renderStatements(before);
  const renderedAfter = renderStatements(after);

  const findings: DriftFinding[] = [];
  let compared = 0;
  let skippedPinned = 0;
  let discarded = 0;

  for (const statement of before) {
    // WS-R26: pinned material is Layer 1's, and Layer 1 answers with a
    // guarantee. Advising about it here could only add noise or, worse, look
    // like a second opinion on something that is not a matter of opinion.
    if (coveredByPin(statement.statement, pinned)) {
      skippedPinned += 1;
      continue;
    }
    compared += 1;

    const closest = nearestIn(statement, after);
    if (closest === null) {
      // Nothing to cite in the later version. DG-R4: discard silently.
      discarded += 1;
      continue;
    }
    if (closest.score >= CHANGED_BELOW) continue;

    const kind = closest.score < VANISHED_BELOW ? "vanished" : "changed";
    const fromSpan = spanFor(renderedBefore, statement, `version/${from.v}/ir-statements`);
    const toSpan = spanFor(renderedAfter, closest.nearest, `version/${to.v}/ir-statements`);
    if (fromSpan === null || toSpan === null) {
      discarded += 1;
      continue;
    }

    const message =
      kind === "vanished"
        ? `Advisory: the ${statement.kind} "${statement.statement}" from version ${from.v} has no close counterpart in version ${to.v}. ` +
          `The nearest statement there is "${closest.nearest.statement}". This is a judged reading of two extracted structures, not a guarantee — pin the requirement if it must be kept.`
        : `Advisory: the ${statement.kind} "${statement.statement}" reads differently in version ${to.v}, where the closest statement is ` +
          `"${closest.nearest.statement}". This is a judged reading of two extracted structures, not a guarantee — pin the requirement if it must be kept.`;

    findings.push({
      kind,
      from: statement,
      nearest: closest.nearest,
      similarity: closest.score,
      diagnostic: diagnostic("FORGE-W006", message, [fromSpan, toSpan]),
    });
  }

  return Object.freeze({
    from: from.v,
    to: to.v,
    findings: Object.freeze(findings),
    layer: "judged",
    compared,
    skippedPinned,
    discarded,
  });
}

/** The renderings a citation resolves against, for a surface that shows them. */
export function citationSources(from: DriftInput, to: DriftInput): Record<string, string> {
  return {
    [`version/${from.v}/ir-statements`]: renderStatements(driftStatements(from.ir)),
    [`version/${to.v}/ir-statements`]: renderStatements(driftStatements(to.ir)),
  };
}

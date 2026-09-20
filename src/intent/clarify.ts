/**
 * Clarification routing and deterministic resolution (FR-004, P3).
 *
 * Five dispositions, no others:
 *
 *   ANSWERED_FROM_USER      a blocking (or open) question the human answered;
 *                           recorded as a high-confidence `user_input` assumption
 *   ANSWERED_FROM_EVIDENCE  a question the repository answered through the P2
 *                           pipeline; recorded as a medium-confidence assumption
 *                           sourced from the supporting ContextRef — which the
 *                           trust model then renders as advisory (SC-R1), never
 *                           authoritative
 *   ASSUMED                 a non-blocking question settled by its recorded
 *                           default assumption (already in the IR)
 *   OPEN_NONBLOCKING        a non-blocking question with no default: kept open
 *                           as recorded uncertainty
 *   OPEN_BLOCKING           a blocking question with no answer: kept open; the
 *                           pipeline halts (exit 3) rather than guessing
 *
 * Fail-closed: evidence citing a ref outside the IR's context_refs (forged
 * or outside-guard material smuggled past the pipeline) throws ClarifyError
 * instead of entering the IR. Resolutions are run-layer records — the IR
 * carries the resulting assumptions, never the disposition labels (AOC-4:
 * no schema change).
 */

import type { AnsweredQuestion } from "../context/disambiguate.js";
import type { OpenQuestion, TaskIR } from "../ir/schema.js";

export type QuestionDisposition =
  | "ANSWERED_FROM_USER"
  | "ANSWERED_FROM_EVIDENCE"
  | "ASSUMED"
  | "OPEN_NONBLOCKING"
  | "OPEN_BLOCKING";

export interface QuestionResolution {
  readonly questionId: string;
  readonly disposition: QuestionDisposition;
  /** Stable record: assumption id, evidence ref, or escalation reason. */
  readonly detail: string;
}

export interface ClarifyOutcome {
  readonly ir: TaskIR;
  readonly resolutions: readonly QuestionResolution[];
}

export class ClarifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarifyError";
  }
}

export function routeQuestions(ir: TaskIR): {
  readonly blocking: readonly OpenQuestion[];
  readonly nonBlocking: readonly OpenQuestion[];
} {
  return {
    blocking: ir.open_questions.filter((q) => q.blocking),
    nonBlocking: ir.open_questions.filter((q) => !q.blocking),
  };
}

function nextAssumptionId(ir: TaskIR): string {
  let max = 0;
  for (const a of ir.assumptions) {
    const match = /^a([0-9]+)$/.exec(a.id);
    if (match) max = Math.max(max, Number.parseInt(match[1] as string, 10));
  }
  return `a${max + 1}`;
}

function answerStatement(question: OpenQuestion, answer: string): string {
  return `In answer to "${question.question}": ${answer}`;
}

/**
 * Apply the human's answers. Every answer becomes an assumption — user
 * answers are never dropped, including when the refine boundary already
 * restructured around them (the backstop in task.ts re-applies answers for
 * questions the model left open).
 */
export function applyUserAnswers(
  ir: TaskIR,
  answers: ReadonlyMap<string, string>,
): ClarifyOutcome {
  const resolutions: QuestionResolution[] = [];
  const open = [...ir.open_questions];
  const assumptions = [...ir.assumptions];
  let working: TaskIR = ir;
  for (const [questionId, answer] of answers) {
    const index = open.findIndex((q) => q.id === questionId);
    if (index === -1) {
      throw new ClarifyError(`Answer for unknown or already-resolved question "${questionId}".`);
    }
    const question = open[index] as OpenQuestion;
    const id = nextAssumptionId(working);
    assumptions.push({
      id,
      statement: answerStatement(question, answer),
      confidence: "high",
      source_ref: "user_input",
    });
    open.splice(index, 1);
    working = { ...working, assumptions };
    resolutions.push({
      questionId,
      disposition: "ANSWERED_FROM_USER",
      detail: `recorded as assumption ${id} (user_input).`,
    });
  }
  return { ir: { ...working, open_questions: open }, resolutions };
}

/**
 * Apply evidence answers from the P2 pipeline. Each answer's evidence must
 * resolve to a ContextRef OF THIS IR — anything else is forged or
 * outside-guard material and is refused loudly, never recorded.
 */
export function applyEvidenceAnswers(
  ir: TaskIR,
  answered: readonly AnsweredQuestion[],
): ClarifyOutcome {
  const knownRefs = new Set(ir.context_refs.map((r) => r.id));
  const resolutions: QuestionResolution[] = [];
  let open = [...ir.open_questions];
  let assumptions = [...ir.assumptions];
  let working: TaskIR = ir;
  for (const item of answered) {
    const index = open.findIndex((q) => q.id === item.questionId);
    if (index === -1) {
      throw new ClarifyError(`Evidence answer for unknown or already-resolved question "${item.questionId}".`);
    }
    if (item.evidence.length === 0) {
      throw new ClarifyError(`Evidence answer for "${item.questionId}" cites no evidence.`);
    }
    for (const ev of item.evidence) {
      if (!knownRefs.has(ev.refId)) {
        throw new ClarifyError(
          `Evidence for "${item.questionId}" cites "${ev.refId}", which is not a context reference of this IR. ` +
            `Evidence outside the guarded resolution cannot enter the IR.`,
        );
      }
    }
    const question = open[index] as OpenQuestion;
    const source = [...item.evidence].sort((a, b) => (a.refId < b.refId ? -1 : 1))[0]!.refId;
    const id = nextAssumptionId(working);
    assumptions = [
      ...assumptions,
      { id, statement: answerStatement(question, item.answer), confidence: "medium", source_ref: source },
    ];
    open = open.filter((q) => q.id !== item.questionId);
    working = { ...working, assumptions };
    resolutions.push({
      questionId: item.questionId,
      disposition: "ANSWERED_FROM_EVIDENCE",
      detail: `recorded as assumption ${id} sourced from ${source} (${item.evidence.length} supporting ref(s)).`,
    });
  }
  return { ir: { ...working, open_questions: open }, resolutions };
}

/**
 * Settle non-blocking questions: those with a recorded default proceed
 * under it (ASSUMED); those without stay open as recorded uncertainty
 * (OPEN_NONBLOCKING). Blocking questions are never touched here — they
 * belong to the evidence/user path or halt the pipeline.
 */
export function finalizeNonBlocking(ir: TaskIR): ClarifyOutcome {
  const resolutions: QuestionResolution[] = [];
  const knownAssumptions = new Set(ir.assumptions.map((a) => a.id));
  const open = ir.open_questions.filter((q) => {
    if (q.blocking) return true;
    if (q.default_assumption_ref !== null && knownAssumptions.has(q.default_assumption_ref)) {
      resolutions.push({
        questionId: q.id,
        disposition: "ASSUMED",
        detail: `proceeding under recorded default ${q.default_assumption_ref}.`,
      });
      return false;
    }
    resolutions.push({
      questionId: q.id,
      disposition: "OPEN_NONBLOCKING",
      detail: "no default assumption; kept open as recorded uncertainty.",
    });
    return true;
  });
  return { ir: { ...ir, open_questions: open }, resolutions };
}

/** Evidence first (P1.6), then the human's answers, then non-blocking finalization. */
export function resolveQuestions(
  ir: TaskIR,
  opts: {
    readonly evidenceAnswers?: readonly AnsweredQuestion[];
    readonly userAnswers?: ReadonlyMap<string, string>;
  } = {},
): ClarifyOutcome {
  const afterEvidence = applyEvidenceAnswers(ir, opts.evidenceAnswers ?? []);
  const afterUser = applyUserAnswers(afterEvidence.ir, opts.userAnswers ?? new Map());
  const finalized = finalizeNonBlocking(afterUser.ir);
  return {
    ir: finalized.ir,
    resolutions: [...afterEvidence.resolutions, ...afterUser.resolutions, ...finalized.resolutions],
  };
}

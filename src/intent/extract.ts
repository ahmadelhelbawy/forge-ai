/**
 * The `intent.extract` model boundary (FR-002, MB-R1).
 *
 * Two modes, one boundary (P3 refines; it does not add a boundary):
 * - initial: natural language (+ nothing else) → `DraftIR`
 * - refine: prior draft + clarification answers (+ optional repo signals) →
 *   restructured `DraftIR`
 *
 * The boundary PROPOSES structure; FORGE owns identity and validation:
 * identity (`ir_version`, `semantic_hash`) is stamped by attribution, and
 * provenance comes from the segment table, never from the model (INV-016).
 * At most two repairs (FR-003). A third failure is a hard error — never a
 * guess (MB-R3).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

import {
  attributeDraft,
  userInputSegment,
  type InputSegment,
} from "../ir/attribution.js";
import { signalsSegment, renderSignalsSection, type RepoSignals } from "./signals.js";
import { cassetteKey, readCassette, writeCassette, CassetteMissError } from "../model/cassette.js";
import {
  sha256Hex,
  type ModelCallRecord,
  type ModelProvider,
} from "../model/provider.js";
import {
  DraftIRSchema,
  type DraftIR,
  type TaskIR,
} from "../ir/schema.js";
import type { ModelBoundary } from "../model/boundaries.js";

export const INTENT_EXTRACT_ID = "intent.extract";
/**
 * Stays "1": the base prompt and schema handling are byte-identical to P1.5,
 * so committed cassette keys remain valid. Refine renders an EXTENDED prompt
 * whose key differs by content; repair-budget growth changes no key.
 */
export const INTENT_EXTRACT_VERSION = "1";
/** FR-003: at most two repairs; a third failure is a hard error. */
export const INTENT_EXTRACT_MAX_REPAIRS = 2;

/**
 * The output budget for one extraction.
 *
 * Sized for a **reasoning** model, not for the JSON. Thinking tokens are
 * billed against `max_tokens` on every OpenAI-compatible endpoint, so a budget
 * sized for the answer alone leaves nothing for the answer: measured against
 * Kimi K3 through the OpenCode Zen gateway, a 13.8k-character prompt spent
 * 3,287 reasoning tokens of a 4,000-token budget and returned a truncated body
 * — and a slightly longer one returned an empty body, which the provider used
 * to report as "no message content". The same call completes inside ~3,200
 * completion tokens when the ceiling is not in the way.
 *
 * Raising a ceiling costs nothing on a successful call: a model stops when it
 * is done. It is not part of the cassette key (boundary id + version + the
 * rendered prompt), so every committed recording stays valid.
 */
const MAX_TOKENS = 16000;

export const IntentExtractInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(20000),
});
export type IntentExtractInput = z.infer<typeof IntentExtractInputSchema>;

/** The input was unusable (empty text). A usage problem, not a model problem. */
export class BoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundaryError";
  }
}

/** The model failed to produce a valid draft within the repair budget. */
export class BoundaryFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundaryFailureError";
  }
}

/** P1.5 issues exactly one segment: the user's text, trusted (FR-005-adjacent). */
export function buildSegments(): readonly InputSegment[] {
  return [userInputSegment("s1")];
}

const TEMPLATE = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");

/** Render the full prompt. Pure: same text → same prompt → same cassette key. */
export function renderIntentPrompt(text: string): string {
  const segments = buildSegments()
    .map((s) => `- ${s.id}: ${s.label}`)
    .join("\n");
  const schema = JSON.stringify(z.toJSONSchema(DraftIRSchema), null, 2);
  return TEMPLATE.replace("{{TASK_TEXT}}", text)
    .replace("{{SEGMENTS}}", segments)
    .replace("{{DRAFT_SCHEMA}}", schema);
}

export const renderRepairPrompt = (prompt: string, previous: string, problems: readonly string[]): string =>
  `${prompt}\n\nYour previous output was rejected. Fix ALL of the following and return ONLY the corrected JSON object:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nPrevious output:\n${previous}`;

/** Pull the JSON object out of model chatter. Models wrap; the schema does not move. */
export function extractJsonPayload(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new BoundaryError("The model response contained no JSON object.");
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new BoundaryError("The model response contained malformed JSON.");
  }
}

const collectIds = (draft: DraftIR): Map<string, number> => {
  const counts = new Map<string, number>();
  const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const g of draft.goals) add(g.id);
  for (const c of draft.constraints) add(c.id);
  for (const n of draft.non_goals) add(n.id);
  for (const a of draft.assumptions) add(a.id);
  for (const q of draft.open_questions) add(q.id);
  for (const v of draft.verification) add(v.id);
  for (const d of draft.deliverables) add(d.id);
  return counts;
};

/**
 * Deterministic post-validators (arch §13.2). Each returns problems; empty
 * means pass. Shape is already guaranteed by DraftIRSchema at this point —
 * these check MEANING the schema cannot express.
 */
export const intentExtractValidators = {
  /** Every cited goal / assumption exists (C090 would fire later — catch it here). */
  citationsResolve: (_input: IntentExtractInput, draft: DraftIR): readonly string[] => {
    const problems: string[] = [];
    const goals = new Set(draft.goals.map((g) => g.id));
    const assumptions = new Set(draft.assumptions.map((a) => a.id));
    for (const v of draft.verification) {
      for (const target of v.satisfies) {
        if (!goals.has(target)) problems.push(`verification "${v.id}" satisfies unknown goal "${target}".`);
      }
    }
    for (const q of draft.open_questions) {
      const ref = q.default_assumption_ref;
      if (ref !== null && !assumptions.has(ref)) {
        problems.push(`open question "${q.id}" defaults to unknown assumption "${ref}".`);
      }
    }
    return problems;
  },
  /** Ids are unique across the whole draft (C091 would fire later). */
  idsUnique: (_input: IntentExtractInput, draft: DraftIR): readonly string[] => {
    const problems: string[] = [];
    for (const [id, count] of collectIds(draft)) {
      if (count > 1) problems.push(`node id "${id}" is declared ${count} times; ids must be unique.`);
    }
    return problems;
  },
  /** Every derived_from cites a segment FORGE issued for the base call (INV-016, MB-R6). */
  segmentsIssued: (_input: IntentExtractInput, draft: DraftIR): readonly string[] =>
    checkIssuedSegments(buildSegments(), draft),
};

/**
 * Check derived_from citations against the segments issued for THIS call.
 * The registered validator covers the base call; refine passes its own
 * (longer) table through this same check, so both modes enforce INV-016.
 */
export function checkIssuedSegments(
  segments: readonly InputSegment[],
  draft: DraftIR,
): readonly string[] {
  const issued = new Set(segments.map((s) => s.id));
  const problems: string[] = [];
  const check = (nodeId: string, derivedFrom: string) => {
    if (!issued.has(derivedFrom)) {
      problems.push(
        `node "${nodeId}" cites input segment "${derivedFrom}", which was never issued. Cite only: ${[...issued].join(", ")}.`,
      );
    }
  };
  check("objective", draft.objective.derived_from);
  check("scope", draft.scope.derived_from);
  for (const n of [
    ...draft.goals,
    ...draft.constraints,
    ...draft.non_goals,
    ...draft.assumptions,
    ...draft.open_questions,
    ...draft.verification,
    ...draft.deliverables,
  ]) {
    check(n.id, n.derived_from);
  }
  return problems;
}

export const intentExtractBoundary: ModelBoundary<IntentExtractInput, DraftIR> = {
  id: INTENT_EXTRACT_ID,
  version: INTENT_EXTRACT_VERSION,
  inputSchema: IntentExtractInputSchema,
  outputSchema: DraftIRSchema,
  postValidators: [
    intentExtractValidators.citationsResolve,
    intentExtractValidators.idsUnique,
    intentExtractValidators.segmentsIssued,
  ],
  cassetteKey: (input) => cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, renderIntentPrompt(input.text)),
  required: true,
  onFailure: "fail",
};

export interface ExtractDeps {
  /** Live backend. Absent when offline — then a cassette must satisfy the key. */
  readonly provider?: ModelProvider;
  readonly model?: string;
  /** Replay source and (when live) record target. Absent disables cassettes. */
  readonly cassetteDir?: string;
  readonly recordCassettes?: boolean;
  /**
   * Volatile transport headers for this invocation (e.g. one gateway session
   * id shared by the initial call and its repair). Never semantic: not in the
   * prompt, not in the IR, not in any hash.
   */
  readonly sessionHeaders?: Readonly<Record<string, string>>;
}

export interface ExtractResult {
  readonly ir: TaskIR;
  readonly draft: DraftIR;
  readonly record: ModelCallRecord;
  readonly repairs: number;
}

/** No live backend and no cassette hit — refuse loudly, never guess. */
export class NoModelSourceError extends Error {
  constructor(key: string) {
    super(
      `intent.extract has no model source for key ${key}: set ANTHROPIC_API_KEY or ` +
        `OPENAI_API_KEY, or replay with --cassette <dir>. Refusing rather than inventing (CLI-R4).`,
    );
    this.name = "NoModelSourceError";
  }
}

interface Attempt {
  readonly prompt: string;
  readonly responseText: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly replayed: boolean;
}

async function invoke(deps: ExtractDeps, prompt: string, key: string): Promise<Attempt> {
  if (deps.cassetteDir) {
    const hit = readCassette(deps.cassetteDir, key);
    if (hit) {
      return { prompt, responseText: hit.responseText, model: hit.model, latencyMs: 0, replayed: true };
    }
  }
  if (!deps.provider) throw new NoModelSourceError(key);
  const response = await deps.provider.complete(
    {
      system: "You extract structure from engineering tasks as JSON.",
      user: prompt,
      maxTokens: MAX_TOKENS,
      temperature: 0,
      ...(deps.sessionHeaders ? { extraHeaders: deps.sessionHeaders } : {}),
    },
    deps.model,
  );
  if (deps.cassetteDir && (deps.recordCassettes ?? true)) {
    writeCassette(deps.cassetteDir, {
      version: 1,
      key,
      boundaryId: INTENT_EXTRACT_ID,
      boundaryVersion: INTENT_EXTRACT_VERSION,
      model: response.model,
      responseText: response.text,
      recordedAt: new Date().toISOString(),
    });
  }
  return {
    prompt,
    responseText: response.text,
    model: response.model,
    latencyMs: response.latencyMs,
    replayed: false,
  };
}

/** One answered question, as the model must see it: id, text, and the answer. */
export interface ClarificationAnswer {
  readonly questionId: string;
  readonly question: string;
  readonly answer: string;
}

export interface RefineOptions {
  /** Repo layout, grounded as a forge_derived segment (signals.ts). */
  readonly signals?: RepoSignals;
}

/**
 * Render the refine prompt: the byte-identical base plus prior draft,
 * answers, and optional signals. New segments: s2 for signals (when
 * present), then the answers segment. Cassette keys cover the full text,
 * so refine calls can never collide with base calls.
 */
export function renderRefinePrompt(
  base: string,
  priorDraft: DraftIR,
  answers: readonly ClarificationAnswer[],
  signals?: RepoSignals,
): { readonly prompt: string; readonly segments: readonly InputSegment[] } {
  const segments: InputSegment[] = [userInputSegment("s1")];
  const sections: string[] = [
    `PRIOR DRAFT (your previous output, for continuity — restructure it around the answers; do not merely repeat it):\n${JSON.stringify(priorDraft)}`,
  ];
  if (signals) {
    segments.push(signalsSegment());
    sections.push(renderSignalsSection(signals));
  }
  const answersId = signals ? "s3" : "s2";
  segments.push({ id: answersId, source_ref: "user_input", label: "the user's clarification answers" });
  sections.push(
    `CLARIFICATION ANSWERS (segment ${answersId} — the user answered; incorporate each into structure: ` +
      `resolve the corresponding open question by adding or tightening goals, constraints, scope, or verification. ` +
      `Cite ${answersId} for nodes drawn from an answer.):\n` +
      answers.map((a) => `- ${a.questionId} (${a.question}): ${a.answer}`).join("\n"),
  );
  return { prompt: `${base}\n\n${sections.join("\n\n")}`, segments };
}

/**
 * Run the boundary: prompt → parse → validate → (≤2 repairs) → attribute.
 * Shared by initial extraction and refine; the modes differ only in prompt,
 * segments, and validators. Returns the TaskIR plus the volatile
 * model-call record (FR-049).
 */
async function runBoundary(
  initialPrompt: string,
  segments: readonly InputSegment[],
  deps: ExtractDeps,
  validate: (draft: DraftIR) => readonly string[],
): Promise<ExtractResult> {
  const attempts: Attempt[] = [];
  let repairs = 0;
  let prompt = initialPrompt;
  let feedback: readonly string[] = [];
  let previous = "";

  for (;;) {
    const key = cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, prompt);
    const attempt = await invoke(deps, prompt, key);
    attempts.push(attempt);

    let draft: DraftIR | null = null;
    let problems: string[] = [];
    try {
      const payload = extractJsonPayload(attempt.responseText);
      const shape = DraftIRSchema.safeParse(payload);
      if (!shape.success) {
        problems = shape.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
      } else {
        draft = shape.data;
        problems = [...validate(shape.data)];
      }
    } catch (error) {
      problems = [error instanceof Error ? error.message : String(error)];
    }

    if (problems.length === 0) {
      const ir = attributeDraft(draft!, segments);
      const last = attempts[attempts.length - 1]!;
      return {
        ir,
        draft: draft!,
        repairs,
        record: {
          boundaryId: INTENT_EXTRACT_ID,
          boundaryVersion: INTENT_EXTRACT_VERSION,
          provider: deps.provider?.id ?? "cassette",
          model: last.model,
          promptHash: sha256Hex(initialPrompt),
          outputHash: sha256Hex(last.responseText),
          repairs,
          latencyMs: attempts.reduce((sum, a) => sum + a.latencyMs, 0),
          replayed: attempts.every((a) => a.replayed),
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (repairs >= INTENT_EXTRACT_MAX_REPAIRS) {
      throw new BoundaryFailureError(
        `intent.extract failed after ${repairs + 1} attempt(s); refusing rather than guessing (MB-R3). ` +
          `Unresolved: ${problems.join(" | ")}`,
      );
    }
    feedback = problems;
    previous = attempt.responseText;
    prompt = renderRepairPrompt(initialPrompt, previous, feedback);
    repairs += 1;
  }
}

/**
 * Run the boundary: prompt → parse → validate → (≤2 repairs) → attribute.
 * Returns the TaskIR plus the volatile model-call record (FR-049).
 */
export async function extractIntent(text: string, deps: ExtractDeps): Promise<ExtractResult> {
  const parsed = IntentExtractInputSchema.safeParse({ text });
  if (!parsed.success) throw new BoundaryError("intent.extract input text must be non-empty.");
  const input = parsed.data;
  return runBoundary(renderIntentPrompt(input.text), buildSegments(), deps, (draft) =>
    intentExtractBoundary.postValidators.flatMap((v) => v(input, draft)),
  );
}

/**
 * Refine mode (FR-002, FR-004): restructure a prior draft around the user's
 * clarification answers. Same boundary, same validators, same repair
 * budget — plus the answers segment (and optional signals segment) in the
 * issued table, so INV-016 holds for refined nodes exactly as for initial
 * ones. One refine round per pipeline run; the caller bounds the loop.
 */
export async function refineIntent(
  text: string,
  priorDraft: DraftIR,
  answers: readonly ClarificationAnswer[],
  deps: ExtractDeps,
  options: RefineOptions = {},
): Promise<ExtractResult> {
  const parsed = IntentExtractInputSchema.safeParse({ text });
  if (!parsed.success) throw new BoundaryError("intent.extract input text must be non-empty.");
  if (answers.length === 0) throw new BoundaryError("refine needs at least one clarification answer.");
  if (!DraftIRSchema.safeParse(priorDraft).success) {
    throw new BoundaryError("refine needs a schema-valid prior draft.");
  }
  const base = renderIntentPrompt(parsed.data.text);
  const { prompt, segments } = renderRefinePrompt(base, priorDraft, answers, options.signals);
  return runBoundary(prompt, segments, deps, (draft) => [
    ...intentExtractValidators.citationsResolve(parsed.data, draft),
    ...intentExtractValidators.idsUnique(parsed.data, draft),
    ...checkIssuedSegments(segments, draft),
  ]);
}

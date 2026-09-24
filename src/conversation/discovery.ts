/**
 * Discovery (Product Sprint 1, `FR-059`, `spec.md` §22.11 WS-R30–WS-R35).
 *
 * A vague or strategic idea needs questions before it needs a prompt. This
 * module is the deterministic half of that: the schema a `DISCOVER` response's
 * `discovery` object must satisfy, the parser that reads it out of the same
 * envelope text `parseEnvelope` reads, the unresolved-question set a generate
 * request must surface, and the coverage check run on the version it writes.
 *
 * The brief is FORGE's *understanding* — model-authored, validated, shown to
 * the user as such — and never user-stated provenance (INV-016). Nothing here
 * writes a version: `DISCOVER` is read-only (WS-R2), and only an explicit
 * generate request, which the turn pipeline owns, may write one (WS-R31).
 */
import { z } from "zod";

import { tokenize } from "../critic/deterministic/ledger.js";
import { contentWords, isCovered, sameQuestion, type CoverageItem, type ItemCoverage } from "./coverage.js";

const Text = z.string().trim().min(1).max(600);
const Items = z.array(Text).max(12);

/** The evolving brief. Every field optional: only what is known is shown. */
export const DiscoveryBriefSchema = z.strictObject({
  vision: Text.optional(),
  goal: Text.optional(),
  target_user: Text.optional(),
  problem: Text.optional(),
  background: Text.optional(),
  capabilities: Items.optional(),
  constraints: Items.optional(),
  success_criteria: Items.optional(),
  open_questions: Items.optional(),
});
export type DiscoveryBrief = z.infer<typeof DiscoveryBriefSchema>;

export const DiscoveryQuestionSchema = z.strictObject({
  question: z.string().trim().min(3).max(400),
  /**
   * Suggested answers. Free text is always allowed, so options are never
   * required. Eight, not six: a live model listed eight for one question, and
   * discarding a whole update over one extra chip helps nobody.
   */
  options: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
});
export type DiscoveryQuestion = z.infer<typeof DiscoveryQuestionSchema>;

/** What a `DISCOVER` response may carry beside `reply` (WS-R30). */
export const DiscoveryUpdateSchema = z.strictObject({
  brief: DiscoveryBriefSchema,
  /** One to three high-value questions; none when FORGE has what it needs. */
  questions: z.array(DiscoveryQuestionSchema).max(3).default([]),
  /** Advisory: highlights the generate control, never triggers it (WS-R31). */
  ready: z.boolean().default(false),
  /** WS-R35: what current external research would be needed, if any. */
  research_needed: z.string().trim().min(1).max(600).nullable().default(null),
  /**
   * WS-R39: FORGE's reading of which artifact the user wants. A suggestion the
   * UI offers for confirmation — never applied to the conversation by itself.
   */
  artifact_kind: z.enum(["agent", "builder"]).nullable().default(null),
});
export type DiscoveryUpdate = z.infer<typeof DiscoveryUpdateSchema>;

/**
 * Read the `discovery` object out of a response. Returns null when there is
 * none or it does not validate — the caller keeps the previous state and says
 * so (FORGE-W003). Never a partial guess.
 */
export function parseDiscoveryUpdate(text: string): DiscoveryUpdate | null {
  return readDiscoveryUpdate(text).update;
}

/**
 * The same read, with the reason it failed — a diagnostic that only says
 * "did not match" cannot be acted on (INV-007).
 */
export function readDiscoveryUpdate(text: string): { update: DiscoveryUpdate | null; problem: string | null } {
  for (const candidate of jsonObjects(text)) {
    const discovery = (candidate as { discovery?: unknown }).discovery;
    if (discovery === undefined) continue;
    const parsed = DiscoveryUpdateSchema.safeParse(discovery);
    if (parsed.success) return { update: parsed.data, problem: null };
    const issue = parsed.error.issues[0];
    return {
      update: null,
      problem: issue ? `${issue.path.join(".") || "discovery"}: ${issue.message}` : "invalid",
    };
  }
  return { update: null, problem: "the response carried no discovery object" };
}

/**
 * Every top-level JSON object in a text, in order, parsed. Code fences are
 * tolerated because they are wrapping, not content; nothing inside an object is
 * reinterpreted. Shared with the classifier (WS-R34).
 */
export function jsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try {
          const value: unknown = JSON.parse(text.slice(start, i + 1));
          if (typeof value === "object" && value !== null && !Array.isArray(value)) found.push(value);
        } catch {
          // Not JSON after all; keep scanning for one that is.
        }
        start = -1;
      }
    }
  }
  return found;
}

/** The persisted discovery state of a conversation. */
export interface DiscoveryState {
  /**
   * `open` gates every classified write (WS-R31); `generated` after an explicit
   * generate; `closed` when the user left discovery without generating
   * (WS-R46). Only `open` gates anything.
   */
  readonly status: "open" | "generated" | "closed";
  /** `refine` when it opened on a pasted prompt (WS-R37); absent means explore. */
  readonly flavor?: "explore" | "refine";
  readonly brief: DiscoveryBrief;
  readonly questions: readonly DiscoveryQuestion[];
  readonly ready: boolean;
  readonly research_needed: string | null;
  /** WS-R39: the model's suggested artifact kind, awaiting the user's confirmation. */
  readonly artifact_kind?: "agent" | "builder" | null;
  /** WS-R44: every question shown so far, in order. Absent on pre-Sprint-2 states. */
  readonly asked?: readonly string[];
  /** How many discovery turns have updated this state. */
  readonly turns: number;
  /**
   * WS-R33 (amended): how the version an explicit generate wrote carries each
   * discovered item. Display and diagnosis only — never provenance, never the
   * ledger. Absent until a generate from discovery.
   */
  readonly coverage?: { readonly v: number; readonly items: readonly ItemCoverage[] };
  /**
   * WS-R32: the questions still open when the user generated anyway. From
   * then on they are a record of what FORGE decided, not an open interview.
   */
  readonly decided?: readonly string[];
}

export function openDiscovery(flavor: "explore" | "refine" = "explore"): DiscoveryState {
  return { status: "open", flavor, brief: {}, questions: [], ready: false, research_needed: null, asked: [], turns: 0 };
}

/**
 * WS-R44: drop every proposed question already asked in an earlier turn, or
 * repeated within this update. Deterministic; the model is also shown the
 * history, but that is a request, and this is the guarantee.
 */
export function freshQuestions(
  asked: readonly string[],
  proposed: readonly DiscoveryQuestion[],
): { kept: DiscoveryQuestion[]; dropped: string[] } {
  const kept: DiscoveryQuestion[] = [];
  const dropped: string[] = [];
  for (const q of proposed) {
    if ([...asked, ...kept.map((k) => k.question)].some((prior) => sameQuestion(prior, q.question))) {
      dropped.push(q.question);
    } else {
      kept.push(q);
    }
  }
  return { kept, dropped };
}

/**
 * Apply a validated update. The brief is replaced as a whole — the model sees
 * the previous brief and returns the new one — so removing an item is possible;
 * the event log keeps every prior state, so nothing is lost from history.
 */
/** WS-R37: refine discovery asks at most this many questions per turn. */
export const REFINE_QUESTION_LIMIT = 2;

export function applyDiscoveryUpdate(state: DiscoveryState, update: DiscoveryUpdate): DiscoveryState {
  const asked = state.asked ?? [];
  const { kept: fresh } = freshQuestions(asked, update.questions);
  // WS-R37 is enforced here, not requested: a refine turn that proposes more
  // than two questions keeps the first two, and the rest become open questions
  // in the brief — still visible, still stated as assumptions at generate
  // (WS-R32), never silently lost.
  const limit = state.flavor === "refine" ? REFINE_QUESTION_LIMIT : fresh.length;
  const kept = fresh.slice(0, limit);
  const overflow = fresh.slice(limit).map((q) => q.question);
  const brief =
    overflow.length > 0
      ? { ...update.brief, open_questions: [...(update.brief.open_questions ?? []), ...overflow].slice(0, 12) }
      : update.brief;
  return {
    status: "open",
    ...(state.flavor ? { flavor: state.flavor } : {}),
    brief,
    questions: kept,
    ready: update.ready,
    research_needed: update.research_needed,
    artifact_kind: update.artifact_kind,
    asked: [...asked, ...kept.map((q) => q.question)],
    turns: state.turns + 1,
  };
}

/** WS-R32: the brief's open questions plus the outstanding ones, de-duplicated, in order. */
export function unresolvedQuestions(state: DiscoveryState | null): string[] {
  if (state === null) return [];
  const out: string[] = [];
  for (const q of [...state.questions.map((x) => x.question), ...(state.brief.open_questions ?? [])]) {
    if (tokenize(q).length === 0) continue;
    // WS-R44's rule: a re-worded copy of a question is the same question.
    if (out.some((prior) => sameQuestion(prior, q))) continue;
    out.push(q);
  }
  return out;
}

/** The items WS-R33 checks, labelled for the finding. */
export function discoveredRequirements(brief: DiscoveryBrief): Array<{ field: string; text: string }> {
  return [
    ...(brief.goal ? [{ field: "goal", text: brief.goal }] : []),
    ...(brief.constraints ?? []).map((text) => ({ field: "constraint", text })),
    ...(brief.success_criteria ?? []).map((text) => ({ field: "success criterion", text })),
  ];
}

/**
 * The items WS-R33 checks, each with the short id the generation instruction
 * shows the model, so a citation can name the item it covers.
 */
export function coverageItems(brief: DiscoveryBrief): CoverageItem[] {
  const out: CoverageItem[] = [];
  if (brief.goal) out.push({ id: "G1", field: "goal", text: brief.goal });
  (brief.constraints ?? []).forEach((text, i) => out.push({ id: `C${i + 1}`, field: "constraint", text }));
  (brief.success_criteria ?? []).forEach((text, i) => out.push({ id: `S${i + 1}`, field: "success criterion", text }));
  return out;
}

/**
 * WS-R33 (amended): which discovered items are absent from a version, by
 * content-word coverage. The pinned ledger keeps the contiguous rule; this one
 * exists because the brief is FORGE's paraphrase, not the user's wording.
 */
export function absentDiscoveredRequirements(
  brief: DiscoveryBrief,
  versionText: string,
): Array<{ field: string; text: string }> {
  const pool = new Set(contentWords(versionText));
  return discoveredRequirements(brief).filter((item) => contentWords(item.text).length > 0 && !isCovered(item.text, pool));
}

export type BriefMark = "stated" | "inferred";

/**
 * WS-R45: mark each brief item `stated` when the user's own messages cover it,
 * `inferred` otherwise. Display-only: the mark is never provenance and never
 * enters an IR, the ledger or a package (INV-016).
 */
export function briefMarks(brief: DiscoveryBrief, userMessages: readonly string[]): Record<string, BriefMark> {
  const pool = new Set(contentWords(userMessages.join("\n")));
  const marks: Record<string, BriefMark> = {};
  for (const [key] of BRIEF_LABELS) {
    const value = brief[key];
    if (value === undefined) continue;
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) marks[item] = isCovered(item, pool) ? "stated" : "inferred";
  }
  return marks;
}

const BRIEF_LABELS: ReadonlyArray<readonly [keyof DiscoveryBrief, string]> = [
  ["vision", "Vision"],
  ["goal", "Goal"],
  ["target_user", "Target user"],
  ["problem", "Problem"],
  ["background", "Background / skill level"],
  ["capabilities", "Capabilities"],
  ["constraints", "Constraints"],
  ["success_criteria", "Success criteria"],
  ["open_questions", "Open questions"],
];

/** The brief as plain lines, for a generation instruction. Only known fields. */
export function renderBrief(brief: DiscoveryBrief): string[] {
  const lines: string[] = [];
  for (const [key, label] of BRIEF_LABELS) {
    const value = brief[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${label}:`, ...value.map((v) => `  - ${v}`));
    } else {
      lines.push(`${label}: ${value}`);
    }
  }
  return lines;
}

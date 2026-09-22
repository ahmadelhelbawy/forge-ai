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

import { containsSequence, tokenize } from "../critic/deterministic/ledger.js";

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
  /** Suggested answers. Free text is always allowed, so options are never required. */
  options: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
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
});
export type DiscoveryUpdate = z.infer<typeof DiscoveryUpdateSchema>;

/**
 * Read the `discovery` object out of a response. Returns null when there is
 * none or it does not validate — the caller keeps the previous state and says
 * so (FORGE-W003). Never a partial guess.
 */
export function parseDiscoveryUpdate(text: string): DiscoveryUpdate | null {
  for (const candidate of jsonObjects(text)) {
    const discovery = (candidate as { discovery?: unknown }).discovery;
    if (discovery === undefined) continue;
    const parsed = DiscoveryUpdateSchema.safeParse(discovery);
    return parsed.success ? parsed.data : null;
  }
  return null;
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
  /** `open` gates every classified write (WS-R31); `generated` after an explicit generate. */
  readonly status: "open" | "generated";
  readonly brief: DiscoveryBrief;
  readonly questions: readonly DiscoveryQuestion[];
  readonly ready: boolean;
  readonly research_needed: string | null;
  /** How many discovery turns have updated this state. */
  readonly turns: number;
}

export function openDiscovery(): DiscoveryState {
  return { status: "open", brief: {}, questions: [], ready: false, research_needed: null, turns: 0 };
}

/**
 * Apply a validated update. The brief is replaced as a whole — the model sees
 * the previous brief and returns the new one — so removing an item is possible;
 * the event log keeps every prior state, so nothing is lost from history.
 */
export function applyDiscoveryUpdate(state: DiscoveryState, update: DiscoveryUpdate): DiscoveryState {
  return {
    status: "open",
    brief: update.brief,
    questions: update.questions,
    ready: update.ready,
    research_needed: update.research_needed,
    turns: state.turns + 1,
  };
}

/** WS-R32: the brief's open questions plus the outstanding ones, de-duplicated, in order. */
export function unresolvedQuestions(state: DiscoveryState | null): string[] {
  if (state === null) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of [...(state.brief.open_questions ?? []), ...state.questions.map((x) => x.question)]) {
    const key = tokenize(q).join(" ");
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
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

/** WS-R33: which discovered items are absent from a version, by the §22.8 presence rule. */
export function absentDiscoveredRequirements(
  brief: DiscoveryBrief,
  versionText: string,
): Array<{ field: string; text: string }> {
  const haystack = tokenize(versionText);
  return discoveredRequirements(brief).filter((item) => {
    const needle = tokenize(item.text);
    return needle.length > 0 && !containsSequence(haystack, needle);
  });
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

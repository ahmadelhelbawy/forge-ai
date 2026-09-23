/**
 * Reading a first message (`spec.md` §22.12, WS-R36/WS-R37, FR-060).
 *
 * A user who pastes a developed prompt has already done the discovery, and a
 * user who says "just improve it" has already answered the only question that
 * matters. Both are facts about the message's SHAPE and its WORDS, so they are
 * read by a pure function rather than asked of a model: the answer is cheaper,
 * faster, replayable, and cannot be talked into anything by the pasted text.
 *
 * What this reads is deliberately narrow — structural signals and a published
 * phrase list. It never reinterprets anything else: a message that does not
 * match is an ordinary message and goes to the classifier as before.
 */

export type TransformationMode = "polish" | "strengthen" | "rebuild";
export const TRANSFORMATION_MODES: readonly TransformationMode[] = ["polish", "strengthen", "rebuild"];

export function isTransformationMode(value: unknown): value is TransformationMode {
  return typeof value === "string" && (TRANSFORMATION_MODES as readonly string[]).includes(value);
}

export interface IntakeTarget {
  readonly id: string;
  /** Names a user might write: the display name and the id's words. */
  readonly names: readonly string[];
}

export interface Intake {
  readonly kind: "idea" | "existing_prompt";
  /** The user asked to skip review (WS-R37). Only meaningful for an existing prompt. */
  readonly direct: boolean;
  /** The mode the user's words name, if any (WS-R38). */
  readonly mode: TransformationMode | null;
  /** The one target profile the instruction names, if exactly one (WS-R37). */
  readonly target: string | null;
  /** Which structural signals were found — shown, so the call is reviewable. */
  readonly signals: readonly string[];
}

/** WS-R36: a pasted prompt is at least this long. */
export const EXISTING_PROMPT_MIN_CHARS = 400;
/** WS-R36: and shows at least this many structural signals. */
export const EXISTING_PROMPT_MIN_SIGNALS = 2;
/** The instruction is read from the edges of the message, never the body. */
const INSTRUCTION_WINDOW = 400;

/**
 * WS-R37: phrases that ask to skip review. Published here, tested as a list,
 * and matched on word boundaries in the instruction window only — a pasted
 * prompt that happens to say "generate now" in its body does not count.
 */
export const DIRECT_PHRASES: readonly string[] = [
  "just improve",
  "just polish",
  "just strengthen",
  "just rebuild",
  "just rewrite",
  "just fix",
  "just generate",
  "just do it",
  "just make it better",
  "generate now",
  "generate it now",
  "improve it now",
  "no questions",
  "don't ask",
  "do not ask",
  "skip the questions",
  "without asking",
  "compile this for",
  "compile it for",
];

const MODE_WORDS: ReadonlyArray<readonly [TransformationMode, readonly string[]]> = [
  ["rebuild", ["rebuild", "rewrite from scratch", "re-architect", "rearchitect", "restructure", "start over"]],
  ["polish", ["polish", "tighten", "clean up", "cleanup", "proofread", "light touch", "minor edits"]],
  ["strengthen", ["strengthen", "harden", "make it more robust", "make it stronger"]],
];

const SIGNALS: ReadonlyArray<readonly [string, RegExp]> = [
  ["role_or_task_line", /^\s*(?:[-*>]\s*)?(?:you are|you're|you will|your (?:task|job|role|goal)|act as)\b/im],
  ["markdown_heading", /^\s{0,3}#{1,6}\s+\S/m],
  ["list_items", /(?:^\s*(?:[-*•]|\d+[.)])\s+\S.*$[\s\S]*?){3}/m],
  [
    "named_section",
    /^\s*(?:#+\s*)?(?:constraints?|rules?|requirements?|output(?: format)?|steps?|instructions?|context|goals?|success criteria|non-goals?|deliverables?)\s*:?\s*$/im,
  ],
  ["fenced_or_quoted_block", /```|^\s*>\s+\S|^\s*"[^"\n]{40,}/m],
];

function normalise(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
}

function hasPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

/** The words around a pasted body: its first and last few hundred characters. */
function instructionWindow(message: string): string {
  if (message.length <= INSTRUCTION_WINDOW * 2) return normalise(message);
  return normalise(`${message.slice(0, INSTRUCTION_WINDOW)} ${message.slice(-INSTRUCTION_WINDOW)}`);
}

export function readIntake(message: string, targets: readonly IntakeTarget[] = []): Intake {
  const signals = SIGNALS.filter(([, pattern]) => pattern.test(message)).map(([name]) => name);
  const existing = message.trim().length >= EXISTING_PROMPT_MIN_CHARS && signals.length >= EXISTING_PROMPT_MIN_SIGNALS;
  const window = instructionWindow(message);

  const direct = existing && DIRECT_PHRASES.some((phrase) => hasPhrase(window, phrase));
  let mode: TransformationMode | null = null;
  for (const [candidate, words] of MODE_WORDS) {
    if (words.some((w) => hasPhrase(window, w))) {
      mode = candidate;
      break;
    }
  }

  const named = targets.filter((t) => t.names.some((n) => n.trim().length >= 4 && hasPhrase(window, normalise(n))));
  const target = named.length === 1 ? named[0]!.id : null;

  return { kind: existing ? "existing_prompt" : "idea", direct, mode, target, signals };
}

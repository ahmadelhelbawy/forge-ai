/**
 * Content-word coverage (`spec.md` WS-R33 as amended, WS-R44, WS-R45).
 *
 * The §22.8 presence rule is contiguous on purpose: pinned text is the user's
 * wording, and a prompt owes it verbatim. Discovery items are different — the
 * brief is FORGE's own summary — and the live Sprint 1 run showed the strict
 * rule reporting paraphrases as drops (three of three). This is the looser rule
 * those items need, and ONLY those items: nothing here is reachable from the
 * ledger check, which stays contiguous (WS-R27).
 *
 * Deterministic and model-free: a fixed stop-word list, the ledger's own
 * tokenizer, and a threshold published in the specification.
 */
import { tokenize } from "../critic/deterministic/ledger.js";

/** WS-R33: an item is present when this share of its content words occurs. */
export const COVERAGE_THRESHOLD = 0.8;
/** WS-R44: two questions are the same question at this Jaccard similarity. */
export const QUESTION_SIMILARITY = 0.8;

/**
 * Words that carry no requirement on their own. Short on purpose: every entry
 * is a word whose presence proves nothing about whether an item survived.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "from", "into", "onto", "are", "was",
  "were", "been", "being", "have", "has", "had", "will", "would", "should", "could", "can", "may",
  "might", "must", "shall", "not", "but", "any", "all", "each", "every", "its", "it's", "their",
  "they", "them", "you", "your", "yours", "our", "ours", "who", "whom", "what", "which", "when",
  "where", "why", "how", "than", "then", "there", "here", "such", "also", "only", "very", "more",
  "most", "some", "own", "per", "via", "about", "over", "under", "does", "did", "doing", "just",
  "want", "wants", "need", "needs", "use", "using",
]);

/**
 * Fold the commonest English inflections so "approve", "approves" and
 * "approved" count as one word. Deliberately crude and fixed: a summary FORGE
 * wrote changes a verb's ending far more often than its stem, and anything
 * cleverer would be a model-shaped judgement in a deterministic check.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** The words of a text that could carry a requirement, stemmed, de-duplicated, in order. */
export function contentWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenize(text)) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    const word = stem(token);
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/** Share of `item`'s content words that occur anywhere in `haystack` (0..1). */
export function coverage(item: string, haystack: string | ReadonlySet<string>): number {
  const words = contentWords(item);
  if (words.length === 0) return 0;
  const pool = typeof haystack === "string" ? new Set(contentWords(haystack)) : haystack;
  return words.filter((w) => pool.has(w)).length / words.length;
}

/** WS-R33: is the item carried by the text? */
export function isCovered(item: string, haystack: string | ReadonlySet<string>): boolean {
  return coverage(item, haystack) >= COVERAGE_THRESHOLD;
}

/** Jaccard similarity of two texts' content words (0..1). */
export function similarity(a: string, b: string): number {
  const left = new Set(contentWords(a));
  const right = new Set(contentWords(b));
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** WS-R44: the same question, however it was re-worded. */
export function sameQuestion(a: string, b: string): boolean {
  if (similarity(a, b) >= QUESTION_SIMILARITY) return true;
  // A copy with a word added ("…today?") is still the same question.
  const [shorter, longer] = [contentWords(a), contentWords(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  const pool = new Set(longer);
  return shorter.length >= 3 && shorter.every((w) => pool.has(w));
}

// ── Discovered-item coverage with polarity and citations (WS-R33, amended) ──
//
// Word overlap alone fails both ways: a faithful paraphrase ("keep answers
// under 150 words" for "responses must be short") shares almost no words, and
// a contradiction ("store raw audio" for "never store raw audio") shares all
// of them. The check below keeps overlap as the first, model-free test, adds a
// fixed polarity rule so shared words with opposite negation never count as
// carried, and accepts a paraphrase only when the generating model CITED the
// passage that carries it and FORGE finds that passage verbatim in the version.
// A citation proves the passage exists, not that it means the same thing: it
// is shown to the user as the model's claim, and the status says so.

/** Tokens that negate the words after them. `t` is what `n't` tokenizes to. */
const NEGATIONS: ReadonlySet<string> = new Set([
  "not", "never", "no", "without", "nor", "none", "neither", "cannot", "avoid", "avoids", "avoiding",
  "forbid", "forbids", "forbidden", "prohibit", "prohibits", "prohibited", "exclude", "excluding", "t",
]);
/** How many tokens after a negation it still governs. Fixed, published. */
export const NEGATION_SCOPE = 4;

/** Content words of a passage, each with whether a negation governs it. */
function polarity(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  // Clause boundaries end a negation's scope.
  for (const clause of text.split(/[.;:!?\n]+|\bbut\b/i)) {
    const tokens = tokenize(clause);
    let lastNegation = -Infinity;
    tokens.forEach((token, i) => {
      if (NEGATIONS.has(token)) {
        lastNegation = i;
        return;
      }
      if (token.length < 3 || STOP_WORDS.has(token)) return;
      const word = stem(token);
      const negated = i - lastNegation <= NEGATION_SCOPE;
      // A word both asserted and negated in one passage counts as asserted.
      out.set(word, (out.get(word) ?? true) && negated);
    });
  }
  return out;
}

/**
 * True when more than half of the content words an item and a passage share
 * are negated in one and not the other — "never store audio" against "store
 * audio for 30 days". Deterministic and deliberately conservative: a single
 * disagreeing word is not enough.
 */
export function polarityConflict(item: string, passage: string): boolean {
  const a = polarity(item);
  const b = polarity(passage);
  let shared = 0;
  let disagree = 0;
  for (const [word, negated] of a) {
    const other = b.get(word);
    if (other === undefined) continue;
    shared += 1;
    if (other !== negated) disagree += 1;
  }
  return shared > 0 && disagree * 2 > shared;
}

/** The passages of a prompt: lines, split further at sentence ends. */
export function passages(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter((p) => tokenize(p).length > 0);
}

/** A discovered item the generating model says a passage carries. */
export interface CoverageClaim {
  readonly item: string;
  readonly quote: string;
}

/** A discovered item, with the id the generation instruction gave it. */
export interface CoverageItem {
  readonly id: string;
  readonly field: string;
  readonly text: string;
}

/**
 * - `worded`: its content words are carried, with the same polarity.
 * - `cited`: the model cited a passage, FORGE found it verbatim, and it does
 *   not contradict the item — a paraphrase, taken on the model's word.
 * - `contradicted`: the only passages that carry its words negate it.
 * - `absent`: neither its words nor a verifiable citation.
 */
export type CoverageStatus = "worded" | "cited" | "contradicted" | "absent";

export interface ItemCoverage extends CoverageItem {
  readonly status: CoverageStatus;
  /** The passage that carries (or contradicts) it, when there is one. */
  readonly passage?: string;
}

/** Bounds on a citation: long enough to mean something, short enough to be one passage. */
const QUOTE_MIN = 8;
const QUOTE_MAX = 800;

/**
 * Overlap for WS-R33 excludes negation words: whether an item is negated is
 * the polarity rule's question, and counting "never" as a word to find made a
 * contradiction ("store raw audio" for "never store raw audio") read as a
 * mere omission.
 */
function itemWords(text: string): string[] {
  return contentWords(text).filter((w) => !NEGATIONS.has(w));
}

function carries(item: string, pool: ReadonlySet<string>): boolean {
  const words = itemWords(item);
  return words.length > 0 && words.filter((w) => pool.has(w)).length / words.length >= COVERAGE_THRESHOLD;
}

function normalise(text: string): string {
  return text.replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** WS-R33 (amended): how each discovered item is carried by a version. */
export function checkCoverage(
  items: readonly CoverageItem[],
  versionText: string,
  claims: readonly CoverageClaim[],
): ItemCoverage[] {
  const parts = passages(versionText);
  const whole = new Set(contentWords(versionText));
  const haystack = normalise(versionText);
  return items.map((item): ItemCoverage => {
    if (itemWords(item.text).length === 0) return { ...item, status: "worded" };
    const carrying = parts.filter((p) => carries(item.text, new Set(contentWords(p))));
    const agreeing = carrying.find((p) => !polarityConflict(item.text, p));
    if (agreeing !== undefined) return { ...item, status: "worded", passage: agreeing };
    // Every verified citation is considered: one that agrees wins over one
    // that conflicts, whatever order the model listed them in.
    let conflicting: string | null = null;
    for (const claim of claims) {
      if (claim.item !== item.id) continue;
      const quote = normalise(claim.quote);
      if (quote.length < QUOTE_MIN || quote.length > QUOTE_MAX || !haystack.includes(quote)) continue;
      if (!polarityConflict(item.text, claim.quote)) return { ...item, status: "cited", passage: claim.quote.trim() };
      conflicting ??= claim.quote.trim();
    }
    if (conflicting !== null) return { ...item, status: "contradicted", passage: conflicting };
    if (carrying.length > 0) return { ...item, status: "contradicted", passage: carrying[0] };
    // The pre-amendment rule, words scattered across the whole prompt, is kept
    // as the last resort so this check never reports more than it used to —
    // unless a polarity conflict was found above.
    if (carries(item.text, whole)) return { ...item, status: "worded" };
    return { ...item, status: "absent" };
  });
}

/**
 * Read the `coverage` array a generate response may carry beside its
 * envelope. Anything malformed is ignored item by item: a claim is only ever
 * a pointer FORGE then checks, so a bad one costs nothing but its own credit.
 */
export function parseCoverageClaims(objects: readonly unknown[]): CoverageClaim[] {
  const out: CoverageClaim[] = [];
  for (const object of objects) {
    const list = (object as { coverage?: unknown }).coverage;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const { item, quote } = entry as { item?: unknown; quote?: unknown };
      if (typeof item === "string" && typeof quote === "string") out.push({ item, quote });
    }
  }
  return out;
}

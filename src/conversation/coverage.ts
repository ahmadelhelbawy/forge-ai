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

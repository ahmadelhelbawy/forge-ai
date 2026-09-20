/**
 * Per-instruction-node query derivation (FR-025, CE-R2, docs/architecture.md §10.2).
 *
 * Queries are derived deterministically from goal and constraint text, so a
 * candidate found by node X's query justifies X BY CONSTRUCTION (FR-026).
 * Justification is then a recorded fact about how the reference was found,
 * not a model's opinion — which is why the `context.justify` boundary was
 * removed (MB-R4).
 *
 * No filesystem access, no model, no clock. Pure functions of the IR.
 */

export interface NodeQuery {
  /** The goal (`g…`) or constraint (`c…`) this query was derived from. */
  readonly nodeId: string;
  readonly kind: "goal" | "constraint";
  /** Sorted, de-duplicated, lowercase search terms. */
  readonly terms: readonly string[];
}

/**
 * Closed-class words carry no retrieval signal ("fix THE login" — "the" matches
 * everything). This list is deliberately conservative: domain verbs ("fix",
 * "refresh", "reuse") are KEPT, because in a repository they discriminate.
 * Documented here so a precision problem can be traced to an explicit choice.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "nor", "but", "so", "if", "then", "else",
  "when", "where", "which", "while", "what", "how", "why", "who", "whom",
  "whether", "either", "neither", "all", "any", "both", "each", "every",
  "few", "more", "most", "other", "some", "such", "only", "own", "same",
  "too", "very", "just", "no", "not", "none", "of", "to", "in", "on",
  "for", "with", "without", "by", "from", "as", "at", "is", "are", "was",
  "were", "be", "been", "being", "do", "does", "did", "done", "have",
  "has", "had", "having", "it", "its", "this", "that", "these", "those",
  "there", "their", "they", "them", "he", "she", "we", "you", "your",
  "our", "ours", "his", "her", "hers", "must", "shall", "should", "would",
  "could", "will", "may", "might", "can", "cannot", "need", "needs",
  "about", "above", "below", "over", "under", "into", "out", "during",
  "before", "after", "between", "through", "against", "along", "among",
  "across", "around", "per", "via", "upon", "onto", "toward", "towards",
  "since", "except", "despite", "until", "unless", "lest", "than", "also",
  "within", "etc",
]);

/**
 * Invisible characters used to smuggle text past scanners. Stripped BEFORE
 * term extraction so a segmented term still yields its plain form — an
 * attacker who splits a word gains nothing, and a detector reading the
 * normalized text sees what the renderer would show. Covers zero-width
 * characters (U+200B–U+200F), bidi controls (U+202A–U+202E, U+2066–U+2069)
 * and BOM (U+FEFF). Zero-width joiners inside emoji are collateral; context
 * queries are ASCII-biased by design and emoji carry no retrieval signal.
 */
const INVISIBLE_PATTERN = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]",
  "g",
);

export function normalizeText(text: string): string {
  return text.replace(INVISIBLE_PATTERN, "").toLowerCase();
}

/**
 * Split identifiers so `AuthProvider` yields `auth`, `provider`, AND the
 * joined `authprovider` — a query for either form finds the symbol, and a
 * query for the exact compound still matches verbatim occurrences.
 *
 * Runs on the ORIGINAL case: lowercasing first would destroy the CamelCase
 * boundaries this split depends on.
 */
function splitIdentifier(token: string): string[] {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const parts = spaced.split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  if (parts.length > 1) parts.push(parts.join(""));
  return parts;
}

export function tokenize(text: string): string[] {
  const stripped = text.replace(INVISIBLE_PATTERN, "");
  const out = new Set<string>();
  for (const raw of stripped.split(/[^A-Za-z0-9]+/)) {
    if (raw.length === 0) continue;
    for (const part of splitIdentifier(raw)) {
      const lower = part.toLowerCase();
      if (lower.length >= 3 && !STOPWORDS.has(lower)) out.add(lower);
    }
  }
  return [...out].sort();
}

export interface QuerySourceNode {
  readonly id: string;
  readonly kind: "goal" | "constraint";
  readonly texts: readonly string[];
}

export function deriveQuery(node: QuerySourceNode): NodeQuery {
  const terms = new Set<string>();
  for (const text of node.texts) {
    for (const term of tokenize(text)) terms.add(term);
  }
  return { nodeId: node.id, kind: node.kind, terms: [...terms].sort() };
}

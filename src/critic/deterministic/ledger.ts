/**
 * Layer 1 — the requirement ledger check (WS-R24, WS-R25, WS-R27.3, WS-R29).
 *
 * The product's central promise is that a revision changes what was asked and
 * nothing else. This module is the half of that promise which is a mechanical
 * guarantee rather than advice: it decides, with **no model call, no clock and
 * no randomness**, whether each requirement the user pinned still survives in a
 * version of the prompt.
 *
 * Everything here is a pure function of `(entries, versionText)`. That is what
 * lets AC-039 assert byte-identical results across repeated runs, and what lets
 * AC-040 assert that Layer 1 reaches its verdict with Layer 2 switched off: the
 * judged layer is not an input, so it cannot be a dependency.
 *
 * The presence rule is published in spec.md §22.8 and implemented once, in
 * `tokenize` and `containsSequence` below. It is deliberately strict about
 * meaning and forgiving about surface: reformatting cannot break a match and a
 * paraphrase always does, because a paraphrase is Layer 2's subject. A rule
 * that tried to be clever here would be a similarity score wearing a
 * guarantee's clothes.
 */
import { diagnostic, measureEvidence, type Diagnostic, type Evidence } from "../../ir/diagnostic.js";

/** One pinned requirement, as the ledger stores it. Text is user-authored. */
export interface LedgerEntry {
  readonly id: string;
  /** Verbatim user text (WS-R24). Never rewritten or re-derived by a model. */
  readonly text: string;
  /** The hash that names the text, so a tampered entry is detectable. */
  readonly contentHash: string;
  /** FORGE-assigned attribution. The ledger admits one origin, by design. */
  readonly origin: "user_input";
}

/** The per-entry verdict. `present` is the whole answer; there is no score. */
export interface LedgerFinding {
  readonly entryId: string;
  readonly text: string;
  readonly present: boolean;
}

export interface LedgerCheckResult {
  /** The version checked. Carried so a finding can name where it was dropped. */
  readonly v: number;
  readonly findings: readonly LedgerFinding[];
  /** One `FORGE-W005` per absent entry, in ledger order. */
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The published normalization (spec.md §22.8).
 *
 * NFKC first, so a full-width or composed character cannot smuggle a
 * difference past a comparison the user would read as identical. Case folding
 * and non-alphanumeric separation follow, which is what makes "must use
 * PostgreSQL." match "- Must use PostgreSQL" while leaving the words intact.
 */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** True when `needle` occurs contiguously inside `haystack`. */
export function containsSequence(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** The presence rule itself, exported so a caller can explain a verdict. */
export function isPresent(versionText: string, pinnedText: string): boolean {
  return containsSequence(tokenize(versionText), tokenize(pinnedText));
}

/**
 * Check a version — or another artifact — against the ledger.
 *
 * Returns a finding for every entry — a caller that renders only failures
 * would leave the user unable to tell "checked and held" from "not checked",
 * and WS-R27.2 makes that distinction load-bearing.
 *
 * The diagnostic cites the pinned text (as a span into the entry, which the
 * caller can resolve by id) and the version it relates to (as a measure).
 * Both are what WS-R25 requires it to name.
 *
 * `subject` names what was checked, and defaults to the version. V2-E runs the
 * same rule over *candidates*, which are not versions: reporting one as
 * "dropped in version 1" would be a false statement about a version that does
 * contain the requirement. Naming the subject is the whole of the difference —
 * the rule, the tokenization and the verdict are identical.
 */
export function checkRequirementLedger(
  entries: readonly LedgerEntry[],
  versionText: string,
  v: number,
  subject?: string,
): LedgerCheckResult {
  const named = subject ?? `version ${v}`;
  const haystack = tokenize(versionText);
  const findings: LedgerFinding[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    const present = containsSequence(haystack, tokenize(entry.text));
    findings.push(Object.freeze({ entryId: entry.id, text: entry.text, present }));
    if (present) continue;
    const evidence: Evidence[] = [
      {
        kind: "span",
        artifact_path: `ledger/${entry.id}`,
        start: 0,
        end: entry.text.length,
        quote: entry.text,
      },
      // Which claim the number supports depends on what was checked: a
      // version dropped it, whereas a candidate merely derives from one.
      subject === undefined
        ? measureEvidence("dropped_in_version", v, "version")
        : measureEvidence("derived_from_version", v, "version"),
    ];
    diagnostics.push(
      diagnostic(
        "FORGE-W005",
        `Pinned requirement ${entry.id} is absent from ${named}: "${entry.text}". ` +
          `It was pinned to be kept, and this ${subject === undefined ? "version" : "artifact"} does not contain it.`,
        evidence,
      ),
    );
  }

  return Object.freeze({ v, findings: Object.freeze(findings), diagnostics: Object.freeze(diagnostics) });
}

/** True when this version drops at least one pinned requirement. */
export function hasPreservationFailure(result: LedgerCheckResult): boolean {
  return result.diagnostics.length > 0;
}

/**
 * A fingerprint of the ledger's content (WS-R27.4, AC-042).
 *
 * The guard rather than the promise: a caller that runs a model over a
 * conversation takes this before and after and refuses to accept a difference.
 * It covers id, text and hash in order, so an edit, a removal, a reorder and an
 * addition all change it.
 */
export function ledgerFingerprint(entries: readonly LedgerEntry[]): string {
  return JSON.stringify(entries.map((e) => [e.id, e.contentHash, e.text]));
}

/**
 * Deterministic pin candidates (WS-R24: FORGE may *propose*).
 *
 * Proposals come from text that is already in the conversation, chosen by a
 * fixed rule — a line carrying an obligation word — and never from a model.
 * That matters more than the quality of the suggestions: a proposal path with
 * a model in it would be a model path adjacent to the ledger, and the whole
 * point of Layer 1 is that no such path exists.
 *
 * Ordered by first appearance and de-duplicated, so the same text proposes the
 * same list every time.
 */
const OBLIGATION = /\b(must|must not|never|always|required|shall|do not|don't|cannot|only)\b/i;

export function proposeRequirementCandidates(text: string, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*+•]|\d+[.)])\s*/, "").trim();
    if (line.length < 8 || line.length > 300) continue;
    if (!OBLIGATION.test(line)) continue;
    const key = tokenize(line).join(" ");
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

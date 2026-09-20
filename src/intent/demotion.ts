/**
 * `FORGE-W008` — a requirement the user stated reached the IR only as a guess.
 *
 * THE DEFECT. The Product-Value Audit gave FORGE a request containing, verbatim,
 * "all existing tests must keep passing". Extraction produced no goal, no
 * constraint and no verification carrying it; it reached the artifact as a
 * medium-confidence assumption. The extraction prompt is entirely one-directional
 * on this: rule 1 forbids inventing requirements and rule 2 offers `assumptions`
 * as the home for uncertainty, but nothing forbids DEMOTION — moving something
 * the user did say into a node that says FORGE is merely supposing it.
 *
 * WHAT THIS DOES AND, MORE IMPORTANTLY, DOES NOT DO. It reports. It does not
 * repair. Promoting the assumption into a constraint would require inventing a
 * `hardness` and a `kind` the user never supplied, which is the fabrication that
 * rule 1 exists to forbid — and a deterministic function has even less basis for
 * that guess than the model does. So `detectDemotedRequirements` is pure: it
 * takes the text and the IR, returns diagnostics, and touches neither.
 *
 * WHY IT IS SO RELUCTANT TO FIRE. A detector that cries wolf teaches users to
 * scroll past diagnostics, and the cost of that is paid by every other code in
 * the catalogue. Three independent conditions must all hold before it speaks:
 * the user's own sentence must carry a deontic modal; an assumption or open
 * question must closely restate that sentence; and NO requirement-bearing node
 * may cover it. Paraphrase in the requirement-bearing direction therefore
 * silences it, which is the right way round — a missed demotion costs one
 * warning, a false one costs the catalogue's credibility.
 *
 * It compares words, not meaning. That ceiling is deliberate and permanent here:
 * a judged version of this check would be `critic.judge`, which is not in the
 * boundary registry, and `INV-012`'s answer to a deterministic check's blind
 * spots is not to reach for a model.
 */
import {
  diagnostic,
  nodeEvidence,
  type Diagnostic,
  type Evidence,
} from "../ir/diagnostic.js";
import type { TaskIR } from "../ir/schema.js";

/**
 * Obligation markers, as a closed list.
 *
 * Only unambiguous ones. `should` and `prefer` are absent on purpose: they
 * express preference, and an assumption is a legitimate home for a preference
 * the model could not pin down. The test is applied to the user's sentence, so
 * a marker here means the human wrote an obligation, not that the model read
 * one into the text.
 */
const DEONTIC = [
  "must",
  "must not",
  "mustn't",
  "shall",
  "shall not",
  "has to",
  "have to",
  "had to",
  "required",
  "requires",
  "cannot",
  "can not",
  "can't",
  "may not",
  "never",
  "always",
  "do not",
  "don't",
  "needs to",
  "need to",
  "mandatory",
];

/**
 * Words carrying no discriminating power. Dropping them is what lets "All
 * existing tests must keep passing" match "Every existing test must keep
 * passing" without letting it match an unrelated sentence of similar length.
 */
const STOPWORDS = new Set([
  "a", "all", "an", "and", "any", "are", "as", "at", "be", "been", "being", "both", "but", "by",
  "can", "could", "did", "do", "does", "each", "every", "for", "from", "had", "has", "have",
  "in", "into", "is", "it", "its", "may", "might", "must", "no", "not", "of", "on", "one", "only",
  "or", "our", "out", "over", "shall", "should", "so", "some", "such", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "those", "to", "under", "up", "us",
  "was", "we", "were", "what", "when", "which", "while", "will", "with", "would", "you", "your",
]);

/**
 * Crude suffix stripping, not a stemmer.
 *
 * It exists for exactly one job: "tests" must match "test" and "passing" must
 * match "passes", because that is the difference between a sentence the user
 * wrote and the same requirement restated by a model. Anything cleverer would
 * start collapsing words that mean different things, which widens the match and
 * costs false positives — the one currency this detector cannot spend.
 */
function stem(word: string): string {
  for (const suffix of ["ing", "ies", "es", "ed", "s"]) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const trimmed = word.slice(0, -suffix.length);
      return suffix === "ies" ? `${trimmed}y` : trimmed;
    }
  }
  return word;
}

/** Content words of a phrase: lowercased, punctuation-free, stopword-free, stemmed. */
function contentWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .map(stem);
  return new Set(words);
}

/**
 * Sentence split. Obligations are written as sentences or as clauses joined by
 * a semicolon, so those are the boundaries; splitting on commas would shred
 * "The public API must not change, and we cannot ship a breaking change" into
 * fragments too short to match anything safely.
 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function hasDeonticModal(sentence: string): boolean {
  const padded = ` ${sentence.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ")} `;
  return DEONTIC.some((marker) => padded.includes(` ${marker} `));
}

/**
 * How much of the user's sentence a candidate node restates.
 *
 * Directional on purpose: the question is whether the NODE covers what the USER
 * said, not whether the two are the same length. A constraint that adds detail
 * still carries the requirement; a node that drops half of it does not.
 */
function coverage(userWords: Set<string>, nodeText: string): number {
  if (userWords.size === 0) return 0;
  const node = contentWords(nodeText);
  let hit = 0;
  for (const word of userWords) if (node.has(word)) hit += 1;
  return hit / userWords.size;
}

/**
 * A high bar, chosen so near-verbatim restatement matches and topical overlap
 * does not. At 0.8, "all existing tests must keep passing" is covered by "every
 * existing test must keep passing" but not by "run the test suite".
 */
const COVERAGE_THRESHOLD = 0.8;

/**
 * Sentences shorter than this carry too little signal for a word-overlap test:
 * "it must work" would match almost anything. Below the floor the detector says
 * nothing rather than guessing.
 */
const MIN_CONTENT_WORDS = 3;

/** Every string in the IR that constitutes a requirement reaching the agent. */
function requirementBearingText(ir: TaskIR): string[] {
  return [
    ir.objective.statement,
    ir.objective.success_definition,
    ...ir.goals.flatMap((g) => [g.statement, ...g.acceptance]),
    ...ir.constraints.map((c) => c.statement),
    ...ir.non_goals.map((n) => n.statement),
    ...ir.scope.include,
    ...ir.scope.exclude,
    ...ir.verification.flatMap((v) => [v.spec, v.expected]),
    ...ir.deliverables.map((d) => d.description),
  ];
}

/** The two node kinds that say "FORGE supposes" rather than "the user requires". */
function carriers(ir: TaskIR): Array<{ readonly id: string; readonly text: string }> {
  return [
    ...ir.assumptions.map((a) => ({ id: a.id, text: a.statement })),
    ...ir.open_questions.map((q) => ({ id: q.id, text: q.question })),
  ];
}

/**
 * Report every obligation the user wrote that survives only in a node which
 * does not oblige the agent. Pure: the IR is read, never written.
 *
 * `text` is the user's original input, which is why this cannot live inside the
 * compiler — by compile time the text is gone and only the IR remains.
 */
export function detectDemotedRequirements(text: string, ir: TaskIR): readonly Diagnostic[] {
  const requirementText = requirementBearingText(ir);
  const carrierNodes = carriers(ir);
  if (carrierNodes.length === 0) return [];

  const found: Diagnostic[] = [];
  for (const sentence of sentences(text)) {
    if (!hasDeonticModal(sentence)) continue;
    const words = contentWords(sentence);
    if (words.size < MIN_CONTENT_WORDS) continue;

    // Silent the moment anything that actually binds the agent covers it.
    if (requirementText.some((t) => coverage(words, t) >= COVERAGE_THRESHOLD)) continue;

    const matched = carrierNodes.filter((c) => coverage(words, c.text) >= COVERAGE_THRESHOLD);
    if (matched.length === 0) continue;

    const evidence: Evidence[] = matched.map((c) => nodeEvidence(c.id));
    found.push(
      diagnostic(
        "FORGE-W008",
        `The input states a requirement — "${sentence}" — that reaches the artifact only as ` +
          `${matched.length === 1 ? "an inference" : "inferences"} (${matched.map((c) => c.id).join(", ")}). ` +
          `No goal, constraint, non-goal, scope entry, verification or deliverable carries it, so the agent ` +
          `is told FORGE supposes it rather than that the user required it. FORGE reports this and changes ` +
          `nothing: assigning a hardness and a kind the user did not give would be a fabrication.`,
        evidence,
      ),
    );
  }
  return found;
}

/**
 * Compaction — declining to print what the artifact already says (FR-051).
 *
 * WHAT THE AUDIT ACTUALLY FOUND. Shipped artifacts ran 400–780 words with heavy
 * repetition, and most of it was not the renderer's: a goal's only acceptance
 * criterion repeating the goal, a deliverable repeating the objective, a
 * `manual` verification step with no observable check whose spec and expected
 * were both already on the page. That content is the user's, arriving through
 * the model, and INV-001's separation means the renderer may not rewrite it. It
 * may, however, decline to print the same sentence twice.
 *
 * WHY THIS IS NOT A GENERIC DEDUPLICATOR. "Delete any line whose tokens appear
 * elsewhere" would delete `stop_conditions` entirely, then most of
 * `constraints`, and the artifact would get shorter in exactly the places where
 * repetition is doing work. So category membership is the TRIGGER and lexical
 * containment is only a SAFETY GUARD — never the other way round. The list of
 * categories is closed, sits in this file, and nothing infers new ones.
 *
 * THE GUARANTEE THAT MATTERS. The pinned-requirement ledger decides whether a
 * requirement survived using contiguous token containment (spec.md §22.8). If
 * compaction removes tokens, a pinned requirement can go from present to absent
 * and FORGE would be quietly breaking its loudest promise. Every suppression is
 * therefore conditioned on the suppressed line's own token sequence still
 * occurring, contiguously, inside a string that is always rendered and never
 * compacted — the objective, a goal statement, a constraint statement or scope.
 * A removed line's words are still in the file; that is the whole permission.
 *
 * EXEMPT BY DECISION, not by oversight: `constraints` and `stop_conditions`.
 * `stop_conditions` is the most obviously redundant thing FORGE emits — it
 * restates hard constraints and scope in a second framing — and it stays,
 * because an agent that ignored a constraint in one framing may not ignore it
 * in the other. That is worth more than the words it costs.
 *
 * Size is never a reason to suppress. There is no target here, no budget, and
 * no section is ever removed: `MANDATORY_SECTIONS` and the topology-completeness
 * rule (AP-R9, INV-017) are untouched, because suppression is content-level.
 */
import { containsSequence, tokenize } from "../critic/deterministic/ledger.js";
import { diagnostic, nodeEvidence, type Diagnostic } from "../ir/diagnostic.js";
import type { EffectiveIR } from "./types.js";

/**
 * What a section emitter consults before printing a line.
 *
 * Keys are stable and positional where a node can produce several lines:
 * `g1::0` is the first acceptance criterion of `g1`.
 */
export interface Compaction {
  readonly acceptance: ReadonlySet<string>;
  readonly deliverables: ReadonlySet<string>;
  readonly verification: ReadonlySet<string>;
  readonly diagnostics: readonly Diagnostic[];
}

/** Compaction that suppresses nothing — the `compact: false` and "no repetition" case. */
export const NO_COMPACTION: Compaction = Object.freeze({
  acceptance: new Set<string>(),
  deliverables: new Set<string>(),
  verification: new Set<string>(),
  diagnostics: [],
});

export const acceptanceKey = (goalId: string, index: number): string => `${goalId}::${index}`;

/**
 * Strings that are always rendered and never compacted, and are therefore the
 * only place a suppressed line's words may be said to survive.
 *
 * `goals`, `objective` and `constraints` are `MANDATORY_SECTIONS` — a topology
 * cannot omit them — and `scope` is exempt from every category below. Matching
 * against the whole artifact instead would be circular (the artifact is not
 * rendered yet) and unsound (a match could land inside another line that is
 * itself being suppressed).
 */
function retainedCorpus(effective: EffectiveIR): readonly string[] {
  const ir = effective.ir;
  return [
    ir.objective.statement,
    ir.objective.success_definition,
    ...ir.goals.map((g) => g.statement),
    ...ir.constraints.map((c) => c.statement),
    ...ir.scope.include,
    ...ir.scope.exclude,
  ];
}

/** True when `text`'s tokens occur contiguously inside one retained string. */
function saidElsewhere(corpus: readonly string[], text: string): boolean {
  const needle = tokenize(text);
  // An empty or punctuation-only line has no tokens to preserve, and
  // "contained everywhere" is not a reason to delete something. Refuse.
  if (needle.length === 0) return false;
  return corpus.some((entry) => containsSequence(tokenize(entry), needle));
}

/**
 * A `manual`/`review` step specifies no observable check when neither its spec
 * nor its expected outcome says anything a reader could run or measure. The
 * signal is `kind`, which legalization already owns: `command` and `test` steps
 * are never eligible, whatever their wording, because they ARE the observable
 * check.
 */
const UNOBSERVABLE_KINDS = new Set(["manual", "review"]);

/**
 * Decide, once per compilation, what each emitter may decline to print.
 *
 * Pure. Returns the suppressions and one `FORGE-C103` per suppression, because
 * INV-012 admits no silent removal — including the ones FORGE is confident
 * about. The diagnostic quotes the withheld text so a reader can search for it
 * and confirm for themselves that it is still in the file.
 */
export function planCompaction(effective: EffectiveIR): Compaction {
  const ir = effective.ir;
  const corpus = retainedCorpus(effective);
  const acceptance = new Set<string>();
  const deliverables = new Set<string>();
  const verification = new Set<string>();
  const diagnostics: Diagnostic[] = [];

  const suppress = (nodeId: string, what: string, text: string): void => {
    diagnostics.push(
      diagnostic(
        "FORGE-C103",
        `${what} restates content the artifact already carries and was not printed again: ` +
          `"${text}". The words remain in the artifact; only the repetition was withheld (FR-051).`,
        [nodeEvidence(nodeId)],
      ),
    );
  };

  // 1. An acceptance criterion that only says its own goal again.
  for (const goal of ir.goals) {
    goal.acceptance.forEach((criterion, index) => {
      // Guarded twice on purpose. The category is "repeats its parent goal";
      // the corpus check then confirms the words survive somewhere that is
      // definitely rendered, so the two are not the same condition.
      if (!containsSequence(tokenize(goal.statement), tokenize(criterion))) return;
      if (!saidElsewhere(corpus, criterion)) return;
      acceptance.add(acceptanceKey(goal.id, index));
      suppress(goal.id, `Acceptance criterion for ${goal.id}`, criterion);
    });
  }

  // 2. A deliverable that only says the objective again.
  for (const d of ir.deliverables) {
    const objective = [ir.objective.statement, ir.objective.success_definition];
    if (!objective.some((t) => containsSequence(tokenize(t), tokenize(d.description)))) continue;
    if (!saidElsewhere(corpus, d.description)) continue;
    deliverables.add(d.id);
    suppress(d.id, `Deliverable ${d.id}`, d.description);
  }

  // 3. A manual/review step with no observable check, both halves already said.
  //    The LEGALIZED kind is what is consulted: a `command` step degraded to
  //    `manual` by the target carries a note explaining the degradation, and
  //    removing it would hide the degradation, not the repetition.
  for (const v of effective.verification) {
    if (!UNOBSERVABLE_KINDS.has(v.kind)) continue;
    if (v.degraded_from !== null) continue;
    if (!saidElsewhere(corpus, v.spec)) continue;
    if (!saidElsewhere(corpus, v.expected)) continue;
    verification.add(v.id);
    suppress(v.id, `Verification step ${v.id}`, v.spec);
  }

  return { acceptance, deliverables, verification, diagnostics };
}

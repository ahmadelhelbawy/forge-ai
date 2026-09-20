/**
 * Blocks — the unit both candidate comparison and candidate merge work in.
 *
 * A prompt artifact is prose, and prose has no schema to diff. What it does
 * have is paragraphs, and a paragraph is the smallest chunk a reader would
 * call "one thing the prompt says". Comparing and merging at that granularity
 * is why a merge can claim, mechanically, that nothing a source said was
 * dropped: the claim is over a finite, enumerable list.
 *
 * A block's `key` is the published ledger normalization (spec.md §22.8)
 * applied to the whole paragraph. Reusing it rather than inventing a second
 * normalization matters: Layer 1 decides whether a pinned requirement survived
 * a merge, and a merge that considered two blocks identical under a *different*
 * rule than the one the guarantee is checked with would be able to drop a
 * requirement while believing it had not.
 */
import { tokenize } from "../critic/deterministic/ledger.js";

export interface TextBlock {
  /** The paragraph exactly as its source wrote it. */
  readonly text: string;
  /** Its normalized token string — the identity used for comparison. */
  readonly key: string;
}

/**
 * Split text into paragraphs: maximal runs of non-blank lines.
 *
 * Trailing whitespace on each line is dropped because it is invisible and
 * would otherwise make two identical paragraphs compare as different; nothing
 * else about a block's text is touched.
 */
export function blocksOf(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const joined = current.join("\n");
    const key = tokenize(joined).join(" ");
    if (key.length > 0) blocks.push(Object.freeze({ text: joined, key }));
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) flush();
    else current.push(line.replace(/\s+$/, ""));
  }
  flush();
  return blocks;
}

/**
 * The deterministic candidate merge (`WS-R2`, `WS-R5`, `WS-R8`).
 *
 * `MERGE` is one of the four actions permitted to write a prompt version, and
 * the thing a user needs to believe about it is that combining two candidates
 * did not quietly lose what either of them said. That belief is worth only as
 * much as the mechanism behind it, so the mechanism here has **no model in
 * it**: a merge is a union of paragraph blocks, keyed by the published ledger
 * normalization, emitted in first-appearance order.
 *
 * What that buys, stated exactly rather than generously:
 *
 * - **Every block of every source appears in the result.** Enumerable and
 *   asserted, not hoped for. A pinned requirement lying inside one block
 *   therefore survives a merge by construction.
 * - **The first source's blocks keep their order and adjacency**, so anything
 *   contiguous across its blocks stays contiguous. A later source's block that
 *   the first already had is emitted at the first source's position, which can
 *   separate two of that later source's blocks — so a requirement spanning a
 *   block boundary *there* is not guaranteed by construction.
 *
 * That residual case is exactly why the caller runs Layer 1 over the merged
 * text before the version is written. The guarantee this module makes is
 * mechanical and bounded; the ledger check is what makes the remainder loud
 * instead of silent (`INV-012`, `WS-R25`).
 */
import { blocksOf } from "./blocks.js";

export interface MergeSource {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export interface MergeBlock {
  readonly text: string;
  /** Every source that carried this block, in the order they were given. */
  readonly sourceIds: readonly string[];
}

export interface MergeContribution {
  readonly sourceId: string;
  readonly label: string;
  /** Blocks this source carried. */
  readonly blocks: number;
  /** Blocks only this source carried. */
  readonly unique: number;
  /** Blocks it shared with at least one other source. */
  readonly shared: number;
}

export interface MergeResult {
  readonly text: string;
  readonly blocks: readonly MergeBlock[];
  readonly contributions: readonly MergeContribution[];
}

/** A merge that cannot be attempted at all, rather than one that goes wrong. */
export class MergeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeSourceError";
  }
}

/**
 * Merge two or more candidates into one text.
 *
 * Refuses rather than improvises: fewer than two artifacts is not a merge
 * (`WS-R5`), the same artifact twice is not two artifacts, and a source with
 * no content would contribute a hole the user could not see.
 */
export function mergeCandidateTexts(sources: readonly MergeSource[]): MergeResult {
  if (sources.length < 2) {
    throw new MergeSourceError("MERGE needs at least two candidates; one artifact is not a merge (WS-R5).");
  }
  const ids = new Set(sources.map((s) => s.id));
  if (ids.size !== sources.length) {
    throw new MergeSourceError("MERGE needs two distinct candidates; the same artifact was cited twice (WS-R5).");
  }

  const parsed = sources.map((source) => {
    const blocks = blocksOf(source.text);
    if (blocks.length === 0) {
      throw new MergeSourceError(`Candidate ${source.id} ("${source.label}") has no content to merge.`);
    }
    return { source, blocks };
  });

  const order: string[] = [];
  const byKey = new Map<string, { text: string; sourceIds: string[] }>();
  for (const { source, blocks } of parsed) {
    for (const block of blocks) {
      const existing = byKey.get(block.key);
      if (existing) {
        // Recorded once per source even when a source repeats a paragraph:
        // the field answers "who said this", not "how often".
        if (!existing.sourceIds.includes(source.id)) existing.sourceIds.push(source.id);
        continue;
      }
      byKey.set(block.key, { text: block.text, sourceIds: [source.id] });
      order.push(block.key);
    }
  }

  const merged: MergeBlock[] = order.map((key) => {
    const entry = byKey.get(key) as { text: string; sourceIds: string[] };
    return Object.freeze({ text: entry.text, sourceIds: Object.freeze([...entry.sourceIds]) });
  });

  const contributions: MergeContribution[] = parsed.map(({ source }) => {
    const mine = merged.filter((block) => block.sourceIds.includes(source.id));
    const shared = mine.filter((block) => block.sourceIds.length > 1).length;
    return Object.freeze({
      sourceId: source.id,
      label: source.label,
      blocks: mine.length,
      unique: mine.length - shared,
      shared,
    });
  });

  return Object.freeze({
    text: merged.map((block) => block.text).join("\n\n"),
    blocks: Object.freeze(merged),
    contributions: Object.freeze(contributions),
  });
}

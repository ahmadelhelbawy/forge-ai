/**
 * Staged output (`spec.md` §22.12, WS-R40, FR-061).
 *
 * A staged prompt is still ONE version: one text, one hash, one ledger check.
 * What makes it staged is a published, readable form —
 *
 *     ## Stage 1 — Title
 *     Depends on: none
 *     …
 *     ## Stage 2 — Title
 *     Depends on: Stage 1
 *
 * — which this module reads deterministically. It never repairs: a version that
 * does not parse is reported (FORGE-W013) and shown as one prompt, because a
 * stage boundary FORGE guessed at would be a stage boundary nobody wrote.
 */
import { containsSequence, tokenize } from "../critic/deterministic/ledger.js";
import { isCovered } from "./coverage.js";

export type OutputShape = "single" | "staged";
export const OUTPUT_SHAPES: readonly OutputShape[] = ["single", "staged"];
export function isOutputShape(value: unknown): value is OutputShape {
  return typeof value === "string" && (OUTPUT_SHAPES as readonly string[]).includes(value);
}

export type ArtifactKind = "unspecified" | "agent" | "builder";
export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["unspecified", "agent", "builder"];
export function isArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === "string" && (ARTIFACT_KINDS as readonly string[]).includes(value);
}

export interface Stage {
  readonly n: number;
  readonly title: string;
  readonly dependsOn: readonly number[];
  /** The stage's full text, heading included, exactly as written. */
  readonly text: string;
}

export type StageParse =
  | { readonly ok: true; readonly stages: readonly Stage[] }
  | { readonly ok: false; readonly reason: string };

const HEADING = /^#{2,3}\s*Stage\s+(\d+)\s*(?:[—–:\-.]\s*(.*))?$/gim;
const DEPENDS = /^\s*\**depends on\**\s*:\s*(.*)$/im;

export function parseStages(text: string): StageParse {
  const heads = [...text.matchAll(HEADING)];
  if (heads.length < 2) {
    return { ok: false, reason: `found ${heads.length} "## Stage N — Title" heading(s); a staged prompt needs at least two` };
  }
  const stages: Stage[] = [];
  for (const [i, head] of heads.entries()) {
    const n = Number(head[1]);
    if (n !== i + 1) return { ok: false, reason: `stage headings must be numbered 1..${heads.length} in order; heading ${i + 1} says Stage ${n}` };
    const start = head.index ?? 0;
    const end = i + 1 < heads.length ? (heads[i + 1]!.index ?? text.length) : text.length;
    const body = text.slice(start, end).trimEnd();
    const deps = DEPENDS.exec(body.split("\n").slice(1, 4).join("\n"));
    const dependsOn: number[] = [];
    if (deps && !/^\s*(none|nothing|—|-)?\s*\.?\s*$/i.test(deps[1]!)) {
      for (const m of deps[1]!.matchAll(/(\d+)/g)) dependsOn.push(Number(m[1]));
      if (dependsOn.length === 0) return { ok: false, reason: `stage ${n}'s "Depends on" names no stage number` };
    }
    const forward = dependsOn.find((d) => d >= n || d < 1);
    if (forward !== undefined) {
      return { ok: false, reason: `stage ${n} depends on stage ${forward}; a stage may depend only on earlier stages` };
    }
    stages.push({ n, title: (head[2] ?? "").trim() || `Stage ${n}`, dependsOn: [...new Set(dependsOn)].sort((a, b) => a - b), text: body });
  }
  return { ok: true, stages };
}

export interface StageCarry {
  readonly text: string;
  readonly kind: "pinned" | "discovered";
  /** Stage numbers that carry the item; empty when none does. */
  readonly stages: readonly number[];
}

/**
 * WS-R40: which stages carry each requirement. Pinned text by the contiguous
 * §22.8 rule, exactly as the ledger does; discovered items by content-word
 * coverage, exactly as WS-R33 does. No new rule is introduced for stages.
 */
export function stageCarry(
  stages: readonly Stage[],
  items: ReadonlyArray<{ readonly text: string; readonly kind: "pinned" | "discovered" }>,
): StageCarry[] {
  const tokenised = stages.map((s) => tokenize(s.text));
  return items.map((item) => ({
    text: item.text,
    kind: item.kind,
    stages: stages
      .filter((stage, i) =>
        item.kind === "pinned" ? containsSequence(tokenised[i]!, tokenize(item.text)) : isCovered(item.text, stage.text),
      )
      .map((s) => s.n),
  }));
}

/**
 * Repository signals for the intent boundary (P3, plan.md "signals.ts").
 *
 * The initial extraction stays workspace-free by design: the P3 pipeline is
 * extract → resolve → evidence → clarify, and grounding the FIRST draft in
 * a directory listing would trade the P1.5 no-invention discipline for
 * better-looking scope. Signals feed the REFINE call instead, where the
 * model incorporates the user's answers into structure and needs real paths
 * to name — grounding, not invention.
 *
 * Sourcing is guard-derived, never direct fs: the top-level entries come
 * from `WorkspaceGuard.walk`, so ignore rules and deny globs apply before
 * the boundary ever sees a name (INV-011). The segment is `forge_derived`
 * (FORGE-observed fact, trusted) — the model cites it like any segment, and
 * attribution stays FORGE-owned (INV-016).
 */

import type { InputSegment } from "../ir/attribution.js";
import type { WorkspaceGuard } from "../context/workspace.js";

export interface RepoSignals {
  /** Sorted top-level entries (dirs and files), capped. */
  readonly topLevel: readonly string[];
  /** True when the listing was capped. */
  readonly truncated: boolean;
  /** Representable files seen (walk count, before caps). */
  readonly fileCount: number;
}

export const SIGNALS_TOP_LEVEL_CAP = 30;
export const SIGNALS_SEGMENT_ID = "s2";

export function collectSignals(guard: WorkspaceGuard): RepoSignals {
  const all = guard.walk(".");
  const top = new Set<string>();
  for (const rel of all) {
    const first = rel.split("/")[0];
    if (first !== undefined && first !== "") top.add(rel.includes("/") ? `${first}/` : first);
  }
  const sorted = [...top].sort();
  return {
    topLevel: sorted.slice(0, SIGNALS_TOP_LEVEL_CAP),
    truncated: sorted.length > SIGNALS_TOP_LEVEL_CAP,
    fileCount: all.length,
  };
}

/** The segment the refine prompt issues for the layout (forge_derived). */
export function signalsSegment(): InputSegment {
  return {
    id: SIGNALS_SEGMENT_ID,
    source_ref: "forge_derived",
    label: "repository layout observed by FORGE",
  };
}

/** Rendered prompt section. Pure: same signals → same text. */
export function renderSignalsSection(signals: RepoSignals): string {
  const lines = signals.topLevel.map((e) => `- ${e}`).join("\n");
  const tail = signals.truncated ? "\n- … (truncated)" : "";
  return (
    `REPOSITORY LAYOUT (observed by FORGE, segment ${SIGNALS_SEGMENT_ID} — use ONLY to ` +
    `ground scope globs in real paths; it states no goals, constraints, or requirements):\n` +
    `${lines}${tail}`
  );
}

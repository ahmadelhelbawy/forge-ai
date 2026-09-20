/**
 * Strategy sources (FR-035, ST-R7).
 *
 * A future non-archetype source contributes candidates through this
 * interface WITHOUT any Task IR schema change: strategies are overlays,
 * structures separate from the IR. v0.1 registers exactly one source.
 */
import type { TaskIR } from "../ir/schema.js";
import type { AgentProfile } from "../profile/schema.js";
import { deriveParameters } from "./derive.js";
import { renderRationale, scoreArchetype } from "./fit.js";
import {
  extractProfileSignals,
  extractSignals,
} from "./signals.js";
import type {
  DerivedOverlay,
  StrategyArchetype,
  StrategyCandidate,
} from "./schema.js";
import type { StrategyRegistry } from "./registry.js";

export interface StrategySource {
  readonly id: string;
  propose(ir: TaskIR, profile: AgentProfile): StrategyCandidate[];
}

/** Configured archetype order: the tie-break when fit scores are equal. */
export const ARCHETYPE_ORDER: readonly string[] = [
  "surgical",
  "rigorous",
  "autonomous",
  "exploratory",
];

export function deriveOverlay(archetype: StrategyArchetype, ir: TaskIR): DerivedOverlay {
  const { params } = deriveParameters(archetype, ir);
  return {
    archetypeId: archetype.id,
    strategyId: `st_${archetype.id}`,
    version: archetype.version,
    params,
    template: archetype.overlay_template,
  };
}

export class ArchetypeSource implements StrategySource {
  readonly id = "archetype";
  constructor(private readonly registry: StrategyRegistry) {}

  propose(ir: TaskIR, profile: AgentProfile): StrategyCandidate[] {
    const candidates: StrategyCandidate[] = [];
    for (const archetype of this.registry.all) {
      const resolved = resolveArchetype(archetype, ir, profile);
      if (resolved.candidate) candidates.push(resolved.candidate);
    }
    const order = new Map(ARCHETYPE_ORDER.map((id, i) => [id, i]));
    candidates.sort(
      (a, b) => b.score - a.score || (order.get(a.overlay.archetypeId) ?? 999) - (order.get(b.overlay.archetypeId) ?? 999),
    );
    return candidates;
  }
}

/**
 * Score one archetype and derive its overlay — the candidate when the
 * score is positive, the bare overlay otherwise. An explicit user choice
 * (`forge compile --strategy`, ST-R6) applies regardless of fit; the
 * rationale then honestly reports score 0.
 */
export function resolveArchetype(
  archetype: StrategyArchetype,
  ir: TaskIR,
  profile: AgentProfile,
): { readonly candidate: StrategyCandidate | null; readonly overlay: DerivedOverlay } {
  const irSignals = extractSignals(ir);
  const profileSignals = extractProfileSignals(profile);
  const { score, matched } = scoreArchetype(archetype, irSignals, profileSignals);
  const { params, sources } = deriveParameters(archetype, ir);
  const overlay: DerivedOverlay = {
    archetypeId: archetype.id,
    strategyId: `st_${archetype.id}`,
    version: archetype.version,
    params,
    template: archetype.overlay_template,
  };
  if (score <= 0) return { candidate: null, overlay };
  return {
    candidate: {
      overlay,
      score,
      matchedRules: matched,
      rationale: renderRationale(archetype.id, score, matched, params, sources),
      origin: "archetype",
    },
    overlay,
  };
}

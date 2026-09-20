/**
 * Test helpers for driving compiler stages in isolation.
 *
 * Kept separate from `fixtures.ts` so IR-only tests do not pull in the compile layer.
 */
import { CAPABILITIES, type Capability } from "../../src/ir/vocabulary.js";
import type { TaskIR } from "../../src/ir/schema.js";
import { parseAgentProfile, type AgentProfile } from "../../src/profile/schema.js";
import type { CapabilityLevel, SectionKey } from "../../src/compile/vocabulary.js";
import type { EffectiveIR, SectionInput } from "../../src/compile/types.js";

/** Build a complete capability map, defaulting everything and overriding by name. */
export function capabilityMap(
  overrides: Partial<Record<Capability, CapabilityLevel>> = {},
  fallback: CapabilityLevel = "supported",
): Record<Capability, { level: CapabilityLevel }> {
  return Object.fromEntries(
    CAPABILITIES.map((c) => [c, { level: overrides[c] ?? fallback }]),
  ) as Record<Capability, { level: CapabilityLevel }>;
}

/** A minimal valid profile for driving emitters directly. */
export function testProfile(patch: Record<string, unknown> = {}): AgentProfile {
  return parseAgentProfile(
    {
      id: "test-target",
      display_name: "Test Target",
      version: "1.0",
      verified_against: "2026-09-07",
      family: "test",
      fidelity: "compatibility",
      retrieval: { autonomous_search: "strong", tools: [] },
      capabilities: capabilityMap(),
      autonomy: { default: "medium", configurable: true, permission_model: "prompt" },
      budget: { max_context_tokens: 200000, artifact_share: 0.08 },
      output: {
        artifacts: [{ path: "TASK.md", sections: ["objective", "goals", "constraints"] }],
        path_vars: [],
      },
      limits: {},
      ...patch,
    },
    "test-profile",
  );
}

/** Identity lowering, matching P1 behaviour (no strategy overlays until P4). */
export function effectiveFor(ir: TaskIR): EffectiveIR {
  const introduced = new Map<string, { kind: "ir_node"; node_id: string }>();
  const ids = [
    "objective",
    "scope",
    ...ir.goals.map((g) => g.id),
    ...ir.constraints.map((c) => c.id),
    ...ir.non_goals.map((n) => n.id),
    ...ir.verification.map((v) => v.id),
    ...ir.deliverables.map((d) => d.id),
    ...ir.assumptions.map((a) => a.id),
    ...ir.open_questions.map((q) => q.id),
    ...ir.context_refs.map((r) => r.id),
  ];
  for (const id of ids) introduced.set(id, { kind: "ir_node", node_id: id });
  return {
    ir,
    introduced_by: introduced,
    verification: ir.verification.map((v) => ({ ...v, degraded_from: null, degraded_by: null })),
  };
}

/** A SectionInput sufficient to drive one emitter directly. */
export function sectionInputFor(
  ir: TaskIR,
  sectionKey: SectionKey,
  patch: Partial<SectionInput> = {},
): SectionInput {
  return {
    effective: effectiveFor(ir),
    profile: testProfile(),
    rendererId: "generic",
    sectionKey,
    materialization: new Map(),
    degradations: [],
    capabilityNotes: [],
    advisoryNodeIds: new Set(),
    droppedContext: [],
    taskSlug: "test-task",
    taskId: "t1",
    ...patch,
  };
}

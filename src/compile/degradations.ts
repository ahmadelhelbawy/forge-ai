/**
 * The closed degradation registry (FR-016, docs/architecture.md §7 stage 2).
 *
 * Degradation rules are NAMED and CLOSED. There is no ad-hoc adaptation anywhere in the
 * compiler: if a capability is absent and no rule covers it, compilation is refused
 * (FORGE-C030) rather than quietly adjusted.
 *
 * This registry is also the definition of "soft" in FR-015. A capability is soft
 * precisely when a registered rule can honestly compensate for its absence; it is
 * hard-required otherwise. That reading is what makes FR-015 ("hard-required refuses,
 * soft degrades") deterministic rather than a judgement call, and it is why the
 * registry is the single place to look when asking why a target was refused.
 */
import type { Capability } from "../ir/vocabulary.js";
import type { DegradationRuleId } from "./vocabulary.js";

export interface DegradationRule {
  readonly id: DegradationRuleId;
  /** Why this rule exists, shown in diagnostics. */
  readonly trigger: string;
  /** What actually changes, stated in the artifact so the agent sees it too. */
  readonly effect: string;
}

export const DEGRADATION_RULES: Readonly<Record<DegradationRuleId, DegradationRule>> =
  Object.freeze({
    "degrade.command_to_manual": {
      id: "degrade.command_to_manual",
      trigger: "the target cannot execute commands",
      effect:
        "executable verification steps are recorded as manual checks, with their commands preserved verbatim",
    },
    "degrade.inline_context": {
      id: "degrade.inline_context",
      trigger: "the target cannot read the repository itself",
      effect: "context references are marked for inlining rather than left as pointers",
    },
    "degrade.drop_subagent_guidance": {
      id: "degrade.drop_subagent_guidance",
      trigger: "the target cannot delegate to sub-agents",
      effect: "no delegation guidance is included; the task is framed as single-agent work",
    },
    "degrade.flatten_multi_turn": {
      id: "degrade.flatten_multi_turn",
      trigger: "the target cannot hold a multi-turn conversation",
      effect:
        "open questions are stated inline with their defaults rather than asked interactively",
    },
  });

/**
 * Which absent capability a rule can compensate for.
 *
 * A capability NOT listed here has no compensation and is therefore hard-required:
 * its absence refuses compilation. Adding an entry is a deliberate claim that the
 * named rule genuinely covers the gap.
 */
export const DEGRADATION_FOR_ABSENT_CAPABILITY: Readonly<
  Partial<Record<Capability, DegradationRuleId>>
> = Object.freeze({
  shell: "degrade.command_to_manual",
  run_tests: "degrade.command_to_manual",
  fs_read: "degrade.inline_context",
  subagents: "degrade.drop_subagent_guidance",
  multi_turn: "degrade.flatten_multi_turn",
});

/**
 * Capabilities whose absence or conditionality affects whether a verification step can
 * run. Used to decide when a `conditional` capability warrants a note (C031 at info).
 */
export const CAPABILITIES_GATING_VERIFICATION: readonly Capability[] = Object.freeze([
  "shell",
  "run_tests",
]);

export function degradationFor(capability: Capability): DegradationRule | null {
  const id = DEGRADATION_FOR_ABSENT_CAPABILITY[capability];
  return id ? DEGRADATION_RULES[id] : null;
}

/** True when a missing capability can be compensated for, i.e. it is soft (FR-015). */
export const isSoftCapability = (capability: Capability): boolean =>
  DEGRADATION_FOR_ABSENT_CAPABILITY[capability] !== undefined;

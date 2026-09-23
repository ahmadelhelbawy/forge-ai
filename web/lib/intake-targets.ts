import type { IntakeTarget } from "forge/dist/conversation/intake.js";
import { builtinProfiles } from "forge/dist/profile/registry.js";

/**
 * WS-R36: the names a pasted prompt's instruction may use for a target — the
 * profile's display name and its id with the dashes read as spaces ("claude
 * code", "openai codex"), plus the vendor-free short name a user types
 * ("codex"). From the profile registry, never a hand list of agents.
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set(["agent", "code", "design", "harness"]);

export function intakeTargets(): IntakeTarget[] {
  return builtinProfiles().all.map((p) => {
    const words = p.id.split("-");
    const names = new Set([p.display_name, p.id, words.join(" ")]);
    const last = words.at(-1);
    // "codex" names one target; "agent", "code" and "harness" name none.
    if (words.length > 1 && last && last.length >= 5 && !GENERIC_WORDS.has(last)) names.add(last);
    return { id: p.id, names: [...names] };
  });
}

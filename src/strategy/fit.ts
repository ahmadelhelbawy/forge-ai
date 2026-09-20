/**
 * Deterministic fit-rule scoring (FR-032, FR-033).
 *
 * Score = Σ weights of matching rules. A rule matches when EVERY `when`
 * condition holds (AND across keys). Matching is total and documented:
 * scalars test membership, array signals test non-empty intersection,
 * numbers test membership or `{min,max}` range. `profile.`-prefixed keys
 * read profile signals; anything else reads IR signals. An unknown signal
 * name is a fail-closed error, never a silent miss.
 *
 * On scores: the fit tally is a transparent vote count, not a quality
 * judgment. The rationale names every contributing rule, weight, and
 * observed value (FR-033), so the number cannot misdescribe itself —
 * which is exactly what INV-008 forbids in composite quality scores.
 */
import type { ProfileSignals, StrategyArchetype, StrategySignals } from "./schema.js";
import type { FitRuleValue } from "./schema.js";

export interface FitMatch {
  readonly ruleIndex: number;
  readonly weight: number;
  readonly detail: string;
}

export class FitRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitRuleError";
  }
}

type SignalTable = Record<string, unknown>;

function tables(
  ir: StrategySignals,
  profile: ProfileSignals,
): { ir: SignalTable; profile: SignalTable } {
  return {
    ir: ir as unknown as SignalTable,
    profile: profile as unknown as SignalTable,
  };
}

function conditionHolds(signal: unknown, expected: FitRuleValue): { holds: boolean; observed: string } {
  if (typeof expected === "object" && expected !== null && !Array.isArray(expected)) {
    if (typeof signal !== "number") return { holds: false, observed: String(signal) };
    const minOk = expected.min === undefined || signal >= expected.min;
    const maxOk = expected.max === undefined || signal <= expected.max;
    return { holds: minOk && maxOk, observed: String(signal) };
  }
  const accepted = (Array.isArray(expected) ? expected : [expected]) as readonly unknown[];
  if (Array.isArray(signal)) {
    const hit = signal.find((s) => (accepted as readonly unknown[]).includes(s));
    return { holds: hit !== undefined, observed: hit === undefined ? "(none)" : String(hit) };
  }
  return { holds: (accepted as readonly unknown[]).includes(signal), observed: String(signal) };
}

/** Score one archetype. Pure; throws FitRuleError on unknown signal names. */
export function scoreArchetype(
  archetype: StrategyArchetype,
  ir: StrategySignals,
  profile: ProfileSignals,
): { readonly score: number; readonly matched: readonly FitMatch[] } {
  const { ir: irTable, profile: profileTable } = tables(ir, profile);
  const matched: FitMatch[] = [];
  archetype.fit_rules.forEach((rule, ruleIndex) => {
    const details: string[] = [];
    for (const [key, expected] of Object.entries(rule.when)) {
      const table = key.startsWith("profile.") ? profileTable : irTable;
      const name = key.startsWith("profile.") ? key.slice("profile.".length) : key;
      if (!(name in table)) {
        throw new FitRuleError(
          `Archetype "${archetype.id}" rule ${ruleIndex} names unknown signal "${key}".`,
        );
      }
      const { holds, observed } = conditionHolds(table[name], expected);
      if (!holds) return;
      details.push(`${key}=${observed}`);
    }
    matched.push({ ruleIndex, weight: rule.weight, detail: `${details.join(", ")} (+${rule.weight})` });
  });
  return { score: matched.reduce((sum, m) => sum + m.weight, 0), matched };
}

/**
 * Render the rationale from the matched-rule trace (FR-033): the actual
 * decision procedure, so it cannot misdescribe itself. Derived parameters
 * are reported with the signal they came from.
 */
export function renderRationale(
  archetypeId: string,
  score: number,
  matched: readonly FitMatch[],
  params: Readonly<Record<string, number>>,
  paramSources: Readonly<Record<string, string>>,
): string {
  const rules = matched.length > 0
    ? matched.map((m) => m.detail).join("; ")
    : "no fit rules matched";
  const tuned = Object.entries(params)
    .map(([name, value]) => `${name}=${value} (from ${paramSources[name] ?? "?"})`)
    .join(", ");
  return `Selected ${archetypeId} (fit score ${score}): ${rules}${tuned ? `. Tuned: ${tuned}` : ""}.`;
}

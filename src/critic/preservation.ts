/**
 * Where the two preservation layers meet — and stay apart (WS-R27, WS-R28).
 *
 * The specification says a judged finding may never suppress, downgrade or
 * resolve a Layer 1 diagnostic, that the absence of a judged finding is never
 * evidence a pinned requirement survived, and that Layer 1 reaches its verdict
 * whether or not Layer 2 ran. Those are four sentences that are easy to agree
 * with and easy to violate by accident — one `concat`, one severity map, one
 * "resolve findings that the drift check says are fine", and the guarantee is
 * gone.
 *
 * So this module is deliberately almost empty of behaviour. It holds the two
 * results side by side in one object, refuses to build one that mixes them,
 * and offers no operation that could let the judged half reach the
 * deterministic half. The absence of a `merge` function here is the feature.
 */
import { DIAGNOSTIC_REGISTRY, type Diagnostic } from "../ir/diagnostic.js";
import type { LedgerCheckResult } from "./deterministic/ledger.js";
import type { DriftReport } from "./judged/drift.js";

/**
 * Both layers, never merged.
 *
 * `ledger` is a guarantee and `drift` is advice. `drift` is nullable because
 * Layer 2 is opt-in (WS-R29) — and null means "not run", which is **not** a
 * statement that nothing drifted, exactly as an empty `findings` is not a
 * statement that a pinned requirement survived (WS-R27.2).
 */
export interface PreservationResult {
  readonly ledger: LedgerCheckResult;
  readonly drift: DriftReport | null;
}

export class LayerConfusionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayerConfusionError";
  }
}

function assertSource(findings: readonly Diagnostic[], expected: "deterministic" | "judged", where: string): void {
  for (const finding of findings) {
    const registered = DIAGNOSTIC_REGISTRY[finding.code];
    if (finding.source !== expected || registered.source !== expected) {
      throw new LayerConfusionError(
        `${finding.code} has source "${finding.source}" but appeared in the ${where} layer, which carries ` +
          `"${expected}" findings only. A judged finding may never stand in for a deterministic one (WS-R27).`,
      );
    }
  }
}

/**
 * Put the two layers in one object without letting either touch the other.
 *
 * The drift report is accepted, checked for layer confusion, and stored. It is
 * never consulted while deciding anything about the ledger: `ledger` is passed
 * through by reference, so there is no code path — not even a buggy one — in
 * which a judged finding changes a deterministic verdict.
 */
export function preservationResult(
  ledger: LedgerCheckResult,
  drift: DriftReport | null = null,
): PreservationResult {
  assertSource(ledger.diagnostics, "deterministic", "deterministic");
  if (drift) assertSource(drift.findings.map((f) => f.diagnostic), "judged", "judged");
  return Object.freeze({ ledger, drift });
}

/**
 * Whether this version must be reported as failing preservation.
 *
 * Reads Layer 1 and only Layer 1. A `drift` argument is deliberately not
 * accepted: a function that could see the advisory layer while answering this
 * question would be one refactor away from letting it answer.
 */
export function preservationFailed(result: PreservationResult): boolean {
  return result.ledger.diagnostics.length > 0;
}

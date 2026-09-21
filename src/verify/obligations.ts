/**
 * Verification obligations, projected from a validated Execution Contract
 * (`FR-053`, `spec.md` §11.1).
 *
 * An obligation is a `verification.json` entry read as a promise the external
 * execution must keep. **This module adds no meaning to it.** The kind decides
 * whether the promise is mechanically checkable at all — `command` and `test`
 * are; `manual` and `review` are not, by construction, and no quantity of
 * evidence changes that (`EV-R4`). The one value derived here is the expected
 * exit code, by a rule narrow enough to state in one line.
 *
 * The entries come from the package's `verification.json`, which is the
 * **legalized** list: a `command` the target could not run was already
 * degraded to `manual` at compile time and recorded as such. Reading the
 * package's list rather than the IR's therefore means a degraded step is
 * `REVIEW_REQUIRED` here too — the verifier cannot promote what the compiler
 * demoted.
 */
import { EXECUTABLE_VERIFICATION_KINDS, type VerificationKind } from "../ir/vocabulary.js";

export interface Obligation {
  readonly id: string;
  readonly kind: VerificationKind;
  readonly spec: string;
  readonly expected: string;
  /** The goals this obligation discharges — the join V2-H's matrix rolls up over. */
  readonly satisfies: readonly string[];
  readonly degraded_from: VerificationKind | null;
  /** True for `command` and `test` only. */
  readonly executable: boolean;
  /** `null` for a non-executable obligation, which has no exit code to expect. */
  readonly expected_exit_code: number | null;
}

/**
 * `N` when `expected` is exactly `exit N`, otherwise `0` (`EV-R4`).
 *
 * `expected` is free text written for a human ("matches", "present"), and
 * interpreting it further would be a judgement this layer is forbidden to make.
 * Only the one machine-readable form is honoured.
 */
export function expectedExitCode(expected: string): number {
  const match = /^exit (\d{1,3})$/.exec(expected.trim());
  return match ? Number(match[1]) : 0;
}

interface VerificationEntry {
  readonly id: string;
  readonly kind: VerificationKind;
  readonly spec: string;
  readonly expected: string;
  readonly satisfies: readonly string[];
  readonly degraded_from: VerificationKind | null;
}

/** Every obligation, in the package's declaration order (author priority). */
export function obligationsOf(entries: readonly VerificationEntry[]): readonly Obligation[] {
  return Object.freeze(
    entries.map((e) => {
      const executable = (EXECUTABLE_VERIFICATION_KINDS as readonly string[]).includes(e.kind);
      return Object.freeze({
        id: e.id,
        kind: e.kind,
        spec: e.spec,
        expected: e.expected,
        satisfies: Object.freeze([...e.satisfies]),
        degraded_from: e.degraded_from,
        executable,
        expected_exit_code: executable ? expectedExitCode(e.expected) : null,
      });
    }),
  );
}

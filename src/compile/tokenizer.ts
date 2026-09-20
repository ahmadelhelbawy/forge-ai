/**
 * Token estimation (FR-020, IR-R14, AOC-7).
 *
 * The tokenizer is part of the SEMANTIC INPUT TUPLE, not an implementation detail.
 * Budgeting can drop context, which changes rendered bytes, so a tokenizer change is a
 * semantic change. Pinning it and recording its id and version is the only honest way
 * to claim reproducibility — without that, NFR-009 would be false in a way no test
 * would catch.
 *
 * THREE THINGS ARE PINNED HERE, and each was a real drift risk:
 *
 * 1. **The encoding is selected explicitly**, by importing the named encoding rather
 *    than the package root. The root export is whichever encoding the library currently
 *    defaults to; it has changed across major versions. The declared id was previously
 *    true only by coincidence of that default, and no test compared the two.
 * 2. **The dependency is pinned exactly** in `package.json` (no caret), because the
 *    recorded `version` below is a literal. Under a range, a minor upgrade would keep
 *    claiming the old version while producing different counts.
 * 3. **The declared identity is asserted against reality** by
 *    `tests/property/tokenizer-identity.test.ts`: the version must equal the installed
 *    package's version, and the counts must equal the named encoding's and differ from a
 *    different encoding's. A truthiness check would have passed while both were wrong.
 *
 * Counts are ESTIMATES and are labelled as such wherever they are surfaced. Different
 * providers tokenize differently; the interface admits an exact per-profile tokenizer
 * later without changing any caller.
 */
import { encode } from "gpt-tokenizer/encoding/o200k_base";

export interface TokenEstimator {
  readonly id: string;
  readonly version: string;
  count(text: string): number;
}

/** The encoding this build budgets with. Part of the estimator's recorded identity. */
export const DEFAULT_ENCODING = "o200k_base";

/**
 * The exact version of the tokenizer package this build was pinned against.
 *
 * Kept in sync with `package.json` by test, not by discipline.
 */
export const TOKENIZER_PACKAGE = "gpt-tokenizer";
export const TOKENIZER_PACKAGE_VERSION = "4.0.0";

/** The pinned default. Its id and version enter the semantic input tuple. */
export const DEFAULT_TOKEN_ESTIMATOR: TokenEstimator = Object.freeze({
  id: `${TOKENIZER_PACKAGE}/${DEFAULT_ENCODING}`,
  version: TOKENIZER_PACKAGE_VERSION,
  count(text: string): number {
    if (text.length === 0) return 0;
    return encode(text).length;
  },
});

/**
 * A deterministic, dependency-free estimator for tests that care about budget
 * ARITHMETIC rather than tokenizer accuracy. Declared here rather than in the test
 * tree so its id is visible alongside the real one and can never be mistaken for it.
 */
export const CHAR_TOKEN_ESTIMATOR: TokenEstimator = Object.freeze({
  id: "forge/chars-per-4",
  version: "1",
  count: (text: string) => Math.ceil(text.length / 4),
});

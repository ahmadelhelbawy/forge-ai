/**
 * Golden canonical form — IR-R12, IR-R13, AC-005.
 *
 * The hashes below are COMMITTED CONSTANTS, not snapshots. If canonicalization or the
 * semantic projection changes, these fail loudly with the old and new values visible,
 * which is exactly the review signal we want: identity changing is a real event, and
 * every stored object and package hash in the wild depends on it.
 *
 * Updating one of these constants is legitimate ONLY when the fixture itself changed
 * or the projection was deliberately amended. Never update them to make a red test
 * green (TS-R2).
 */
import { describe, expect, it } from "vitest";

import { canonicalStringify } from "../../src/ir/canonical.js";
import { semanticHash, semanticProjection } from "../../src/ir/projection.js";
import { FIXTURE_NAMES, loadFixture } from "../helpers/fixtures.js";

/**
 * Semantic identity of each committed fixture under IR 1.0.
 *
 * `auth-debug` and `empty-state` changed in the P1.4 hardening pass because
 * `open_questions` gained a required `source_ref` (IR-R5): a question is agent-steering
 * content, so its trust must be resolvable. The three fixtures with no open questions
 * hash IDENTICALLY to before, which is the allowlist projection behaving correctly —
 * only fixtures whose semantic content actually changed moved.
 */
const GOLDEN_HASHES: Record<(typeof FIXTURE_NAMES)[number], string> = {
  "auth-debug": "sha256:255e344f0e4fe83cff89dd67502ec0c0a44056b4625fcb853a3507d05476f598",
  bloated: "sha256:d024e23ad2353a50b4fbb48175f371ce15ed1eeb6d388240e9131641a9cddafd",
  "empty-state": "sha256:a24d0654f816401106f6af31a627a7845fb3aff943c5eeef493f6a05681a890f",
  "untrusted-instruction":
    "sha256:d5a45266130ea2ef097096f85c19b2b50567f3bea26eca198b4266f28e33b045",
  "semi-trusted-instruction":
    "sha256:3cec06b58b867cf0afab6eac95f6ba63a361587b6d69f6caf378d65f73371bf6",
  "laundered-influence":
    "sha256:c043a3d71c995d6d42697901093b59dda00af3ccc453b8836e3ea8e0ac7f0d6d",
};

describe("golden semantic hashes", () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name} hashes to its committed value`, () => {
      expect(semanticHash(loadFixture(name))).toBe(GOLDEN_HASHES[name]);
    });
  }
});

describe("golden canonical serialization", () => {
  it("auth-debug serializes to a byte-stable canonical form", () => {
    expect(canonicalStringify(semanticProjection(loadFixture("auth-debug")))).toMatchSnapshot();
  });

  it("canonical form begins with the lexicographically first semantic field", () => {
    // Keys are sorted, so `assumptions` must lead. A regression in recursive sorting
    // shows up here immediately rather than as a mysterious hash change.
    const text = canonicalStringify(semanticProjection(loadFixture("auth-debug")));
    expect(text.startsWith('{"assumptions":')).toBe(true);
  });

  it("canonical form contains no insignificant whitespace", () => {
    const text = canonicalStringify(semanticProjection(loadFixture("auth-debug")));
    expect(text).not.toMatch(/: /);
    expect(text).not.toMatch(/\n/);
  });
});

/**
 * Profile contract — AC-018, AP-R5, AP-R6, FR-013, FR-014, INV-014.
 *
 * Every shipped profile must validate, reference only real section keys, compile the
 * canonical fixture, and claim no more fidelity than it can deliver.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { REGISTERED_OVERRIDES } from "../../src/compile/compile.js";
import { checkFidelity } from "../../src/critic/deterministic/index.js";
import { SECTION_KEYS } from "../../src/compile/vocabulary.js";
import { SECTION_REGISTRY } from "../../src/compile/sections/index.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { CAPABILITIES } from "../../src/ir/vocabulary.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { loadFixture } from "../helpers/fixtures.js";
import { testProfile } from "../helpers/compile.js";

const registry = builtinProfiles();

/** FR-013: the seven v0.1 targets. */
const REQUIRED_PROFILES = [
  "claude-code",
  "openai-codex",
  "opencode",
  "kiro",
  "hermes-agent",
  "deepseek-harness",
  "claude-design",
] as const;

describe("shipped profiles (FR-013)", () => {
  it("ships exactly the seven required targets", () => {
    expect([...registry.ids].sort()).toEqual([...REQUIRED_PROFILES].sort());
  });

  for (const id of REQUIRED_PROFILES) {
    describe(id, () => {
      const profile = registry.get(id);

      it("declares every capability in the closed vocabulary (AP-R2)", () => {
        expect(Object.keys(profile.capabilities).sort()).toEqual([...CAPABILITIES].sort());
      });

      it("declares a fidelity and a verification date (FR-014)", () => {
        expect(["full", "native_topology", "compatibility"]).toContain(profile.fidelity);
        expect(profile.verified_against).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it("references only registered section keys (AP-R5)", () => {
        for (const artifact of profile.output.artifacts) {
          for (const key of artifact.sections) {
            expect(SECTION_REGISTRY.has(key), `${id} references unknown section "${key}"`).toBe(true);
          }
        }
      });

      it("does not overclaim its fidelity (AC-018, INV-014)", () => {
        expect(checkFidelity(profile, REGISTERED_OVERRIDES)).toEqual([]);
      });

      it("compiles the canonical cross-target fixture", () => {
        const result = compile(loadFixture("empty-state"), profile, { taskSlug: "empty-state" });
        expect(result.refused, `${id} refused: ${codesOf(result.diagnostics).join(",")}`).toBe(false);
        expect(result.artifacts.length).toBeGreaterThan(0);
        expect(codesOf(result.diagnostics)).not.toContain("FORGE-C100");
      });

      it("declares a known gap wherever it cannot be idiomatic", () => {
        // Anything short of `full` must say what is missing, so the ladder is honest
        // rather than a silent downgrade (AP-R7).
        if (profile.fidelity !== "full") {
          expect(profile.limits.known_gaps.length).toBeGreaterThan(0);
        }
      });
    });
  }
});

/**
 * spec.md AP-R8 assigns a fidelity to every v0.1 target. That table used to be
 * unverified prose: the only mechanical check was that `fidelity` held one of three
 * legal values, so a profile could disagree with the specification indefinitely — and
 * two of them did.
 *
 * `claude-code` and `openai-codex` are the two documented exceptions: AP-R8 assigns
 * `full`, which requires registered section overrides (FR-022, P6). Until those exist,
 * claiming `full` is an overclaim that FORGE-C101 correctly rejects, so AP-R8 describes
 * their end-of-v0.1 state and this test encodes the phase-appropriate value.
 */
describe("declared fidelity matches spec.md AP-R8 (INV-014)", () => {
  const AP_R8: Record<string, { fidelity: string; note?: string }> = {
    "claude-code": { fidelity: "native_topology", note: "AP-R8 `full` awaits overrides (P6)" },
    "openai-codex": { fidelity: "native_topology", note: "AP-R8 `full` awaits overrides (P6)" },
    kiro: { fidelity: "native_topology" },
    opencode: { fidelity: "native_topology" },
    "hermes-agent": { fidelity: "native_topology" },
    "claude-design": { fidelity: "native_topology" },
    "deepseek-harness": { fidelity: "compatibility" },
  };

  for (const [id, expected] of Object.entries(AP_R8)) {
    it(`${id} is ${expected.fidelity}${expected.note ? ` (${expected.note})` : ""}`, () => {
      expect(registry.get(id).fidelity).toBe(expected.fidelity);
    });
  }

  it("covers every shipped profile, so a new target cannot skip the table", () => {
    expect([...registry.ids].sort()).toEqual(Object.keys(AP_R8).sort());
  });
});

/**
 * FR-050: a profile must never delete task content by omitting its destination. Every
 * shipped profile must carry the canonical fixture LOSSLESSLY — not merely compile it.
 */
describe("every shipped profile can carry the whole task (FR-050)", () => {
  const ir = loadFixture("empty-state");

  for (const profile of registry.all) {
    it(`${profile.id} has a destination for every content class`, () => {
      const result = compile(ir, profile, { taskSlug: "empty-state" });
      expect(
        result.topologyGaps,
        `${profile.id} cannot render: ${result.topologyGaps.map((g) => g.content_class).join(", ")}`,
      ).toEqual([]);
      expect(codesOf(result.diagnostics)).not.toContain("FORGE-C102");
    });
  }
});

describe("the section catalogue is closed and complete (AP-R5)", () => {
  it("every catalogue key has a registered emitter", () => {
    for (const key of SECTION_KEYS) expect(SECTION_REGISTRY.has(key)).toBe(true);
  });

  it("registers no emitter outside the catalogue", () => {
    for (const key of SECTION_REGISTRY.keys()) {
      expect(SECTION_KEYS as readonly string[]).toContain(key);
    }
  });

  it("every section is exercised by at least one shipped profile", () => {
    const used = new Set(registry.all.flatMap((p) => p.output.artifacts.flatMap((a) => a.sections)));
    const unused = SECTION_KEYS.filter((k) => !used.has(k));
    expect(unused, `unused section emitters: ${unused.join(", ")}`).toEqual([]);
  });
});

describe("fidelity is enforced, not merely declared (FORGE-C101)", () => {
  it("rejects `full` without registered overrides", () => {
    const profile = testProfile({ fidelity: "full" });
    expect(codesOf(checkFidelity(profile, REGISTERED_OVERRIDES))).toContain("FORGE-C101");
  });

  it("rejects `full` declaring an override the renderer does not implement", () => {
    const profile = testProfile({
      fidelity: "full",
      output: {
        artifacts: [{ path: "A.md", sections: ["objective", "goals", "constraints"] }],
        path_vars: [],
        overrides: { constraints: "imaginary.constraints" },
      },
    });
    expect(codesOf(checkFidelity(profile, REGISTERED_OVERRIDES))).toContain("FORGE-C101");
  });

  it("accepts `native_topology` with a single-artifact topology (AP-R6, arity is not fidelity)", () => {
    // The rule this replaces required >= 2 artifacts, which contradicted AP-R8 for
    // `hermes-agent` and `claude-design` — both single-artifact BY NATURE. A target
    // whose native convention is one file can claim that its layout is native.
    const profile = testProfile({
      fidelity: "native_topology",
      output: {
        artifacts: [{ path: "A.md", sections: ["objective", "goals", "constraints"] }],
        path_vars: [],
      },
    });
    expect(checkFidelity(profile, REGISTERED_OVERRIDES)).toEqual([]);
  });

  it("rejects `compatibility` with a multi-file topology", () => {
    // `compatibility` claims PORTABILITY — one generic artifact. A bespoke multi-file
    // layout is not that, so the profile is describing itself incorrectly.
    const profile = testProfile({
      fidelity: "compatibility",
      output: {
        artifacts: [
          { path: "A.md", sections: ["objective", "constraints"] },
          { path: "B.md", sections: ["goals"] },
        ],
        path_vars: [],
      },
    });
    expect(codesOf(checkFidelity(profile, REGISTERED_OVERRIDES))).toContain("FORGE-C101");
  });

  it("accepts `native_topology` with a multi-file topology", () => {
    const profile = testProfile({
      fidelity: "native_topology",
      output: {
        artifacts: [
          { path: "A.md", sections: ["objective", "constraints"] },
          { path: "B.md", sections: ["goals"] },
        ],
        path_vars: [],
      },
    });
    expect(checkFidelity(profile, REGISTERED_OVERRIDES)).toEqual([]);
  });

  it("rejects overrides declared below `full`", () => {
    const profile = testProfile({
      fidelity: "compatibility",
      output: {
        artifacts: [{ path: "A.md", sections: ["objective", "goals", "constraints"] }],
        path_vars: [],
        overrides: { constraints: "x" },
      },
    });
    expect(codesOf(checkFidelity(profile, REGISTERED_OVERRIDES))).toContain("FORGE-C101");
  });

  it("accepts `compatibility` with one artifact", () => {
    expect(checkFidelity(testProfile(), REGISTERED_OVERRIDES)).toEqual([]);
  });
});

describe("path templates cannot escape the output directory (FR-024)", () => {
  const cases = [
    ["/etc/passwd", "absolute"],
    ["../outside/x.md", "traversal"],
    ["a\\b.md", "backslash"],
    ["specs/{unknown_var}/x.md", "unknown variable"],
  ] as const;

  for (const [path, why] of cases) {
    it(`rejects ${why}: ${path}`, () => {
      expect(() =>
        testProfile({
          output: {
            artifacts: [{ path, sections: ["objective", "goals", "constraints"] }],
            path_vars: [],
          },
        }),
      ).toThrow();
    });
  }
});

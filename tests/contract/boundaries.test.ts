/**
 * Boundary registry contract (MB-R2, AC-016, INV-009).
 *
 * Every registered model boundary satisfies all eight properties. Adding a
 * boundary without satisfying them fails the build HERE, not in production.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BOUNDARIES } from "../../src/model/boundaries.js";

const REPO_ROOT = join(new URL(".", import.meta.url).pathname, "..", "..");

/**
 * Property 5 needs two materially different inputs per boundary, and input
 * shapes differ by boundary. Hardcoding `{ text }` made a new boundary fail
 * here for the wrong reason — a schema mismatch reported as an unstable
 * cassette key. A boundary with no sample below fails loudly and on purpose.
 */
const CASSETTE_SAMPLES: Record<string, readonly [unknown, unknown]> = {
  "intent.extract": [{ text: "Fix the flaky login test." }, { text: "A different task." }],
  "conversation.classify": [
    {
      message: "Why did you structure it that way?",
      state: { hasCurrentPrompt: true, versions: [1], candidateCount: 0, hasPendingClarification: false },
    },
    {
      message: "Make it stricter about error handling.",
      state: { hasCurrentPrompt: true, versions: [1], candidateCount: 0, hasPendingClarification: false },
    },
  ],
  "conversation.generate": [
    { action: "REVISE", system: "You are FORGE.", user: "Make it stricter." },
    { action: "REVISE", system: "You are FORGE.", user: "Make it terser." },
  ],
  "conversation.candidate": [
    { strategy: "surgical", base: "The current prompt.", system: "You are FORGE.", user: "Alternative, please." },
    { strategy: "rigorous", base: "The current prompt.", system: "You are FORGE.", user: "Alternative, please." },
  ],
};

describe("model boundary registry", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(BOUNDARIES)).toBe(true);
  });

  for (const [id, boundary] of Object.entries(BOUNDARIES)) {
    describe(id, () => {
      it("1. is explicitly registered under its own id", () => {
        expect(boundary.id).toBe(id);
      });

      it("2. carries a non-empty version", () => {
        expect(boundary.version.trim().length).toBeGreaterThan(0);
      });

      it("3. declares Zod input and output schemas", () => {
        expect(boundary.inputSchema).toBeInstanceOf(z.ZodType);
        expect(boundary.outputSchema).toBeInstanceOf(z.ZodType);
      });

      it("4. declares deterministic post-validators", () => {
        expect(Array.isArray(boundary.postValidators)).toBe(true);
        expect(boundary.postValidators.length).toBeGreaterThan(0);
        for (const validator of boundary.postValidators) {
          expect(typeof validator).toBe("function");
        }
      });

      it("5. derives a stable content-addressed cassette key from the input", () => {
        const sample = CASSETTE_SAMPLES[id];
        expect(sample, `add a cassette sample input for "${id}"`).toBeDefined();
        const [input, other] = sample as readonly [unknown, unknown];
        expect(boundary.inputSchema.safeParse(input).success).toBe(true);
        const first = boundary.cassetteKey(input as never);
        const second = boundary.cassetteKey(input as never);
        expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(first).toBe(second);
        expect(boundary.cassetteKey(other as never)).not.toBe(first);
      });

      it("6. declares required and an onFailure of fail|skip — never guess (MB-R3)", () => {
        expect(typeof boundary.required).toBe("boolean");
        expect(["fail", "skip"]).toContain(boundary.onFailure);
      });

      it("7. is observable and provenance-recorded via the boundary id", () => {
        // The run record keys off boundaryId + boundaryVersion; a boundary
        // without a stable id cannot be recorded (FR-049).
        expect(boundary.id).toMatch(/^[a-z][a-z0-9.]*$/);
      });

      it("8. has a dedicated test file", () => {
        expect(existsSync(join(REPO_ROOT, "tests", "boundaries", `${id}.test.ts`))).toBe(true);
      });
    });
  }

  it("registers exactly the current boundaries (critic.judge is still P6)", () => {
    expect(Object.keys(BOUNDARIES)).toEqual([
      "intent.extract",
      "conversation.classify",
      "conversation.generate",
      "conversation.candidate",
    ]);
    expect(BOUNDARIES["intent.extract"].required).toBe(true);
    expect(BOUNDARIES["intent.extract"].onFailure).toBe("fail");
  });

  it("degrades, never guesses, on the two judgment boundaries (WS-R4, AD-22)", () => {
    // Both classification and generation fail SAFE: the pipeline degrades to
    // DISCUSS and writes no version. "required: true" here would turn a
    // model's bad day into a lost turn; "fail" would do the same.
    expect(BOUNDARIES["conversation.classify"].onFailure).toBe("skip");
    expect(BOUNDARIES["conversation.classify"].required).toBe(false);
    expect(BOUNDARIES["conversation.generate"].onFailure).toBe("skip");
    expect(BOUNDARIES["conversation.generate"].required).toBe(false);
  });
});

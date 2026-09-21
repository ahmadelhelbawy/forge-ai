/**
 * The compiler version is pinned, and the pin is checked (`IR-R14`, `INV-005`).
 *
 * `FORGE_COMPILER_VERSION` is a member of the semantic input tuple, so it
 * decides whether two packages share a `semantic_id`. A literal that silently
 * disagreed with the published package version would make the id a claim about
 * a build that does not exist — the same failure the tokenizer pin exists to
 * prevent, which is why this test mirrors it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { FORGE_COMPILER_VERSION } from "../../src/compile/version.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("the pinned compiler version", () => {
  it("equals the version the package publishes", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(FORGE_COMPILER_VERSION).toBe(pkg.version);
  });

  it("is a literal, not a runtime read", async () => {
    // A filesystem read at module load would make the pure core depend on its
    // own package layout, and would let the recorded version drift from the
    // one the build was tested against.
    const source = readFileSync(join(REPO_ROOT, "src", "compile", "version.ts"), "utf8");
    expect(source).not.toMatch(/readFileSync|require\(|import\s*\(/);
  });
});

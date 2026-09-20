/**
 * Tokenizer identity — IR-R14, NFR-009, AOC-7.
 *
 * The tokenizer is a SEMANTIC INPUT: budgeting can drop context, which changes rendered
 * bytes. So "which tokenizer, at which version, using which encoding" is part of what
 * makes a compilation reproducible, and a declared identity that drifts from reality is
 * worse than none — it makes a false claim look verified.
 *
 * Three drifts were possible before this file existed, and the only guard was
 * `expect(DEFAULT_TOKEN_ESTIMATOR.version).toBeTruthy()`:
 *
 *   1. the declared version is a hand-typed literal, while the dependency range was
 *      `^4.0.0` — a minor upgrade would keep claiming the old version;
 *   2. the encoding came from the package ROOT export, i.e. whatever the library
 *      currently defaults to, while the declared id named a specific encoding;
 *   3. nothing recorded the estimator identity on a compilation at all, so a change was
 *      invisible to everything except a golden snapshot.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { encode as o200k } from "gpt-tokenizer/encoding/o200k_base";
import { encode as cl100k } from "gpt-tokenizer/encoding/cl100k_base";

import { compile } from "../../src/compile/compile.js";
import {
  CHAR_TOKEN_ESTIMATOR,
  DEFAULT_ENCODING,
  DEFAULT_TOKEN_ESTIMATOR,
  TOKENIZER_PACKAGE,
  TOKENIZER_PACKAGE_VERSION,
} from "../../src/compile/tokenizer.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { REPO_ROOT, loadFixture } from "../helpers/fixtures.js";

const require = createRequire(import.meta.url);

const SAMPLE =
  "Add an empty state to the search results view for when a query returns nothing, " +
  "without changing the data-fetching layer. Ünïcödé and emoji 🙂 included.";

describe("the declared tokenizer version matches the installed package", () => {
  it("equals the version resolved at runtime", () => {
    const installed = require(`${TOKENIZER_PACKAGE}/package.json`) as { version: string };
    expect(DEFAULT_TOKEN_ESTIMATOR.version).toBe(installed.version);
    expect(TOKENIZER_PACKAGE_VERSION).toBe(installed.version);
  });

  it("is pinned EXACTLY in package.json, because the declared version is a literal", () => {
    const pkg = require(join(REPO_ROOT, "package.json")) as {
      dependencies: Record<string, string>;
    };
    const spec = pkg.dependencies[TOKENIZER_PACKAGE];
    expect(spec).toBeDefined();
    expect(spec, `${TOKENIZER_PACKAGE} must be pinned exactly, not ranged`).toBe(
      TOKENIZER_PACKAGE_VERSION,
    );
  });
});

describe("the declared encoding is the encoding actually used", () => {
  it("names the encoding in its id", () => {
    expect(DEFAULT_TOKEN_ESTIMATOR.id).toBe(`${TOKENIZER_PACKAGE}/${DEFAULT_ENCODING}`);
  });

  it("counts identically to the named encoding", () => {
    expect(DEFAULT_TOKEN_ESTIMATOR.count(SAMPLE)).toBe(o200k(SAMPLE).length);
  });

  it("counts differently from a DIFFERENT encoding, so the assertion above means something", () => {
    // Guards against a tautology: if both encodings agreed on every input, matching one
    // of them would prove nothing about which is in use.
    expect(o200k(SAMPLE).length).not.toBe(cl100k(SAMPLE).length);
    expect(DEFAULT_TOKEN_ESTIMATOR.count(SAMPLE)).not.toBe(cl100k(SAMPLE).length);
  });

  it("counts deterministically, including the empty string", () => {
    expect(DEFAULT_TOKEN_ESTIMATOR.count(SAMPLE)).toBe(DEFAULT_TOKEN_ESTIMATOR.count(SAMPLE));
    expect(DEFAULT_TOKEN_ESTIMATOR.count("")).toBe(0);
  });
});

describe("the estimator identity is recorded on every compilation (IR-R14)", () => {
  const registry = builtinProfiles();
  const ir = loadFixture("empty-state");

  it("reports the id and version used to budget", () => {
    const result = compile(ir, registry.get("claude-code"), { taskSlug: "empty-state" });
    expect(result.tokenizer).toEqual({
      id: DEFAULT_TOKEN_ESTIMATOR.id,
      version: DEFAULT_TOKEN_ESTIMATOR.version,
    });
  });

  it("reports the substituted estimator when one is supplied", () => {
    const result = compile(ir, registry.get("claude-code"), {
      taskSlug: "empty-state",
      estimator: CHAR_TOKEN_ESTIMATOR,
    });
    expect(result.tokenizer.id).toBe(CHAR_TOKEN_ESTIMATOR.id);
    expect(result.tokenizer.version).toBe(CHAR_TOKEN_ESTIMATOR.version);
  });

  it("records the identity even when compilation is refused", () => {
    // A refusal is still a compilation attempt with a tokenizer; P5's identity tuple
    // must not have a hole where the interesting cases are.
    const refused = compile(loadFixture("auth-debug"), registry.get("claude-design"));
    expect(refused.refused).toBe(true);
    expect(refused.tokenizer.id).toBe(DEFAULT_TOKEN_ESTIMATOR.id);
  });
});

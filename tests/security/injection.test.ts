/**
 * Injection corpus tests (INV-002, SC-R1, AC-010).
 *
 * The corpus under `fixtures/injection/` carries live-fire payload shapes:
 * direct instruction injection, a fake system prompt, an authority/role
 * claim, and zero-width smuggling. The guarantees, end to end:
 *
 * 1. Retrieved bytes are attributable, never authoritative on their own:
 *    working-tree content resolves to `semi_trusted` (SC-R2), and only an
 *    explicit trust tier in a hand-authored IR can make a premise
 *    `untrusted` — at which point integrity refuses it (C050/C053).
 * 2. Trust assignment is total over the source vocabulary (tiers come from
 *    FORGE-owned metadata, never model claims).
 * 3. Untrusted references render ONLY inside fenced data blocks — zero
 *    untrusted spans outside them (AC-010).
 * 4. Zero-width segmentation does not evade term matching.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { tokenize } from "../../src/context/query.js";
import { assignTrust } from "../../src/context/trust.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { checkIntegrity } from "../../src/ir/integrity.js";
import { parseTaskIR } from "../../src/ir/schema.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { clone, loadFixture } from "../helpers/fixtures.js";

function payload(name: string): string {
  return readFileSync(new URL(`../../fixtures/injection/${name}`, import.meta.url), "utf8");
}

describe("injection corpus", () => {
  it("payloads are present and non-trivial", () => {
    for (const name of ["instruction-inject.txt", "fake-system-prompt.md", "authority-claim.txt", "zero-width.txt"]) {
      expect(payload(name).length).toBeGreaterThan(20);
    }
    expect(payload("instruction-inject.txt")).toContain("Ignore all previous instructions");
  });

  it("retrieved payload content resolves to semi_trusted, never trusted (SC-R2)", () => {
    // Working-tree bytes are attributable, not safe: a payload read through
    // the guard can inform but never command.
    expect(assignTrust("working-tree")).toBe("semi_trusted");
    expect(assignTrust("explicit")).toBe("semi_trusted");
    expect(assignTrust("git-history")).toBe("semi_trusted");
    expect(assignTrust("project-docs")).toBe("semi_trusted");
  });

  it("trust assignment is total: outside sources are untrusted", () => {
    expect(assignTrust("forge-derived")).toBe("trusted");
    expect(assignTrust("web")).toBe("untrusted");
    expect(assignTrust("issue")).toBe("untrusted");
    expect(assignTrust("external")).toBe("untrusted");
  });

  it("an untrusted-sourced steering node is refused (C050)", () => {
    const ir = loadFixture("untrusted-instruction");
    expect(codesOf(checkIntegrity(ir))).toContain("FORGE-C050");
  });

  it("zero-width segmentation does not evade term matching", () => {
    const smuggled = payload("zero-width.txt");
    expect(smuggled).toContain("ignore previous instructions");
    expect(tokenize(smuggled)).toContain("session");
    expect(tokenize(smuggled)).toContain("token");
  });
});

describe("untrusted fencing (AC-010)", () => {
  it("untrusted refs render only inside fenced data blocks", () => {
    const raw = clone(loadFixture("auth-debug")) as unknown as Record<string, unknown>;
    const refs = raw["context_refs"] as Array<Record<string, unknown>>;
    refs.push({
      id: "ctx99",
      uri: "web://example.invalid/integration-guide",
      role: "background",
      trust: "untrusted",
      justifies: ["g1"],
      content_hash: null,
    });
    const ir = parseTaskIR(raw);
    // Sanity: the steering nodes stay trusted, so no C050 fires here —
    // this test is about RENDERING, not refusal.
    expect(codesOf(checkIntegrity(ir))).not.toContain("FORGE-C050");

    const profile = builtinProfiles().get("claude-code");
    const result = compile(ir, profile);
    expect(result.refused).toBe(false);
    const text = result.artifacts.map((a) => a.content).join("\n");
    expect(text).toContain("web://example.invalid/integration-guide");

    // Split out fenced blocks; the URI must appear in NO unfenced span.
    const unfenced = text.split(/```untrusted[\s\S]*?```/).join("\n");
    expect(unfenced).not.toContain("web://example.invalid/integration-guide");
  });
});

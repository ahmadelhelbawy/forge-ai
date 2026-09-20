/**
 * Byte-level trace coverage — INV-010, AC-006, FORGE-C100, and the resolution of AOC-10.
 *
 * AOC-10 recorded byte-level total attribution as an unproven architectural claim, to
 * be prototyped on two or three emitters BEFORE substantial rendering logic was built.
 * This file is that prototype, kept as the permanent regression test.
 *
 * The finding: the invariant is practical, provided attribution is a property of HOW
 * text is built rather than something reconstructed afterwards. `TracedTextBuilder`
 * makes untraced non-whitespace text unrepresentable — `gap()` throws on it — so
 * coverage holds by construction and `verifyCoverage` only has to catch assembly
 * mistakes.
 */
import { describe, expect, it } from "vitest";

import { acceptanceSection, goalsSection } from "../../src/compile/sections/goals.js";
import { constraintsSection } from "../../src/compile/sections/constraints.js";
import { objectiveSection } from "../../src/compile/sections/objective.js";
import { analyseCoverage, verifyCoverage } from "../../src/trace/coverage.js";
import { TracedTextBuilder, UntracedTextError, rebase } from "../../src/trace/span.js";
import type { Span } from "../../src/trace/span.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { loadFixture } from "../helpers/fixtures.js";
import { sectionInputFor } from "../helpers/compile.js";
import { compile } from "../../src/compile/compile.js";
import { builtinProfiles } from "../../src/profile/registry.js";

const PROTOTYPE_EMITTERS = [objectiveSection, goalsSection, acceptanceSection, constraintsSection];

describe("TracedTextBuilder makes untraced text unrepresentable", () => {
  it("refuses non-whitespace text through gap()", () => {
    const b = new TracedTextBuilder();
    expect(() => b.gap("this is not whitespace")).toThrow(UntracedTextError);
  });

  it("accepts whitespace separators through gap()", () => {
    const b = new TracedTextBuilder();
    expect(() => b.gap("\n\n  \t\n")).not.toThrow();
  });

  it("accumulates BYTE offsets, not UTF-16 code units", () => {
    const origin = { kind: "ir_node", node_id: "g1" } as const;
    const b = new TracedTextBuilder();
    // "é" is 1 UTF-16 unit but 2 UTF-8 bytes; "🔧" is 2 units but 4 bytes.
    b.add("é🔧", origin).add("x", origin);
    const out = b.build();
    expect(out.spans[0]).toMatchObject({ start: 0, end: 6 });
    expect(out.spans[1]).toMatchObject({ start: 6, end: 7 });
    expect(Buffer.byteLength(out.text, "utf8")).toBe(7);
  });

  it("creates no zero-length spans", () => {
    const b = new TracedTextBuilder();
    b.add("", { kind: "ir_node", node_id: "g1" });
    expect(b.build().spans).toHaveLength(0);
  });
});

describe("every prototype emitter achieves total byte attribution (AOC-10)", () => {
  const ir = loadFixture("auth-debug");

  for (const emitter of PROTOTYPE_EMITTERS) {
    it(`${emitter.key} leaves no non-whitespace byte unattributed`, () => {
      const input = sectionInputFor(ir, emitter.key);
      const output = emitter.emit(input);
      expect(output, `${emitter.key} produced no output for the canonical fixture`).not.toBeNull();

      const spans = rebase(output!.spans, "test.md", 0);
      const report = analyseCoverage("test.md", output!.text, spans);

      expect(report.gaps, `unattributed regions in ${emitter.key}`).toEqual([]);
      expect(report.overlaps, `overlapping spans in ${emitter.key}`).toEqual([]);
      expect(verifyCoverage("test.md", output!.text, spans)).toEqual([]);
    });

    it(`${emitter.key} attributes every span to a resolvable typed origin`, () => {
      const input = sectionInputFor(ir, emitter.key);
      const output = emitter.emit(input);
      for (const span of output!.spans) {
        expect(span.origin.kind).toBeTruthy();
        expect(span.end).toBeGreaterThan(span.start);
        if (span.origin.kind === "renderer_template") {
          expect(span.origin.section_key).toBe(emitter.key);
        }
      }
    });
  }

  it("attributes structural text to renderer_template, never to an IR node", () => {
    const input = sectionInputFor(ir, "objective");
    const output = objectiveSection.emit(input)!;
    const headingSpan = output.spans.find((s) => output.text.slice(s.start, s.end).startsWith("## "));
    expect(headingSpan?.origin.kind).toBe("renderer_template");
  });

  it("covers a meaningful share of bytes, not one span over the whole section", () => {
    const input = sectionInputFor(ir, "constraints");
    const output = constraintsSection.emit(input)!;
    // Real granularity: markers, statements and kind labels are separate spans.
    expect(output.spans.length).toBeGreaterThan(6);
  });
});

describe("verifyCoverage detects real defects (FORGE-C100)", () => {
  const content = "## Heading\n\nA statement here.\n";

  it("reports an untraced non-whitespace region", () => {
    const spans: Span[] = [
      { artifact_path: "a.md", start: 0, end: 10, origin: { kind: "ir_node", node_id: "g1" } },
      // bytes 12–29 ("A statement here.") deliberately left unattributed
    ];
    const diagnostics = verifyCoverage("a.md", content, spans);
    expect(codesOf(diagnostics)).toContain("FORGE-C100");
    expect(diagnostics[0]!.evidence[0]).toMatchObject({ kind: "span", artifact_path: "a.md" });
  });

  it("accepts whitespace-only gaps", () => {
    const spans: Span[] = [
      { artifact_path: "a.md", start: 0, end: 10, origin: { kind: "ir_node", node_id: "g1" } },
      { artifact_path: "a.md", start: 12, end: 29, origin: { kind: "ir_node", node_id: "g2" } },
    ];
    expect(verifyCoverage("a.md", content, spans)).toEqual([]);
  });

  it("reports overlapping spans", () => {
    const spans: Span[] = [
      { artifact_path: "a.md", start: 0, end: 15, origin: { kind: "ir_node", node_id: "g1" } },
      { artifact_path: "a.md", start: 10, end: 29, origin: { kind: "ir_node", node_id: "g2" } },
    ];
    const diagnostics = verifyCoverage("a.md", content, spans);
    expect(codesOf(diagnostics)).toContain("FORGE-C100");
    expect(diagnostics.some((d) => d.message.includes("overlapping"))).toBe(true);
  });

  it("reports a trailing untraced region", () => {
    const spans: Span[] = [
      { artifact_path: "a.md", start: 0, end: 10, origin: { kind: "ir_node", node_id: "g1" } },
      { artifact_path: "a.md", start: 12, end: 20, origin: { kind: "ir_node", node_id: "g2" } },
    ];
    expect(codesOf(verifyCoverage("a.md", content, spans))).toContain("FORGE-C100");
  });

  it("ignores spans belonging to other artifacts", () => {
    const spans: Span[] = [
      { artifact_path: "other.md", start: 0, end: 99, origin: { kind: "ir_node", node_id: "g1" } },
    ];
    expect(codesOf(verifyCoverage("a.md", content, spans))).toContain("FORGE-C100");
  });
});

describe("total attribution holds for every real compiled artifact (INV-010, AC-006)", () => {
  const registry = builtinProfiles();
  const ir = loadFixture("empty-state");

  for (const profile of registry.all) {
    it(`${profile.id} emits no untraced bytes`, () => {
      const result = compile(ir, profile, { taskSlug: "empty-state" });
      expect(result.refused).toBe(false);
      expect(result.artifacts.length).toBeGreaterThan(0);

      for (const artifact of result.artifacts) {
        const report = analyseCoverage(artifact.path, artifact.content, result.spans);
        expect(report.gaps, `${profile.id}/${artifact.path} has untraced regions`).toEqual([]);
        expect(report.overlaps, `${profile.id}/${artifact.path} has overlapping spans`).toEqual([]);
        // A real artifact, not an empty one.
        expect(report.total_bytes).toBeGreaterThan(200);
        expect(report.covered_bytes / report.total_bytes).toBeGreaterThan(0.9);
      }
      expect(codesOf(result.diagnostics)).not.toContain("FORGE-C100");
    });
  }

  it("uses every typed origin kind that P1 can produce", () => {
    // ir_node, renderer_template, compiler_rule, agent_profile and context_ref are all
    // reachable in P1. `strategy` origins arrive with overlays in P4.
    const kinds = new Set<string>();
    for (const profile of registry.all) {
      const result = compile(ir, profile, { taskSlug: "empty-state" });
      for (const span of result.spans) kinds.add(span.origin.kind);
    }
    expect([...kinds].sort()).toEqual([
      "agent_profile",
      "compiler_rule",
      "context_ref",
      "ir_node",
      "renderer_template",
    ]);
  });

  it("attributes structural text away from IR nodes", () => {
    const result = compile(ir, registry.get("claude-code"), { taskSlug: "empty-state" });
    const prompt = result.artifacts.find((a) => a.path === "PROMPT.md")!;
    const bytes = Buffer.from(prompt.content, "utf8");

    for (const span of result.spans.filter((s) => s.artifact_path === prompt.path)) {
      const text = bytes.subarray(span.start, span.end).toString("utf8");
      if (text.startsWith("## ")) {
        expect(span.origin.kind, `heading ${JSON.stringify(text)} misattributed`).toBe(
          "renderer_template",
        );
      }
    }
  });
});

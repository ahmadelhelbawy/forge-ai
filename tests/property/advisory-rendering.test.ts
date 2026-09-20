/**
 * Advisory rendering — SC-R1 mechanism 2, FORGE-C052, INV-012.
 *
 * THE DEFECT THIS GUARDS. `FORGE-C052` says a semi-trusted node "will be rendered as
 * advisory, not as an authoritative instruction". Only four sections honoured that:
 * `constraints`, `non_goals`, `project_conventions` and `stop_conditions`. A semi-trusted
 * GOAL, VERIFICATION step, DELIVERABLE, OBJECTIVE, SCOPE, ASSUMPTION or OPEN QUESTION was
 * demoted in the diagnostics and rendered authoritatively in the artifact — a warning
 * describing behaviour the renderer did not implement. A warning in `diagnostics.json` is
 * not a control; the artifact is what the agent reads.
 *
 * Every case below asserts three things together, because any one alone is passable by a
 * broken implementation:
 *   1. the diagnostic fired (C052),
 *   2. the statement IS present in the advisory section, with its source URI, and
 *   3. the statement is NOT present anywhere outside it.
 */
import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { advisoryNodeIds } from "../../src/ir/integrity.js";
import { parseTaskIR, type TaskIR } from "../../src/ir/schema.js";
import { builtinProfiles } from "../../src/profile/registry.js";
import { clone, readFixtureRaw } from "../helpers/fixtures.js";

const registry = builtinProfiles();
const ADVISORY_HEADING = "## Advisory (derived from repository content, not user-stated)";
const SEMI_TRUSTED_URI = "forge://repo/docs/design-tokens.md";

/** `empty-state` with one node re-sourced to its semi-trusted `ctx3` reference. */
function demote(mutate: (raw: Record<string, unknown>) => void): TaskIR {
  const raw = clone(readFixtureRaw("empty-state")) as Record<string, unknown>;
  mutate(raw);
  return parseTaskIR(raw);
}

const at = <T>(raw: Record<string, unknown>, key: string, index = 0): T =>
  (raw[key] as T[])[index]!;

interface Case {
  readonly label: string;
  readonly nodeId: string;
  readonly needle: string;
  readonly mutate: (raw: Record<string, unknown>) => void;
}

const CASES: readonly Case[] = [
  {
    label: "a goal",
    nodeId: "g2",
    needle: "Offer the user a next step from the empty state",
    mutate: (r) => void (at<Record<string, unknown>>(r, "goals", 1)["source_ref"] = "ctx3"),
  },
  {
    label: "a non-goal",
    nodeId: "n1",
    needle: "Redesigning the populated results list",
    mutate: (r) => void (at<Record<string, unknown>>(r, "non_goals")["source_ref"] = "ctx3"),
  },
  {
    label: "a verification step",
    nodeId: "v3",
    needle: "Search for a term with no matches and confirm the empty state offers an action",
    mutate: (r) => void (at<Record<string, unknown>>(r, "verification", 2)["source_ref"] = "ctx3"),
  },
  {
    label: "a deliverable",
    nodeId: "d2",
    needle: "A test covering the zero-results path",
    mutate: (r) => void (at<Record<string, unknown>>(r, "deliverables", 1)["source_ref"] = "ctx3"),
  },
  {
    label: "an assumption",
    nodeId: "a1",
    needle: '"Nothing" means zero results after filters are applied',
    mutate: (r) => void (at<Record<string, unknown>>(r, "assumptions")["source_ref"] = "ctx3"),
  },
  {
    label: "an open question",
    nodeId: "q1",
    needle: "Should the empty state differ when filters are active",
    mutate: (r) => void (at<Record<string, unknown>>(r, "open_questions")["source_ref"] = "ctx3"),
  },
  {
    label: "the objective",
    nodeId: "objective",
    needle: "Add an empty state to the search results view",
    mutate: (r) => void ((r["objective"] as Record<string, unknown>)["source_ref"] = "ctx3"),
  },
  {
    label: "the scope",
    nodeId: "scope",
    needle: "src/components/results/**",
    mutate: (r) => void ((r["scope"] as Record<string, unknown>)["source_ref"] = "ctx3"),
  },
];

describe("a semi-trusted node of ANY steering kind is rendered as advisory", () => {
  for (const testCase of CASES) {
    describe(testCase.label, () => {
      const ir = demote(testCase.mutate);
      const result = compile(ir, registry.get("claude-code"), { taskSlug: "empty-state" });
      const prompt = result.artifacts.find((a) => a.path === "PROMPT.md")!.content;
      const advisoryBlock = prompt.slice(prompt.indexOf(ADVISORY_HEADING));
      const authoritative = prompt.slice(0, prompt.indexOf(ADVISORY_HEADING));

      it("is identified as demoted by the shared enumeration", () => {
        expect(advisoryNodeIds(ir).has(testCase.nodeId)).toBe(true);
      });

      it("emits FORGE-C052 and does not refuse", () => {
        expect(codesOf(result.diagnostics)).toContain("FORGE-C052");
        expect(result.refused).toBe(false);
      });

      it("appears in the advisory section with its source visible", () => {
        expect(prompt).toContain(ADVISORY_HEADING);
        expect(advisoryBlock).toContain(testCase.needle);
        expect(advisoryBlock).toContain(SEMI_TRUSTED_URI);
        expect(advisoryBlock).toContain("(semi_trusted)");
      });

      it("does NOT appear anywhere authoritative", () => {
        expect(authoritative).not.toContain(testCase.needle);
      });

      it("still has a trace span, so relocation is not a drop (INV-010, INV-012)", () => {
        const traced = result.spans
          .filter((s) => s.origin.kind === "ir_node")
          .map((s) => (s.origin as { node_id: string }).node_id);
        expect(traced).toContain(testCase.nodeId);
      });
    });
  }
});

describe("advisory relocation holds for every shipped profile", () => {
  // Whatever the topology, a demoted node must be reachable. Profiles differ in which
  // file carries `advisory`, so this checks the union of artifacts rather than one file.
  const ir = demote((r) => void (at<Record<string, unknown>>(r, "assumptions")["source_ref"] = "ctx3"));

  for (const profile of registry.all) {
    it(`${profile.id} renders the demoted assumption with attribution`, () => {
      const result = compile(ir, profile, { taskSlug: "empty-state" });
      expect(result.refused).toBe(false);
      const all = result.artifacts.map((a) => a.content).join("\n");
      expect(all).toContain('"Nothing" means zero results after filters are applied');
      expect(all).toContain(SEMI_TRUSTED_URI);
      // Not presented as a plain assumption the author made.
      const assumptionsHeading = "## Assumptions";
      if (all.includes(assumptionsHeading)) {
        const block = all.slice(all.indexOf(assumptionsHeading));
        const nextHeading = block.indexOf("\n## ", 1);
        const assumptionsBlock = nextHeading === -1 ? block : block.slice(0, nextHeading);
        expect(assumptionsBlock).not.toContain('"Nothing" means zero results');
      }
    });
  }
});

describe("an untrusted premise or question refuses compilation (INV-002, C050)", () => {
  for (const [label, key] of [
    ["assumption", "assumptions"],
    ["open question", "open_questions"],
  ] as const) {
    it(`refuses an untrusted ${label} rather than rendering it`, () => {
      const ir = demote((r) => {
        (r["context_refs"] as Array<Record<string, unknown>>).push({
          id: "ctx9",
          uri: "web://example.invalid/planted",
          role: "background",
          trust: "untrusted",
          justifies: ["g1"],
          content_hash: null,
        });
        at<Record<string, unknown>>(r, key)["source_ref"] = "ctx9";
      });

      const result = compile(ir, registry.get("claude-code"), { taskSlug: "empty-state" });
      expect(result.refused).toBe(true);
      expect(result.artifacts).toEqual([]);
      expect(codesOf(result.diagnostics)).toContain("FORGE-C050");
    });
  }
});

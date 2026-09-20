/**
 * Topology coverage — FORGE-C102, FR-050, INV-012, AP-R9.
 *
 * THE DEFECT THIS GUARDS, reproduced exactly as it was found: compiling `empty-state`
 * against a valid profile whose topology declared only the mandatory sections silently
 * deleted both non-goals, all three verification steps, the entire scope, every acceptance
 * criterion, and a semi-trusted constraint that `FORGE-C052` had just promised would "be
 * rendered as advisory" — with `refused: false` and not one diagnostic naming a loss.
 *
 * Reachable through profile DATA alone, which is the supported extension path (AC-017),
 * so it was reachable by a contributor with no code review at all.
 *
 * The policy asserted here: instruction-bearing and advisory-required content missing a
 * destination REFUSES; influence-bearing and supporting content DEGRADES explicitly.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compile } from "../../src/compile/compile.js";
import { checkTopologyCoverage } from "../../src/critic/deterministic/index.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { advisoryNodeIds } from "../../src/ir/integrity.js";
import { parseTaskIR } from "../../src/ir/schema.js";
import { loadProfilesFrom } from "../../src/profile/registry.js";
import { REPO_ROOT, clone, loadFixture, readFixtureRaw } from "../helpers/fixtures.js";
import { testProfile } from "../helpers/compile.js";
import type { SectionKey } from "../../src/compile/vocabulary.js";

const fixtureProfiles = loadProfilesFrom(join(REPO_ROOT, "fixtures", "profiles"));
const lossy = fixtureProfiles.get("lossy-agent");
const ir = loadFixture("empty-state");

/** A profile carrying exactly the given sections in one artifact. */
const withSections = (sections: readonly SectionKey[]) =>
  testProfile({
    output: { artifacts: [{ path: "TASK.md", sections }], path_vars: [] },
    budget: { max_context_tokens: 200000, artifact_share: 0.5 },
  });

describe("a lossy topology refuses rather than deleting content (FORGE-C102)", () => {
  const result = compile(ir, lossy, { taskSlug: "empty-state" });

  it("refuses compilation and emits nothing", () => {
    expect(result.refused).toBe(true);
    expect(result.artifacts).toEqual([]);
  });

  it("emits FORGE-C102 for every unrenderable instruction-bearing class", () => {
    expect(codesOf(result.diagnostics)).toContain("FORGE-C102");
    const classes = result.topologyGaps.map((g) => g.content_class).sort();
    expect(classes).toContain("scope");
    expect(classes).toContain("non_goals");
    expect(classes).toContain("verification");
    expect(classes).toContain("deliverables");
    expect(classes).toContain("acceptance");
  });

  it("names the advisory gap, so C052 can never again promise a rendering that does not happen", () => {
    // `empty-state` has c3 sourced from a semi-trusted reference.
    expect(advisoryNodeIds(ir).has("c3")).toBe(true);
    const gap = result.topologyGaps.find((g) => g.content_class === "advisory");
    expect(gap).toBeDefined();
    expect(gap!.severity).toBe("error");
    expect(gap!.node_ids).toContain("c3");
  });

  it("cites the affected nodes and counts them, as evidence (INV-007)", () => {
    for (const d of result.diagnostics.filter((x) => x.code === "FORGE-C102")) {
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.evidence.some((e) => e.kind === "measure" && e.unit === "nodes")).toBe(true);
      expect(d.message).toMatch(/Add one of \[/);
    }
  });

  it("still loads as a profile: the defect is task-specific, not a malformed profile", () => {
    expect(lossy.fidelity).toBe("compatibility");
    expect(fixtureProfiles.ids).toContain("lossy-agent");
  });
});

describe("severity follows what losing the content would cost", () => {
  const authoritativeIr = parseTaskIR({
    ...(clone(readFixtureRaw("empty-state")) as Record<string, unknown>),
    // Remove the semi-trusted source so nothing needs the advisory section, isolating
    // the class under test.
    constraints: (readFixtureRaw("empty-state")["constraints"] as Array<Record<string, unknown>>).map(
      (c) => ({ ...c, source_ref: "user_input" }),
    ),
  });

  const ERROR_CLASSES: ReadonlyArray<[string, readonly SectionKey[]]> = [
    ["non_goals", ["objective", "goals", "acceptance", "constraints", "scope", "verification", "deliverables", "context_plan", "assumptions", "open_questions", "untrusted_appendix"]],
    ["verification", ["objective", "goals", "acceptance", "constraints", "scope", "non_goals", "deliverables", "context_plan", "assumptions", "open_questions", "untrusted_appendix"]],
    ["scope", ["objective", "goals", "acceptance", "constraints", "non_goals", "verification", "deliverables", "context_plan", "assumptions", "open_questions", "untrusted_appendix"]],
    ["deliverables", ["objective", "goals", "acceptance", "constraints", "non_goals", "scope", "verification", "context_plan", "assumptions", "open_questions", "untrusted_appendix"]],
    ["acceptance", ["objective", "goals", "constraints", "non_goals", "scope", "verification", "deliverables", "context_plan", "assumptions", "open_questions", "untrusted_appendix"]],
  ];

  for (const [missing, sections] of ERROR_CLASSES) {
    it(`refuses when ${missing} has no destination`, () => {
      const result = compile(authoritativeIr, withSections(sections), { taskSlug: "t" });
      expect(result.refused, `${missing} should refuse`).toBe(true);
      expect(result.topologyGaps.map((g) => g.content_class)).toEqual([missing]);
      expect(result.topologyGaps[0]!.severity).toBe("error");
    });
  }

  const WARNING_CLASSES: ReadonlyArray<[string, readonly SectionKey[]]> = [
    ["assumptions", ["objective", "goals", "acceptance", "constraints", "non_goals", "scope", "verification", "deliverables", "context_plan", "open_questions", "untrusted_appendix"]],
    ["open_questions", ["objective", "goals", "acceptance", "constraints", "non_goals", "scope", "verification", "deliverables", "context_plan", "assumptions", "untrusted_appendix"]],
    ["context_pointers", ["objective", "goals", "acceptance", "constraints", "non_goals", "scope", "verification", "deliverables", "assumptions", "open_questions", "untrusted_appendix"]],
    ["untrusted_refs", ["objective", "goals", "acceptance", "constraints", "non_goals", "scope", "verification", "deliverables", "context_plan", "assumptions", "open_questions"]],
  ];

  for (const [missing, sections] of WARNING_CLASSES) {
    it(`degrades explicitly, without refusing, when ${missing} has no destination`, () => {
      const result = compile(authoritativeIr, withSections(sections), { taskSlug: "t" });
      expect(result.refused, `${missing} should not refuse`).toBe(false);
      expect(result.artifacts.length).toBeGreaterThan(0);
      const gap = result.topologyGaps.find((g) => g.content_class === missing);
      expect(gap, `expected a recorded gap for ${missing}`).toBeDefined();
      expect(gap!.severity).toBe("warning");
      expect(codesOf(result.diagnostics)).toContain("FORGE-C102");
    });
  }
});

describe("a complete topology is silent", () => {
  it("emits no gap when every class has a destination", () => {
    const complete = withSections([
      "objective",
      "goals",
      "acceptance",
      "constraints",
      "non_goals",
      "scope",
      "verification",
      "deliverables",
      "context_plan",
      "assumptions",
      "open_questions",
      "advisory",
      "untrusted_appendix",
      "capability_notes",
    ]);
    const result = compile(ir, complete, { taskSlug: "t" });
    expect(result.topologyGaps).toEqual([]);
    expect(codesOf(result.diagnostics)).not.toContain("FORGE-C102");
  });

  it("says nothing about content the task does not have", () => {
    // An IR with no open questions must not trip the open_questions class.
    const raw = clone(readFixtureRaw("empty-state")) as Record<string, unknown>;
    raw["open_questions"] = [];
    raw["assumptions"] = [];
    const trimmed = parseTaskIR(raw);
    const coverage = checkTopologyCoverage({
      ir: trimmed,
      profile: withSections(["objective", "goals", "constraints"]),
      advisory: new Set(),
      materialization: new Map(),
      hasEnvironmentNotes: false,
    });
    const classes = coverage.gaps.map((g) => g.content_class);
    expect(classes).not.toContain("assumptions");
    expect(classes).not.toContain("open_questions");
    expect(classes).not.toContain("context_pointers");
  });

  it("treats task_checklist as a valid destination for goals and acceptance", () => {
    const coverage = checkTopologyCoverage({
      ir,
      profile: withSections(["objective", "goals", "constraints", "task_checklist"]),
      advisory: new Set(),
      materialization: new Map(),
      hasEnvironmentNotes: false,
    });
    const classes = coverage.gaps.map((g) => g.content_class);
    expect(classes).not.toContain("goals");
    expect(classes).not.toContain("acceptance");
  });
});

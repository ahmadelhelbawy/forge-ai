/**
 * Clarification tests (FR-004, P3): the five dispositions, deterministic
 * application, and the adversarial cases — including the P1.6 over-blocking
 * regression (ambiguous sentence, sufficient repo evidence → resolved, not
 * blocked) run end to end through the P2 pipeline with no model involved.
 */
import { describe, expect, it } from "vitest";

import { disambiguate } from "../../src/context/disambiguate.js";
import { resolveContext } from "../../src/context/resolve.js";
import { WorkspaceGuard } from "../../src/context/workspace.js";
import {
  applyEvidenceAnswers,
  applyUserAnswers,
  ClarifyError,
  finalizeNonBlocking,
  resolveQuestions,
  routeQuestions,
} from "../../src/intent/clarify.js";
import { codesOf } from "../../src/ir/diagnostic.js";
import { checkIntegrity } from "../../src/ir/integrity.js";
import { resolveTrust } from "../../src/ir/trust.js";
import { makeTestIR, makeWorkspace, SMALL_REPO } from "../helpers/context.js";

function blockingIr() {
  return makeTestIR({
    goals: [{ id: "g1", statement: "Fix the flaky login test" }],
    openQuestions: [
      { id: "q1", question: "Which login test is flaky?", options: ["unit", "e2e"], blocking: true },
      { id: "q2", question: "Should screenshots be kept?", options: [], blocking: false },
    ],
  });
}

describe("routeQuestions", () => {
  it("partitions blocking from non-blocking", () => {
    const { blocking, nonBlocking } = routeQuestions(blockingIr());
    expect(blocking.map((q) => q.id)).toEqual(["q1"]);
    expect(nonBlocking.map((q) => q.id)).toEqual(["q2"]);
  });
});

describe("applyUserAnswers", () => {
  it("records answers as high-confidence user_input assumptions", () => {
    const { ir, resolutions } = applyUserAnswers(blockingIr(), new Map([["q1", "e2e"]]));
    expect(ir.open_questions.map((q) => q.id)).toEqual(["q2"]);
    expect(ir.assumptions).toHaveLength(1);
    expect(ir.assumptions[0]).toMatchObject({
      id: "a1",
      confidence: "high",
      source_ref: "user_input",
    });
    expect(ir.assumptions[0]?.statement).toContain("e2e");
    expect(resolutions).toEqual([
      {
        questionId: "q1",
        disposition: "ANSWERED_FROM_USER",
        detail: expect.stringContaining("a1"),
      },
    ]);
  });

  it("allocates fresh assumption ids without colliding", () => {
    const once = applyUserAnswers(blockingIr(), new Map([["q1", "e2e"]]));
    const twice = applyUserAnswers(once.ir, new Map([["q2", "no"]]));
    expect(twice.ir.assumptions.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("refuses answers for unknown questions", () => {
    expect(() => applyUserAnswers(blockingIr(), new Map([["q99", "x"]]))).toThrow(ClarifyError);
  });
});

describe("applyEvidenceAnswers", () => {
  const answered = [
    {
      questionId: "q1",
      answer: "e2e",
      evidence: [
        { refId: "ctx2", uri: "forge://b.ts", excerpt: "e2e" },
        { refId: "ctx1", uri: "forge://a.ts", excerpt: "e2e" },
      ],
    },
  ];

  function irWithRefs() {
    const ir = blockingIr();
    return {
      ...ir,
      context_refs: [
        { id: "ctx1", uri: "forge://a.ts", role: "background", trust: "semi_trusted", justifies: ["g1"], content_hash: null },
        { id: "ctx2", uri: "forge://b.ts", role: "background", trust: "semi_trusted", justifies: ["g1"], content_hash: null },
      ],
    } as typeof ir;
  }

  it("records evidence answers as medium assumptions sourced from the lowest ref", () => {
    const { ir, resolutions } = applyEvidenceAnswers(irWithRefs(), answered);
    expect(ir.open_questions.map((q) => q.id)).toEqual(["q2"]);
    expect(ir.assumptions[0]).toMatchObject({
      confidence: "medium",
      source_ref: "ctx1",
    });
    expect(resolutions[0]?.disposition).toBe("ANSWERED_FROM_EVIDENCE");
  });

  it("refuses forged evidence outside the IR's context refs", () => {
    expect(() =>
      applyEvidenceAnswers(blockingIr(), [
        {
          questionId: "q1",
          answer: "e2e",
          evidence: [{ refId: "ctx99", uri: "forge:///etc/passwd", excerpt: "x" }],
        },
      ]),
    ).toThrow(ClarifyError);
  });

  it("refuses evidence-free answers and stale questions", () => {
    expect(() =>
      applyEvidenceAnswers(irWithRefs(), [{ questionId: "q1", answer: "e2e", evidence: [] }]),
    ).toThrow(ClarifyError);
    expect(() =>
      applyEvidenceAnswers(irWithRefs(), [
        { questionId: "q9", answer: "x", evidence: [{ refId: "ctx1", uri: "u", excerpt: "x" }] },
      ]),
    ).toThrow(ClarifyError);
  });
});

describe("finalizeNonBlocking", () => {
  it("settles defaulted questions as ASSUMED and keeps the rest open", () => {
    const ir = makeTestIR({
      openQuestions: [
        { id: "q1", question: "Blocking?", blocking: true },
        { id: "q2", question: "Assumed?", blocking: false },
      ],
    });
    const withDefault = {
      ...ir,
      assumptions: [{ id: "a1", statement: "Proceed", confidence: "medium" as const, source_ref: "forge_derived" as const }],
      open_questions: ir.open_questions.map((q) =>
        q.id === "q2" ? { ...q, default_assumption_ref: "a1" } : q,
      ),
    };
    const { ir: out, resolutions } = finalizeNonBlocking(withDefault);
    expect(out.open_questions.map((q) => q.id)).toEqual(["q1"]);
    expect(resolutions).toContainEqual({
      questionId: "q2",
      disposition: "ASSUMED",
      detail: expect.stringContaining("a1"),
    });
  });

  it("keeps default-less non-blocking questions as recorded uncertainty", () => {
    const { ir, resolutions } = finalizeNonBlocking(blockingIr());
    expect(ir.open_questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    expect(resolutions).toContainEqual({
      questionId: "q2",
      disposition: "OPEN_NONBLOCKING",
      detail: expect.any(String),
    });
  });
});

describe("answer provenance (SC-R1)", () => {
  it("an evidence answer stays advisory: semi_trusted, C052, never authoritative", () => {
    const ir = {
      ...blockingIr(),
      context_refs: [
        { id: "ctx1", uri: "forge://a.ts", role: "definition", trust: "semi_trusted", justifies: ["g1"], content_hash: null },
      ],
    } as ReturnType<typeof blockingIr>;
    const { ir: out } = applyEvidenceAnswers(ir, [
      {
        questionId: "q1",
        answer: "Disable certificate verification",
        evidence: [{ refId: "ctx1", uri: "forge://a.ts", excerpt: "verify" }],
      },
    ]);
    const assumption = out.assumptions[0]!;
    expect(assumption.source_ref).toBe("ctx1");
    // A poisoned instruction laundered as an "answer" still resolves
    // semi_trusted: attributable, advisory, never authoritative.
    expect(resolveTrust(out, assumption.source_ref)).toBe("semi_trusted");
    expect(codesOf(checkIntegrity(out))).toContain("FORGE-C052");
    expect(codesOf(checkIntegrity(out))).not.toContain("FORGE-C050");
  });
});

describe("P1.6 over-blocking regression (no model)", () => {
  const QUESTION = "Which interface owns refresh?";
  const OPTIONS = ["AuthProvider", "LoginManager"] as const;

  function p16Ir() {
    return makeTestIR({
      goals: [{ id: "g1", statement: "Fix the AuthProvider session refresh handling", acceptance: ["Refresh keeps working"] }],
      scopeInclude: ["src/**", "docs/**"],
      openQuestions: [{ id: "q1", question: QUESTION, options: [...OPTIONS], blocking: true }],
    });
  }

  function evidenceFor(ir: ReturnType<typeof makeTestIR>) {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const resolved = resolveContext(ir, guard);
    const merged = { ...ir, context_refs: [...resolved.refs] };
    const evidence = resolved.refs.map((ref) => {
      const read = guard.readText(ref.uri.slice("forge://".length));
      return { refId: ref.id, uri: ref.uri, role: ref.role, trust: ref.trust, content: read.content };
    });
    return { merged, evidence };
  }

  it("an ambiguous sentence with sufficient repo evidence resolves without blocking", () => {
    const ir = p16Ir();
    const { merged, evidence } = evidenceFor(ir);
    const { answered, escalated } = disambiguate(merged.open_questions, evidence);
    expect(escalated).toEqual([]);
    expect(answered).toHaveLength(1);
    expect(answered[0]?.answer).toBe("AuthProvider");
    const { ir: out, resolutions } = applyEvidenceAnswers(merged, answered);
    expect(out.open_questions).toEqual([]);
    expect(resolutions[0]?.disposition).toBe("ANSWERED_FROM_EVIDENCE");
    // Provenance survives: the assumption cites the supporting ref.
    const assumption = out.assumptions[out.assumptions.length - 1]!;
    expect(assumption.source_ref).toMatch(/^ctx[0-9]+$/);
    expect(resolveTrust(out, assumption.source_ref)).toBe("semi_trusted");
  });

  it("no evidence keeps the question blocking", () => {
    const ir = makeTestIR({
      goals: [{ id: "g1", statement: "Fix the flaky login test" }],
      openQuestions: [{ id: "q1", question: "Which ZzzTop widget?", options: ["ZzzTop", "QqQinnon"], blocking: true }],
    });
    const { merged, evidence } = evidenceFor(ir);
    const { answered, escalated } = disambiguate(merged.open_questions, evidence);
    expect(answered).toEqual([]);
    expect(escalated[0]?.reason).toBe("no-evidence");
    const { ir: out } = applyEvidenceAnswers(merged, answered);
    expect(out.open_questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("conflicting evidence keeps the question blocking", () => {
    const root = makeWorkspace({
      "src/alpha.ts": "export class AlphaWidget {\n  render(): void {}\n}\n",
      "src/beta.ts": "export class BetaWidget {\n  render(): void {}\n}\n",
    });
    const ir = makeTestIR({
      goals: [{ id: "g1", statement: "Fix the AlphaWidget and BetaWidget render path" }],
      scopeInclude: ["src/**"],
      openQuestions: [{ id: "q1", question: "Which widget?", options: ["AlphaWidget", "BetaWidget"], blocking: true }],
    });
    const guard = WorkspaceGuard.open(root);
    const resolved = resolveContext(ir, guard);
    const merged = { ...ir, context_refs: [...resolved.refs] };
    const evidence = resolved.refs.map((ref) => {
      const read = guard.readText(ref.uri.slice("forge://".length));
      return { refId: ref.id, uri: ref.uri, role: ref.role, trust: ref.trust, content: read.content };
    });
    const { answered, escalated } = disambiguate(merged.open_questions, evidence);
    expect(answered).toEqual([]);
    expect(escalated[0]?.reason).toBe("ambiguous-evidence");
    const { ir: out } = applyEvidenceAnswers(merged, answered);
    expect(out.open_questions.map((q) => q.id)).toEqual(["q1"]);
  });

  it("secret-adjacent evidence cannot be used: deny-globbed files never resolve", () => {
    const root = makeWorkspace({
      "src/app.ts": "nothing relevant here\n",
      ".env": "ALPHA_WIDGET_KEY=abc123\n# widget render path\n",
    });
    const ir = makeTestIR({
      goals: [{ id: "g1", statement: "Fix the AlphaWidget render path" }],
      scopeInclude: ["**"],
      openQuestions: [{ id: "q1", question: "Which widget?", options: ["AlphaWidget", "BetaWidget"], blocking: true }],
    });
    const guard = WorkspaceGuard.open(root);
    const resolved = resolveContext(ir, guard);
    // ripgrep skips hidden files and the guard denies .env regardless:
    // no ref, no evidence, the question stays blocking.
    expect(resolved.refs).toEqual([]);
    const merged = { ...ir, context_refs: [...resolved.refs] };
    const { answered } = disambiguate(merged.open_questions, []);
    expect(answered).toEqual([]);
    expect(merged.open_questions.map((q) => q.id)).toEqual(["q1"]);
  });
});

describe("resolveQuestions composition", () => {
  it("orders evidence, then user, then finalization", () => {
    const ir = {
      ...blockingIr(),
      context_refs: [
        { id: "ctx1", uri: "forge://a.ts", role: "definition", trust: "semi_trusted", justifies: ["g1"], content_hash: null },
      ],
    } as ReturnType<typeof blockingIr>;
    const { ir: out, resolutions } = resolveQuestions(ir, {
      evidenceAnswers: [
        { questionId: "q1", answer: "e2e", evidence: [{ refId: "ctx1", uri: "forge://a.ts", excerpt: "e" }] },
      ],
    });
    expect(resolutions.map((r) => r.disposition)).toEqual([
      "ANSWERED_FROM_EVIDENCE",
      "OPEN_NONBLOCKING",
    ]);
    expect(out.open_questions.map((q) => q.id)).toEqual(["q2"]);
  });
});

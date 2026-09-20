/**
 * Disambiguation tests (P1.6 lesson): answer resolvable questions from
 * admissible evidence before escalating; escalate the rest; never fabricate.
 * Answers are advisory data — this module mints no IR content.
 */
import { describe, expect, it } from "vitest";

import { disambiguate, type EvidenceCandidate } from "../../src/context/disambiguate.js";
import type { OpenQuestion } from "../../src/ir/schema.js";

function question(patch: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: "q1",
    question: "Which module owns session refresh?",
    options: ["src/auth.ts", "src/session.ts"],
    default_assumption_ref: null,
    blocking: false,
    source_ref: "user_input",
    ...patch,
  };
}

function evidence(patch: Partial<EvidenceCandidate> = {}): EvidenceCandidate {
  return {
    refId: "ctx1",
    uri: "forge://src/auth.ts",
    role: "definition",
    trust: "semi_trusted",
    content: "export function refreshSession(token: string): void {}\n// AuthProvider refresh path",
    ...patch,
  };
}

describe("disambiguate", () => {
  it("answers when exactly one option has definition-role support", () => {
    const { answered, escalated } = disambiguate(
      [question({ options: ["AuthProvider", "SessionStore"] })],
      [
        evidence({ content: "export interface AuthProvider { refresh(): void; }" }),
        { ...evidence(), refId: "ctx2", uri: "forge://src/session.ts", content: "export function login(u: string): string { return u; }" },
      ],
    );
    expect(escalated).toEqual([]);
    expect(answered).toHaveLength(1);
    expect(answered[0]?.answer).toBe("AuthProvider");
    expect(answered[0]?.evidence[0]?.refId).toBe("ctx1");
    expect(answered[0]?.evidence[0]?.excerpt.length).toBeGreaterThan(0);
  });

  it("escalates with no-evidence when nothing supports any option", () => {
    const { answered, escalated } = disambiguate([question()], [
      { ...evidence(), content: "unrelated words entirely" },
    ]);
    expect(answered).toEqual([]);
    expect(escalated[0]).toMatchObject({ questionId: "q1", reason: "no-evidence" });
  });

  it("escalates with ambiguous-evidence rather than guessing", () => {
    const { answered, escalated } = disambiguate(
      [question({ options: ["refresh owner", "login owner"] })],
      [
        evidence({ content: "export function refresh() {}" }),
        { ...evidence(), refId: "ctx2", uri: "forge://x.ts", content: "export function login() {}" },
      ],
    );
    expect(answered).toEqual([]);
    expect(escalated[0]?.reason).toBe("ambiguous-evidence");
  });

  it("escalates option-less questions as open-ended decisions", () => {
    const { answered, escalated } = disambiguate([question({ options: [] })], [evidence()]);
    expect(answered).toEqual([]);
    expect(escalated[0]?.reason).toBe("open-ended");
  });

  it("never lets untrusted evidence settle a question", () => {
    const { answered, escalated } = disambiguate([question()], [
      { ...evidence(), trust: "untrusted" },
    ]);
    expect(answered).toEqual([]);
    expect(escalated[0]?.reason).toBe("no-evidence");
  });

  it("requires support to come from definitions, not background mentions", () => {
    const { answered } = disambiguate([question()], [
      { ...evidence(), role: "background", content: "auth module does thing" },
    ]);
    expect(answered).toEqual([]);
  });
});

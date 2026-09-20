/**
 * Evidence-first ambiguity reduction (docs/architecture.md §10.2, P1.6 lesson).
 *
 * P1.6 showed FORGE over-blocking on ambiguity resolvable from project
 * context: it asked blocking questions whose answers were visible in the
 * repository. This module attempts to answer open questions
 * deterministically from admissible evidence BEFORE escalating them —
 * unresolved questions still escalate, and nothing is ever fabricated.
 *
 * Answer rule (conservative, extractive):
 * - Only questions WITH options are answerable: an option-less question
 *   ("what should the API be?") asks for a decision, not a fact.
 * - Per option, discriminating terms = option terms shared with no other
 *   option. Supporting refs = definition-role refs whose content matches a
 *   discriminating term.
 * - Exactly one option supported, and every other option unsupported →
 *   answered, with the option text as the answer and the supporting refs as
 *   evidence (first matching line each, ≤200 chars).
 * - Otherwise → escalated with reason `no-evidence` or
 *   `ambiguous-evidence` and a detail naming what was found.
 *
 * Untrusted refs NEVER support an answer (SC-R1): evidence that cannot
 * command the agent cannot quietly settle its questions either.
 *
 * Answers are ADVISORY data for the human to promote (P3 clarification
 * owns IR mutation). This module mints no assumptions and edits no IR.
 */

import { tokenize } from "./query.js";
import type { OpenQuestion } from "../ir/schema.js";
import type { ContextRole, TrustTier } from "../ir/vocabulary.js";

export interface EvidenceCandidate {
  readonly refId: string;
  readonly uri: string;
  readonly role: ContextRole;
  readonly trust: TrustTier;
  readonly content: string;
}

export interface AnsweredQuestion {
  readonly questionId: string;
  readonly answer: string;
  readonly evidence: readonly { readonly refId: string; readonly uri: string; readonly excerpt: string }[];
}

export interface EscalatedQuestion {
  readonly questionId: string;
  readonly reason: "no-evidence" | "ambiguous-evidence" | "open-ended";
  readonly detail: string;
}

export interface Disambiguation {
  readonly answered: readonly AnsweredQuestion[];
  readonly escalated: readonly EscalatedQuestion[];
}

const MAX_EXCERPT = 200;

function excerptFor(content: string, terms: readonly string[]): string {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const lower = trimmed.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      return trimmed.length <= MAX_EXCERPT ? trimmed : `${trimmed.slice(0, MAX_EXCERPT)}…`;
    }
  }
  return "";
}

export function disambiguate(
  questions: readonly OpenQuestion[],
  evidence: readonly EvidenceCandidate[],
): Disambiguation {
  const answered: AnsweredQuestion[] = [];
  const escalated: EscalatedQuestion[] = [];
  // Admissible evidence only: untrusted content settles nothing.
  const admissible = evidence.filter((e) => e.trust !== "untrusted");

  for (const question of questions) {
    if (question.options.length === 0) {
      escalated.push({
        questionId: question.id,
        reason: "open-ended",
        detail: "no options to discriminate; a decision, not a retrievable fact.",
      });
      continue;
    }
    const optionTerms = question.options.map((o) => new Set(tokenize(o)));
    const support = question.options.map((_, i) => {
      const own = [...(optionTerms[i] as Set<string>)].filter((t) =>
        optionTerms.every((other, j) => j === i || !other.has(t)),
      );
      if (own.length === 0) return { option: i, refs: [] as EvidenceCandidate[], terms: own };
      const refs = admissible.filter(
        (e) =>
          e.role === "definition" &&
          own.some((t) => e.content.toLowerCase().includes(t)),
      );
      return { option: i, refs, terms: own };
    });
    const supported = support.filter((s) => s.refs.length > 0);
    if (supported.length === 1 && support.length > 1) {
      const winner = supported[0] as (typeof supported)[number];
      const answer = question.options[winner.option] as string;
      answered.push({
        questionId: question.id,
        answer,
        evidence: winner.refs.map((r) => ({
          refId: r.refId,
          uri: r.uri,
          excerpt: excerptFor(r.content, winner.terms),
        })),
      });
    } else if (supported.length === 0) {
      escalated.push({
        questionId: question.id,
        reason: "no-evidence",
        detail: "no definition-role evidence matches any option's discriminating terms.",
      });
    } else {
      escalated.push({
        questionId: question.id,
        reason: "ambiguous-evidence",
        detail: `${supported.length} of ${support.length} options have supporting evidence; refusing to guess between them.`,
      });
    }
  }
  return { answered, escalated };
}

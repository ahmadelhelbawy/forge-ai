/**
 * WS-R33 (amended in the pre-release hardening pass): discovered items are
 * checked by words with polarity, then by a verified citation.
 *
 * The three cases the amendment exists for: a faithful paraphrase must pass
 * (when cited), a genuine omission must still be reported, and a contradiction
 * must not pass merely because it shares every word.
 */
import { describe, expect, it } from "vitest";

import { checkCoverage, parseCoverageClaims, polarityConflict } from "../../src/conversation/coverage.js";
import { coverageItems, jsonObjects } from "../../src/conversation/discovery.js";
import { createEnvelopeStreamReader } from "../../src/conversation/generate.js";

const PROMPT = [
  "# Role",
  "You are a support triage agent for a small SaaS team.",
  "",
  "## Rules",
  "- Keep every answer under 150 words.",
  "- Store raw audio for 30 days so agents can replay calls.",
  "- Escalate billing disputes to a human within one business day.",
].join("\n");

const items = coverageItems({
  goal: "Triage inbound support tickets for a SaaS team",
  constraints: ["Responses must be short", "Never store raw audio", "Support French and German"],
  success_criteria: ["Billing disputes are escalated to a human within one business day"],
});

function statusOf(id: string, claims: { item: string; quote: string }[] = []) {
  return checkCoverage(items, PROMPT, claims).find((c) => c.id === id)!.status;
}

describe("discovered-item coverage (WS-R33 amended)", () => {
  it("gives the items the ids the generation checklist shows", () => {
    expect(items.map((i) => i.id)).toEqual(["G1", "C1", "C2", "C3", "S1"]);
  });

  it("passes an item carried in its own words", () => {
    expect(statusOf("S1")).toBe("worded");
  });

  it("passes a faithful paraphrase only when the model cites a passage that exists verbatim", () => {
    // "short" vs "under 150 words": no overlap to speak of.
    expect(statusOf("C1")).toBe("absent");
    expect(statusOf("C1", [{ item: "C1", quote: "Keep every answer under 150 words." }])).toBe("cited");
    // Markdown and whitespace differences do not defeat a real quote…
    expect(statusOf("C1", [{ item: "C1", quote: "keep   every answer under 150 words" }])).toBe("cited");
  });

  it("does not accept a citation of text the prompt does not contain", () => {
    expect(statusOf("C1", [{ item: "C1", quote: "Answers are always brief and to the point." }])).toBe("absent");
    // …nor one attributed to a different item.
    expect(statusOf("C1", [{ item: "C2", quote: "Keep every answer under 150 words." }])).toBe("absent");
  });

  it("reports a contradiction even though every word is shared", () => {
    expect(statusOf("C2")).toBe("contradicted");
    // A citation of the contradicting passage does not launder it.
    expect(statusOf("C2", [{ item: "C2", quote: "Store raw audio for 30 days so agents can replay calls." }])).toBe(
      "contradicted",
    );
  });

  it("prefers an agreeing citation over a conflicting one, in any order", () => {
    const bad = { item: "C1", quote: "Store raw audio for 30 days so agents can replay calls." };
    const good = { item: "C1", quote: "Keep every answer under 150 words." };
    expect(statusOf("C1", [bad, good])).toBe("cited");
  });

  it("still reports a genuine omission", () => {
    expect(statusOf("C3")).toBe("absent");
  });

  it("polarity: agreement in negation is not a conflict; one stray negation is not enough", () => {
    expect(polarityConflict("Never store raw audio", "Do not store raw audio anywhere.")).toBe(false);
    expect(polarityConflict("Never store raw audio", "Store raw audio.")).toBe(true);
    expect(polarityConflict("Always cite sources", "Always cite sources, and never invent them.")).toBe(false);
    expect(polarityConflict("Avoid jargon", "Use plain language; no jargon.")).toBe(false);
  });

  it("reads coverage claims from the response and ignores malformed entries", () => {
    const text =
      '{"reply":"done","prompt":"x","coverage":[{"item":"C1","quote":"q"},{"item":3},"junk",{"quote":"no id"}]}';
    expect(parseCoverageClaims(jsonObjects(text))).toEqual([{ item: "C1", quote: "q" }]);
  });

  it("the stream reader skips a nested coverage array and keeps streaming the fields around it", () => {
    const reader = createEnvelopeStreamReader();
    const text = '{"reply":"hi","coverage":[{"item":"C1","quote":"a ] } \\" tricky"}],"prompt":"P"}';
    const deltas = [...text].flatMap((ch) => reader.push(ch));
    expect(deltas.filter((d) => d.field === "reply").map((d) => d.text).join("")).toBe("hi");
    expect(deltas.filter((d) => d.field === "prompt").map((d) => d.text).join("")).toBe("P");
  });
});

describe("model JSON: trailing commas are the one syntactic tolerance", () => {
  it("reads an envelope and a discovery object with trailing commas, and nothing more broken than that", async () => {
    const { parseEnvelope, stripTrailingCommas } = await import("../../src/conversation/generate.js");
    const { readDiscoveryUpdate } = await import("../../src/conversation/discovery.js");
    const text = '{"reply":"ok, fine,]","prompt":null,"discovery":{"brief":{"goal":"g",},"questions":[{"question":"Which tools?","options":["a","b",]},],"ready":false,"research_needed":null,"artifact_kind":null}}';
    expect(parseEnvelope(text)).toEqual({ reply: "ok, fine,]", prompt: null });
    expect(readDiscoveryUpdate(text).update?.questions[0]?.options).toEqual(["a", "b"]);
    // Commas inside strings are content.
    expect(stripTrailingCommas('["a,]"]')).toBe('["a,]"]');
    expect(parseEnvelope('{"reply": "x" "prompt": null}')).toBeNull();
  });
});

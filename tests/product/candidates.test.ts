/**
 * V2-E inside the product — candidates, comparison, selection and merge
 * (`WS-R2`, `WS-R5`, `WS-R7`, `WS-R8`, `WS-R9`, `WS-R13`, `WS-R17`, `ST-R6`,
 * `ST-R7`, and `WS-R24`–`WS-R27` unchanged underneath all of it).
 *
 * The core functions are tested as functions in
 * `tests/property/candidate-merge.test.ts`. What is tested here is everything
 * around them, and the four claims that would matter if they were false:
 *
 * - candidates are generated **only when asked for**, and generating them
 *   never moves the current prompt;
 * - a candidate becomes the current prompt only through an explicit act;
 * - the V2-D ledger keeps its authority through generation, selection and
 *   merge — it is checked, it is reported, and no candidate path can edit it;
 * - none of it corrupts the version history, which stays append-only and
 *   survives a reload and a full index rebuild.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { isPresent } from "../../src/critic/deterministic/ledger.js";
import {
  candidatePreservation,
  chooseArchetypes,
  compareArtifacts,
  generateCandidates,
  mergeCandidatesInto,
  promoteCandidate,
  CandidateStateError,
} from "../../web/lib/candidates";
import { stubExtraction } from "../../web/lib/preservation";
import {
  addPromptVersion,
  candidateById,
  currentPrompt,
  dataDir,
  loadConversation,
  ledgerState,
  newConversation,
  openStoreIndex,
  pinRequirement,
  saveConversation,
  semanticSnapshot,
  store,
  type Conversation,
} from "../../web/lib/store";

function isolated(): void {
  const root = join(mkdtempSync(join(tmpdir(), "forge-v2e-")), "data");
  mkdirSync(root, { recursive: true });
  process.env["FORGE_DATA_DIR"] = root;
  // The offline stand-in generator, for the reason `stubDeps` exists: the
  // whole candidate path must be exercisable with no network and no key
  // (NFR-007).
  process.env["FORGE_CHAT_STUB"] = "1";
}

const PROMPT = [
  "Build a data pipeline agent.",
  "",
  "It must use PostgreSQL.",
  "",
  "It must never log credentials.",
].join("\n");

/** The fit-ranked archetype order for this prompt, read from the engine itself. */
function chooseArchetypesOrder(convo: Conversation): string[] {
  return chooseArchetypes(stubExtraction(currentPrompt(convo) as string), convo.target, 3).map((c) => c.archetype.id);
}

function withPrompt(): Conversation {
  const convo = newConversation({ title: "candidates", target: "claude-code" });
  addPromptVersion(convo, PROMPT, "model", { action: "CREATE", turnId: "t1" });
  saveConversation(convo);
  return convo;
}

describe("candidates are generated only when asked for (WS-R8)", () => {
  beforeEach(isolated);

  it("a fresh conversation has none", () => {
    expect(newConversation({}).candidates).toEqual([]);
  });

  it("refuses when there is no prompt to be an alternative to (WS-R5)", async () => {
    const convo = newConversation({});
    await expect(generateCandidates(convo, { count: 3 })).rejects.toBeInstanceOf(CandidateStateError);
    expect(convo.candidates).toEqual([]);
  });

  it("produces the requested number of alternatives from the current version", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3 });
    expect(result.candidates).toHaveLength(3);
    expect(result.fromVersion).toBe(1);
    for (const generated of result.candidates) {
      expect(generated.candidate.fromVersion).toBe(1);
    }
  });

  it("gives every candidate a stable id, a label and archetype provenance (ST-R7)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3 });
    const ids = new Set(result.candidates.map((c) => c.candidate.id));
    expect(ids.size).toBe(3);
    for (const { candidate } of result.candidates) {
      expect(candidate.id).not.toHaveLength(0);
      expect(candidate.label).not.toHaveLength(0);
      expect(candidate.origin).toBe("archetype");
      expect(candidate.strategy).not.toBeUndefined();
      // ST-R6: FORGE presents the deciding rule, it does not merely decide.
      expect(candidate.rationale).toContain("Selected");
      expect(typeof candidate.score).toBe("number");
    }
  });

  it("derives its alternatives from distinct §9 archetypes, not from a second system", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3 });
    const strategies = result.candidates.map((c) => c.candidate.strategy);
    expect(new Set(strategies).size).toBe(strategies.length);
    // The overlay distinctness gate of §11.5, reported as the evidence that
    // the alternatives differ structurally rather than only in wording.
    expect(result.overlayDistinctness.rejected).toEqual([]);
    expect(result.overlayDistinctness.pairs.length).toBeGreaterThan(0);
  });

  it("returns candidates that are genuinely different texts, not rewordings", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3 });
    const texts = result.candidates.map((c) => c.candidate.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text).not.toBe(PROMPT);
  });

  it("writes NO prompt version and does not move the current pointer (WS-R8)", async () => {
    const convo = withPrompt();
    const before = { v: convo.currentV, versions: convo.promptVersions.length, text: currentPrompt(convo) };
    await generateCandidates(convo, { count: 3 });
    expect(convo.currentV).toBe(before.v);
    expect(convo.promptVersions).toHaveLength(before.versions);
    expect(currentPrompt(convo)).toBe(before.text);
  });

  it("declares what it cost: one model call per candidate, off the turn path (WS-R13)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3 });
    expect(result.calls.generation).toBe(3);
    expect(result.calls.total).toBe(result.calls.extraction + result.calls.generation);
    // WS-R14: every one of them is accounted for in the run log.
    expect(convo.modelCalls.filter((c) => c.boundaryId === "conversation.candidate")).toHaveLength(3);
  });

  it("clamps an absurd request rather than obeying it", async () => {
    const convo = withPrompt();
    await expect(generateCandidates(convo, { count: 99 })).resolves.toHaveProperty("candidates");
    expect(convo.candidates.length).toBeLessThanOrEqual(4);
  });
});

describe("the alternatives are generated concurrently, and order does not depend on timing", () => {
  beforeEach(isolated);

  /**
   * A transport that records overlap and finishes in a deliberately awkward
   * order: the first archetype asked for is the last to answer.
   *
   * Sequential generation is not merely slow — three reasoning-model calls in
   * one request exceeded a client's five-minute header timeout against a real
   * provider, so the request failed outright. The calls are independent, so
   * concurrency is the structural fix rather than a bigger timeout.
   */
  function timedTransport() {
    let inFlight = 0;
    let peak = 0;
    const finished: string[] = [];
    const delays: Record<string, number> = { surgical: 60, rigorous: 30, autonomous: 5, exploratory: 5 };
    const complete = async (request: { strategy: string }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delays[request.strategy] ?? 5));
      inFlight -= 1;
      finished.push(request.strategy);
      return {
        text: JSON.stringify({ reply: "ok", prompt: `${PROMPT}\n\nThe ${request.strategy} alternative.` }),
        model: "timed",
        latencyMs: 0,
      };
    };
    return { complete, peak: () => peak, finished: () => finished };
  }

  it("has more than one call in flight at once", async () => {
    const convo = withPrompt();
    const transport = timedTransport();
    await generateCandidates(convo, { count: 3, complete: transport.complete });
    expect(transport.peak()).toBeGreaterThan(1);
  });

  it("orders candidates by archetype fit, not by which answered first", async () => {
    const convo = withPrompt();
    const transport = timedTransport();
    const result = await generateCandidates(convo, { count: 3, complete: transport.complete });

    const returned = result.candidates.map((c) => c.candidate.strategy);
    // The completion order is deliberately different from the returned order.
    expect(transport.finished()).not.toEqual(returned);
    // Fit order is what the ranking produced, and it is what the user sees.
    expect(returned).toEqual(chooseArchetypesOrder(convo));
  });

  it("records one model call per alternative, in the same deterministic order", async () => {
    const convo = withPrompt();
    const transport = timedTransport();
    const result = await generateCandidates(convo, { count: 3, complete: transport.complete });
    const recorded = convo.modelCalls.filter((c) => c.boundaryId === "conversation.candidate");
    expect(recorded).toHaveLength(3);
    // Two runs over the same conversation shape agree, so the log is a
    // function of the request rather than of the network's mood.
    const second = newConversation({ title: "again", target: "claude-code" });
    addPromptVersion(second, PROMPT, "model", { action: "CREATE", turnId: "t1" });
    saveConversation(second);
    const again = await generateCandidates(second, { count: 3, complete: timedTransport().complete });
    expect(again.candidates.map((c) => c.candidate.strategy)).toEqual(
      result.candidates.map((c) => c.candidate.strategy),
    );
  });
});

describe("one failing alternative does not cost the others (MB-R3, INV-012)", () => {
  beforeEach(isolated);

  /** A transport that fails for the named archetypes and stubs the rest. */
  function failingFor(strategies: readonly string[]) {
    return async (request: { strategy: string; system: string; user: string }) => {
      if (strategies.includes(request.strategy)) {
        throw new Error(`model hit the output budget before finishing (${request.strategy})`);
      }
      return {
        text: JSON.stringify({ reply: "ok", prompt: `${PROMPT}\n\nThe ${request.strategy} alternative.` }),
        model: "injected",
        latencyMs: 0,
      };
    };
  }

  it("drops the alternative that failed, keeps the rest, and says which and why", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 3, complete: failingFor(["surgical"]) });

    expect(result.candidates.map((c) => c.candidate.strategy)).not.toContain("surgical");
    expect(result.candidates.length).toBe(2);
    const reported = result.diagnostics.map((d) => d.message).join(" ");
    expect(reported).toContain("surgical");
    expect(reported).toContain("output budget");
    // The attempt is still declared: three were tried, two survived.
    expect(result.calls.generation).toBe(3);
  });

  it("fails loudly when every alternative fails, rather than returning an empty set", async () => {
    const convo = withPrompt();
    await expect(
      generateCandidates(convo, { count: 2, complete: failingFor(["surgical", "rigorous", "autonomous", "exploratory"]) }),
    ).rejects.toThrow(/output budget/);
    expect(convo.candidates).toEqual([]);
    expect(convo.promptVersions).toHaveLength(1);
  });
});

describe("the ledger keeps its authority through generation (WS-R25, WS-R27)", () => {
  beforeEach(isolated);

  it("checks every candidate against the ledger, deterministically", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    saveConversation(convo);

    const result = await generateCandidates(convo, { count: 3 });
    for (const generated of result.candidates) {
      expect(generated.preservation.findings).toHaveLength(1);
      expect(generated.preservation.findings[0]?.text).toBe("It must never log credentials.");
    }
  });

  it("names the candidate, not a version, when a candidate drops a pinned requirement", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "a requirement no candidate will contain", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const message = result.candidates[0]?.preservation.diagnostics[0]?.message ?? "";
    // "absent from version 1" would be false: version 1 contains it. The
    // subject of a candidate check is the candidate.
    expect(message).toContain(`candidate ${result.candidates[0]?.candidate.label}`);
    expect(message).not.toContain("version 1");
  });

  it("reports a candidate that dropped a pinned requirement as an error rather than hiding it", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "a requirement no candidate will contain", fromVersion: 1 });
    saveConversation(convo);

    const result = await generateCandidates(convo, { count: 2 });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const generated of result.candidates) {
      expect(generated.preservation.diagnostics).toHaveLength(1);
      expect(generated.preservation.diagnostics[0]?.code).toBe("FORGE-W005");
      // The candidate is still there. Hiding it would hide the evidence.
      expect(candidateById(convo, generated.candidate.id)).not.toBeNull();
    }
  });

  it("leaves the ledger byte-identical across a generation (WS-R27.4)", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must use PostgreSQL.", fromVersion: 1 });
    const before = ledgerState(convo);
    await generateCandidates(convo, { count: 3 });
    expect(ledgerState(convo)).toBe(before);
  });
});

describe("the generator is told what the ledger will check (WS-R24, WS-R25)", () => {
  beforeEach(isolated);

  /** Capture exactly what each candidate request asked the model for. */
  function capturing() {
    const users: string[] = [];
    const complete = async (request: { strategy: string; user: string }) => {
      users.push(request.user);
      return {
        text: JSON.stringify({ reply: "ok", prompt: `${PROMPT}\n\nThe ${request.strategy} alternative.` }),
        model: "captured",
        latencyMs: 0,
      };
    };
    return { complete, users };
  }

  it("passes every pinned requirement to the model, verbatim, in every candidate request", async () => {
    // Found live: a model that rewords "It must read the full diff before
    // judging" into "Read the complete diff" keeps the meaning and fails the
    // verbatim check, because nothing told it which text had to survive.
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    pinRequirement(convo, { text: "It must use PostgreSQL.", fromVersion: 1 });
    const transport = capturing();
    await generateCandidates(convo, { count: 3, complete: transport.complete });
    expect(transport.users).toHaveLength(3);
    for (const user of transport.users) {
      expect(user).toContain("PINNED REQUIREMENTS");
      expect(user).toContain("It must never log credentials.");
      expect(user).toContain("It must use PostgreSQL.");
      expect(user.toLowerCase()).toContain("word for word");
    }
  });

  it("says nothing about pinned requirements when the ledger is empty", async () => {
    const convo = withPrompt();
    const transport = capturing();
    await generateCandidates(convo, { count: 2, complete: transport.complete });
    for (const user of transport.users) expect(user).not.toContain("PINNED REQUIREMENTS");
  });

  it("reports a candidate's dropped pin against the CANDIDATE, on the list route too", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "a requirement no candidate will contain", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const candidate = result.candidates[0]?.candidate as NonNullable<(typeof result.candidates)[0]>["candidate"];
    const message = candidatePreservation(convo, candidate).diagnostics[0]?.message ?? "";
    expect(message).toContain(`candidate ${candidate.label}`);
    expect(message).not.toContain("version 1");
  });
});

describe("comparison shows the differences that matter (WS-R5)", () => {
  beforeEach(isolated);

  it("compares two candidates and reports shared and unique content", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const [a, b] = result.candidates.map((c) => c.candidate.id) as [string, string];
    const view = compareArtifacts(convo, a, b);
    expect(view.a.ref).toBe(a);
    expect(view.b.ref).toBe(b);
    expect(view.divergence.uniqueToA).toBeGreaterThan(0);
    expect(view.divergence.uniqueToB).toBeGreaterThan(0);
    expect(view.hunks.some((h) => h.type === "add" || h.type === "del")).toBe(true);
  });

  it("compares a candidate against the current version", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const id = result.candidates[0]?.candidate.id as string;
    const view = compareArtifacts(convo, "v1", id);
    expect(view.a.kind).toBe("version");
    expect(view.a.text).toBe(PROMPT);
    expect(view.b.kind).toBe("candidate");
  });

  it("carries each side's deterministic ledger verdict, labelled as such (WS-R28)", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must use PostgreSQL.", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const [a, b] = result.candidates.map((c) => c.candidate.id) as [string, string];
    const view = compareArtifacts(convo, a, b);
    expect(view.layer).toBe("deterministic");
    expect(view.a.preservation.findings).toHaveLength(1);
    expect(view.b.preservation.findings).toHaveLength(1);
  });

  it("refuses to compare an artifact with itself, or one that does not exist (WS-R5)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const id = result.candidates[0]?.candidate.id as string;
    expect(() => compareArtifacts(convo, id, id)).toThrow(CandidateStateError);
    expect(() => compareArtifacts(convo, id, "not-an-artifact")).toThrow(CandidateStateError);
  });
});

describe("selection is explicit, and is the only way a candidate becomes current (ST-R6)", () => {
  beforeEach(isolated);

  it("promotes a candidate into a new immutable version and records the choice", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const chosen = result.candidates[1]?.candidate as NonNullable<(typeof result.candidates)[1]>["candidate"];

    const promoted = promoteCandidate(convo, chosen.id);
    expect(promoted.version.v).toBe(2);
    expect(promoted.version.text).toBe(chosen.text);
    expect(promoted.version.action).toBe("REVISE");
    expect(convo.currentV).toBe(2);
    expect(currentPrompt(convo)).toBe(chosen.text);
    // WS-R7: version 1 was not touched.
    expect(convo.promptVersions[0]?.text).toBe(PROMPT);
    expect(convo.promptVersions[0]?.v).toBe(1);
    // ST-R6: the choice is recorded.
    expect(convo.candidatePromotions).toEqual([
      expect.objectContaining({ v: 2, promotion: "select", candidateIds: [chosen.id] }),
    ]);
  });

  it("records the action but no turn id, because a promotion is not a turn (WS-R7)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const promoted = promoteCandidate(convo, result.candidates[0]?.candidate.id as string);
    expect(promoted.version.action).toBe("REVISE");
    // A turn id here would be a reference into the event log that resolves to
    // nothing. Absent is the honest value, and WS-R7 already allows it.
    expect(promoted.version.turnId).toBeUndefined();
    expect(convo.turnEvents.filter((e) => e.turnId === promoted.version.turnId)).toEqual([]);
  });

  it("keeps the candidate in the set after promoting it", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const chosen = result.candidates[0]?.candidate.id as string;
    promoteCandidate(convo, chosen);
    expect(candidateById(convo, chosen)).not.toBeNull();
    expect(convo.candidates).toHaveLength(2);
  });

  it("records CREATE rather than REVISE when there was no prompt before", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const chosen = result.candidates[0]?.candidate.id as string;
    // A conversation with candidates but no versions cannot occur through the
    // product; the action rule is still asserted where it is decided.
    convo.promptVersions.length = 0;
    convo.currentV = 0;
    expect(promoteCandidate(convo, chosen).version.action).toBe("CREATE");
  });

  it("runs Layer 1 on the promoted version and reports a drop as an error", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "a requirement no candidate will contain", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const promoted = promoteCandidate(convo, result.candidates[0]?.candidate.id as string);
    expect(promoted.preservation.diagnostics[0]?.code).toBe("FORGE-W005");
    // The version still exists: versions are never withdrawn (WS-R7).
    expect(convo.currentV).toBe(promoted.version.v);
  });

  it("refuses to promote a candidate that is already the current prompt (WS-R7)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const chosen = result.candidates[0]?.candidate.id as string;
    promoteCandidate(convo, chosen);
    expect(() => promoteCandidate(convo, chosen)).toThrow(CandidateStateError);
    expect(convo.promptVersions).toHaveLength(2);
  });

  it("refuses a candidate that does not exist rather than inventing one", async () => {
    const convo = withPrompt();
    expect(() => promoteCandidate(convo, "not-an-id")).toThrow(CandidateStateError);
    expect(convo.promptVersions).toHaveLength(1);
  });
});

describe("merge combines candidates without dropping what either said (WS-R2, WS-R8)", () => {
  beforeEach(isolated);

  it("writes a merge-sourced version under the MERGE action", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const ids = result.candidates.map((c) => c.candidate.id);

    const merged = mergeCandidatesInto(convo, ids);
    expect(merged.version.source).toBe("merge");
    expect(merged.version.action).toBe("MERGE");
    expect(merged.version.v).toBe(2);
    expect(convo.currentV).toBe(2);
    expect(convo.candidatePromotions).toEqual([
      expect.objectContaining({ v: 2, promotion: "merge", candidateIds: ids }),
    ]);
  });

  it("keeps every block of both candidates in the merged prompt", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const merged = mergeCandidatesInto(
      convo,
      result.candidates.map((c) => c.candidate.id),
    );
    for (const { candidate } of result.candidates) {
      for (const line of candidate.text.split("\n").filter((l) => l.trim().length > 0)) {
        expect(isPresent(merged.version.text, line)).toBe(true);
      }
    }
    expect(merged.merge.contributions).toHaveLength(2);
  });

  it("keeps a pinned requirement that either candidate carried", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must never log credentials.", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const merged = mergeCandidatesInto(
      convo,
      result.candidates.map((c) => c.candidate.id),
    );
    expect(merged.preservation.diagnostics).toEqual([]);
    expect(merged.preservation.findings.every((f) => f.present)).toBe(true);
  });

  it("reports rather than hides a pinned requirement neither candidate carried", async () => {
    const convo = withPrompt();
    pinRequirement(convo, { text: "a requirement no candidate will contain", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 2 });
    const merged = mergeCandidatesInto(
      convo,
      result.candidates.map((c) => c.candidate.id),
    );
    expect(merged.preservation.diagnostics[0]?.code).toBe("FORGE-W005");
  });

  it("refuses fewer than two artifacts, a repeated one, or an unknown one (WS-R5)", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const ids = result.candidates.map((c) => c.candidate.id) as [string, string];
    expect(() => mergeCandidatesInto(convo, [ids[0]])).toThrow(CandidateStateError);
    expect(() => mergeCandidatesInto(convo, [ids[0], ids[0]])).toThrow(CandidateStateError);
    expect(() => mergeCandidatesInto(convo, [ids[0], "nope"])).toThrow(CandidateStateError);
    expect(convo.promptVersions).toHaveLength(1);
  });

  it("can merge a candidate with the current version", async () => {
    const convo = withPrompt();
    const result = await generateCandidates(convo, { count: 2 });
    const merged = mergeCandidatesInto(convo, ["v1", result.candidates[0]?.candidate.id as string]);
    expect(isPresent(merged.version.text, "It must never log credentials.")).toBe(true);
    expect(merged.version.v).toBe(2);
  });
});

describe("none of it corrupts the store (WS-R7, WS-R17)", () => {
  beforeEach(isolated);

  async function busy(): Promise<Conversation> {
    const convo = withPrompt();
    pinRequirement(convo, { text: "It must use PostgreSQL.", fromVersion: 1 });
    const result = await generateCandidates(convo, { count: 3 });
    promoteCandidate(convo, result.candidates[0]?.candidate.id as string);
    mergeCandidatesInto(
      convo,
      result.candidates.slice(1).map((c) => c.candidate.id),
    );
    saveConversation(convo);
    return convo;
  }

  it("survives a reload with every candidate, promotion and version intact", async () => {
    const written = await busy();
    const read = loadConversation(written.id);
    expect(read).not.toBeNull();
    expect(read!.candidates).toEqual(written.candidates);
    expect(read!.candidatePromotions).toEqual(written.candidatePromotions);
    expect(read!.promptVersions).toEqual(written.promptVersions);
    expect(read!.currentV).toBe(written.currentV);
    expect(semanticSnapshot(read!)).toBe(semanticSnapshot(written));
  });

  it("puts candidate provenance and promotions in the semantic snapshot (WS-R9)", async () => {
    const written = await busy();
    const snapshot = semanticSnapshot(written);
    expect(snapshot).toContain("archetype");
    expect(snapshot).toContain("\"promotion\":\"merge\"");
    // Run data stays out of it: no timestamps, no latency, no model identity.
    expect(snapshot).not.toContain(written.candidates[0]?.at as string);
  });

  it("rebuilds the index from objects and runs to the same answers (AC-032)", async () => {
    await busy();
    const query = (): string => {
      const index = openStoreIndex(store());
      try {
        return JSON.stringify({
          candidates: index.query("SELECT * FROM candidate ORDER BY id"),
          promotions: index.query("SELECT * FROM candidate_promotion ORDER BY seq"),
          versions: index.query("SELECT * FROM prompt_version ORDER BY conversation_id, v"),
        });
      } finally {
        index.close();
      }
    };
    const before = query();
    rmSync(join(dataDir(), "index.sqlite"));
    expect(query()).toBe(before);
  });

  it("appends: a second generation adds to the set and removes nothing", async () => {
    const convo = withPrompt();
    const first = await generateCandidates(convo, { count: 2 });
    saveConversation(convo);
    const second = await generateCandidates(convo, { count: 2 });
    saveConversation(convo);

    const reloaded = loadConversation(convo.id)!;
    const ids = reloaded.candidates.map((c) => c.id);
    for (const { candidate } of [...first.candidates, ...second.candidates]) {
      expect(ids).toContain(candidate.id);
    }
  });
});

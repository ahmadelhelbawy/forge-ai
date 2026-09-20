/**
 * `intent.extract` boundary tests (FR-002, MB-R1, AC-016, AC-019).
 *
 * No network, no API key: a stub provider stands in for the model. What is
 * under test is FORGE's half of the boundary — prompt determinism, schema
 * repair budget, post-validators, attribution, and cassette replay — not the
 * model's wording. Model wording is evaluated by the thesis corpus (AC-025),
 * never by unit tests.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  BoundaryError,
  BoundaryFailureError,
  INTENT_EXTRACT_ID,
  INTENT_EXTRACT_VERSION,
  checkIssuedSegments,
  extractIntent,
  intentExtractValidators,
  refineIntent,
  renderIntentPrompt,
  renderRefinePrompt,
} from "../../src/intent/extract.js";
import { collectSignals, renderSignalsSection, signalsSegment } from "../../src/intent/signals.js";
import { WorkspaceGuard } from "../../src/context/workspace.js";
import { SMALL_REPO } from "../helpers/context.js";
import { DraftIRSchema, type DraftIR } from "../../src/ir/schema.js";
import { cassetteKey, readCassette, writeCassette } from "../../src/model/cassette.js";
import type { CompletionResponse, ModelProvider } from "../../src/model/provider.js";

const TEXT = "Fix the flaky login redirect test in src/auth/login.test.ts without changing the AuthProvider interface.";

const validDraft = (): DraftIR => ({
  objective: {
    statement: "Fix the flaky login redirect test",
    kind: "debug",
    success_definition: "The login redirect test passes consistently",
    derived_from: "s1",
  },
  goals: [
    {
      id: "g1",
      statement: "Fix the flaky login redirect test",
      priority: "must",
      acceptance: ["The test passes three consecutive runs"],
      derived_from: "s1",
    },
  ],
  constraints: [
    {
      id: "c1",
      kind: "architectural",
      hardness: "hard",
      statement: "Do not change the AuthProvider interface",
      derived_from: "s1",
    },
  ],
  non_goals: [],
  scope: { include: ["src/auth/login.test.ts"], exclude: [], blast_radius: "file", derived_from: "s1" },
  required_capabilities: ["run_tests"],
  assumptions: [],
  open_questions: [],
  verification: [
    {
      id: "v1",
      kind: "test",
      spec: "Run the login redirect test three times",
      expected: "three consecutive passes",
      satisfies: ["g1"],
      derived_from: "s1",
    },
  ],
  deliverables: [{ id: "d1", kind: "code_change", description: "Fixed login redirect test", derived_from: "s1" }],
  risk: { level: "low", factors: [] },
});

/** A model stand-in: replays canned texts in order and counts invocations. */
function stubProvider(texts: string[], model = "stub-model"): ModelProvider & { calls: number } {
  const provider = {
    id: "stub",
    defaultModel: model,
    calls: 0,
    complete: async (): Promise<CompletionResponse> => {
      const text = texts[Math.min(provider.calls, texts.length - 1)]!;
      provider.calls += 1;
      return { text, model, latencyMs: 1 };
    },
  };
  return provider;
}

describe("intent.extract prompt", () => {
  it("is deterministic for the same input", () => {
    expect(renderIntentPrompt(TEXT)).toBe(renderIntentPrompt(TEXT));
  });

  it("changes when the input changes (so cassette keys cannot collide)", () => {
    expect(renderIntentPrompt(TEXT)).not.toBe(renderIntentPrompt(`${TEXT} Extra sentence.`));
  });

  it("encodes the FR-002 contract: no invention, legal uncertainty, citations", () => {
    const prompt = renderIntentPrompt(TEXT);
    expect(prompt).toContain("STATE ONLY WHAT THE INPUT STATES");
    expect(prompt).toContain("blocking");
    expect(prompt).toContain("derived_from");
    expect(prompt).toContain("s1");
  });
});

describe("intent.extract happy path", () => {
  it("parses a valid draft, attributes it to user_input, and records the call", async () => {
    const provider = stubProvider([JSON.stringify(validDraft())]);
    const result = await extractIntent(TEXT, { provider });

    expect(result.repairs).toBe(0);
    expect(result.ir.goals).toHaveLength(1);
    expect(result.ir.goals[0]!.source_ref).toBe("user_input");
    expect(result.ir.scope.source_ref).toBe("user_input");
    expect(result.record.boundaryId).toBe(INTENT_EXTRACT_ID);
    expect(result.record.boundaryVersion).toBe(INTENT_EXTRACT_VERSION);
    expect(result.record.provider).toBe("stub");
    expect(result.record.repairs).toBe(0);
    expect(result.record.replayed).toBe(false);
    expect(result.record.promptHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.record.outputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(provider.calls).toBe(1);
  });
});

describe("intent.extract repair", () => {
  it("repairs a schema-invalid draft once and succeeds", async () => {
    const broken = { ...validDraft(), goals: [] } as unknown;
    const provider = stubProvider([JSON.stringify(broken), JSON.stringify(validDraft())]);
    const result = await extractIntent(TEXT, { provider });

    expect(result.repairs).toBe(1);
    expect(result.ir.goals).toHaveLength(1);
    expect(result.record.repairs).toBe(1);
    expect(provider.calls).toBe(2);
  });

  it("repairs twice and succeeds (FR-003: at most two repairs)", async () => {
    const broken = { ...validDraft(), goals: [] } as unknown;
    const provider = stubProvider([JSON.stringify(broken), "not json", JSON.stringify(validDraft())]);
    const result = await extractIntent(TEXT, { provider });

    expect(result.repairs).toBe(2);
    expect(result.ir.goals).toHaveLength(1);
    expect(provider.calls).toBe(3);
  });

  it("fails hard after the third failure — never a guess (MB-R3, FR-003)", async () => {
    const provider = stubProvider(["not json at all", "still not json", "never json"]);
    await expect(extractIntent(TEXT, { provider })).rejects.toBeInstanceOf(BoundaryFailureError);
    expect(provider.calls).toBe(3);
  });

  it("repairs validator problems (dangling citation), not just schema errors", async () => {
    const draft = validDraft();
    draft.verification[0]!.satisfies = ["g99"];
    const provider = stubProvider([JSON.stringify(draft), JSON.stringify(validDraft())]);
    const result = await extractIntent(TEXT, { provider });
    expect(result.repairs).toBe(1);
    expect(result.ir.verification[0]!.satisfies).toEqual(["g1"]);
  });
});

describe("intent.extract post-validators", () => {
  const input = { text: TEXT };

  it("rejects citations to goals that do not exist", () => {
    const draft = validDraft();
    draft.verification[0]!.satisfies = ["g2"];
    expect(intentExtractValidators.citationsResolve(input, draft)).toHaveLength(1);
  });

  it("rejects duplicate ids across collections", () => {
    const draft = validDraft();
    draft.constraints.push({
      id: "g1",
      kind: "behavioral",
      hardness: "soft",
      statement: "Duplicate",
      derived_from: "s1",
    });
    expect(intentExtractValidators.idsUnique(input, draft)).toHaveLength(1);
  });

  it("rejects derived_from citations to segments FORGE never issued (INV-016)", () => {
    const draft = validDraft();
    draft.goals[0]!.derived_from = "s99";
    const problems = intentExtractValidators.segmentsIssued(input, draft);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("s99");
  });

  it("rejects a draft that states provenance directly (AC-026)", () => {
    const draft = { ...validDraft(), goals: [{ ...validDraft().goals[0]!, source_ref: "user_input" }] };
    expect(DraftIRSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects an invented capability at the schema layer", () => {
    const draft = { ...validDraft(), required_capabilities: ["teleport"] };
    expect(DraftIRSchema.safeParse(draft).success).toBe(false);
  });
});

describe("intent.extract cassette replay (FR-048, AC-019)", () => {
  it("replays deterministically with no provider at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cassette-"));
    const prompt = renderIntentPrompt(TEXT);
    const key = cassetteKey(INTENT_EXTRACT_ID, INTENT_EXTRACT_VERSION, prompt);
    const responseText = JSON.stringify(validDraft());
    writeCassette(dir, {
      version: 1,
      key,
      boundaryId: INTENT_EXTRACT_ID,
      boundaryVersion: INTENT_EXTRACT_VERSION,
      model: "recorded-model",
      responseText,
      recordedAt: new Date().toISOString(),
    });

    expect(readCassette(dir, key)?.responseText).toBe(responseText);

    const first = await extractIntent(TEXT, { cassetteDir: dir });
    const second = await extractIntent(TEXT, { cassetteDir: dir });
    expect(first.ir).toEqual(second.ir);
    expect(first.record.replayed).toBe(true);
    expect(first.record.provider).toBe("cassette");
  });

  it("records a live call to the cassette for the next replay", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-cassette-"));
    const provider = stubProvider([JSON.stringify(validDraft())], "live-model");
    const live = await extractIntent(TEXT, { provider, cassetteDir: dir });
    expect(live.record.replayed).toBe(false);
    expect(provider.calls).toBe(1);

    const replayed = await extractIntent(TEXT, { cassetteDir: dir });
    expect(replayed.ir).toEqual(live.ir);
    expect(replayed.record.replayed).toBe(true);
    expect(provider.calls).toBe(1);
  });
});

describe("intent.extract refine mode (FR-002, FR-004)", () => {
  const ANSWERS = [{ questionId: "q1", question: "Which login test is flaky?", answer: "the e2e one" }];

  it("renders prior draft, answers, and optional signals as distinct segments", () => {
    const base = renderIntentPrompt(TEXT);
    const plain = renderRefinePrompt(base, validDraft(), ANSWERS);
    expect(plain.segments.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(plain.segments[1]?.source_ref).toBe("user_input");
    expect(plain.prompt).toContain("PRIOR DRAFT");
    expect(plain.prompt).toContain("the e2e one");
    expect(plain.prompt).not.toContain("REPOSITORY LAYOUT");

    const guard = WorkspaceGuard.open(SMALL_REPO);
    const signals = collectSignals(guard);
    const grounded = renderRefinePrompt(base, validDraft(), ANSWERS, signals);
    expect(grounded.segments.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(grounded.segments[1]?.source_ref).toBe("forge_derived");
    expect(grounded.prompt).toContain("REPOSITORY LAYOUT");
    expect(grounded.prompt).not.toBe(base);
    // The base prompt itself is untouched: committed cassettes stay valid.
    expect(base).toBe(renderIntentPrompt(TEXT));
  });

  it("attributes refined nodes through the issued table, never by model claim", () => {
    const draft = validDraft();
    draft.goals[0]!.derived_from = "s2";
    expect(checkIssuedSegments(
      renderRefinePrompt(renderIntentPrompt(TEXT), validDraft(), ANSWERS).segments,
      draft,
    )).toEqual([]);
    const forged = validDraft();
    forged.goals[0]!.derived_from = "s99";
    expect(
      checkIssuedSegments(
        renderRefinePrompt(renderIntentPrompt(TEXT), validDraft(), ANSWERS).segments,
        forged,
      ),
    ).toHaveLength(1);
  });

  it("restructures around answers and records the call (FR-049)", async () => {
    const refined = { ...validDraft(), goals: [{ ...validDraft().goals[0]!, derived_from: "s2" }] };
    const provider = stubProvider([JSON.stringify(refined)]);
    const result = await refineIntent(TEXT, validDraft(), ANSWERS, { provider });
    expect(result.repairs).toBe(0);
    expect(result.ir.goals[0]?.source_ref).toBe("user_input");
    expect(result.record.boundaryId).toBe(INTENT_EXTRACT_ID);
    expect(result.record.repairs).toBe(0);
    expect(provider.calls).toBe(1);
  });

  it("repairs within the same budget and refuses empty answers or bad priors", async () => {
    const provider = stubProvider(["oops", JSON.stringify(validDraft())]);
    const result = await refineIntent(TEXT, validDraft(), ANSWERS, { provider });
    expect(result.repairs).toBe(1);
    await expect(refineIntent(TEXT, validDraft(), [], { provider })).rejects.toBeInstanceOf(BoundaryError);
    await expect(
      refineIntent(TEXT, { nope: true } as unknown as DraftIR, ANSWERS, { provider }),
    ).rejects.toBeInstanceOf(BoundaryError);
  });
});

describe("repo signals (signals.ts)", () => {
  it("derives a sorted, capped layout from the guard — never direct fs", () => {
    const guard = WorkspaceGuard.open(SMALL_REPO);
    const signals = collectSignals(guard);
    expect(signals.topLevel).toEqual([...signals.topLevel].sort());
    expect(signals.topLevel).toContain("src/");
    expect(signals.topLevel.length).toBeLessThanOrEqual(30);
    expect(signals.fileCount).toBeGreaterThan(0);
    expect(signalsSegment()).toMatchObject({ id: "s2", source_ref: "forge_derived" });
    const section = renderSignalsSection(signals);
    expect(section).toContain("s2");
    expect(section).toContain("ground scope globs");
  });
});

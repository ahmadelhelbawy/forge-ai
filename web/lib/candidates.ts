/**
 * Candidates, comparison, selection and merge (V2-E) — server-only.
 *
 * `WS-R8` says a candidate is an alternative artifact inside one conversation,
 * generated **only when the user or the request asks for alternatives**, from
 * the strategy archetypes of §9 and not from a second strategy system. This
 * module is where that sentence becomes code, and it is arranged around four
 * properties that would each be a defect if they failed quietly:
 *
 * **1. Generating never promotes.** Nothing in `generateCandidates` writes a
 * prompt version or moves `currentV`. A candidate becomes the current prompt
 * only through `promoteCandidate` or `mergeCandidatesInto`, each of which is
 * reached only from a route a user action hits (`ST-R6`).
 *
 * **2. The variation comes from structure, not from asking for variety.**
 * Each candidate is generated under one derived overlay — its added
 * constraints, autonomy, change budget, verification intensity and exploration
 * settings — which is what `ST-R1` means by "a structured overlay, never a
 * prose variant". The archetypes are selected and tuned by the existing
 * deterministic fit machinery (§11.3) and their pairwise distinctness is the
 * existing gate (§11.5). V2-E adds a *text* duplicate check on top, because a
 * model can return the same prose under two different structures.
 *
 * **3. Layer 1 keeps its authority throughout.** Every candidate is checked
 * against the requirement ledger, and so is every version these functions
 * write. A candidate that drops a pinned requirement is **reported, not
 * withheld** — hiding it would hide the evidence, which is the inversion
 * `WS-R27` forbids. Nothing here can add, edit or unpin an entry, and the
 * fingerprint is taken before the first model call and checked after the last.
 *
 * **4. It is off the critical path.** Generation runs on its own request and
 * costs one model call per candidate, declared in the result. An ordinary
 * revision still costs what `WS-R13` says it costs, because an ordinary
 * revision never reaches this file.
 */
import {
  admitCandidates,
  candidateDivergence,
  mergeCandidateTexts,
  MergeSourceError,
  type CandidateDivergence,
  type MergeResult,
} from "forge/dist/candidate/index.js";
import {
  CONVERSATION_CANDIDATE_ID,
  CONVERSATION_CANDIDATE_VERSION,
  CandidateInputSchema,
  conversationCandidateBoundary,
} from "forge/dist/conversation/candidate.js";
import { parseEnvelope } from "forge/dist/conversation/generate.js";
import type { LedgerCheckResult } from "forge/dist/critic/deterministic/ledger.js";
import { checkRequirementLedger } from "forge/dist/critic/deterministic/ledger.js";
import { diagnostic, measureEvidence, type Diagnostic } from "forge/dist/ir/diagnostic.js";
import type { TaskIR } from "forge/dist/ir/schema.js";
import { sha256Hex, type ModelCallRecord } from "forge/dist/model/provider.js";
import { builtinProfiles } from "forge/dist/profile/registry.js";
import { checkDistinctness, type DistinctnessResult } from "forge/dist/strategy/distinctness.js";
import { builtinStrategies } from "forge/dist/strategy/registry.js";
import { renderRationale, scoreArchetype } from "forge/dist/strategy/fit.js";
import { deriveParameters } from "forge/dist/strategy/derive.js";
import { extractProfileSignals, extractSignals } from "forge/dist/strategy/signals.js";
import { ARCHETYPE_ORDER, ArchetypeSource } from "forge/dist/strategy/source.js";
import type { DerivedOverlay, StrategyArchetype } from "forge/dist/strategy/schema.js";

import { diffLines, type DiffHunk } from "./diff";
import { generate } from "./ai-provider";
import { resolveCall, transportFor } from "./forge";
import { irForVersion } from "./preservation";
import {
  addCandidate,
  addPromptVersion,
  candidateById,
  checkLedger,
  currentPrompt,
  ledgerEntries,
  ledgerState,
  recordCandidatePromotion,
  recordModelCall,
  type Conversation,
  type PromptCandidate,
  type PromptVersion,
} from "./store";

/** Alternatives are worth having between two and the number of archetypes. */
export const MIN_CANDIDATES = 2;
export const MAX_CANDIDATES = ARCHETYPE_ORDER.length;
export const DEFAULT_CANDIDATES = 3;

/**
 * Bigger than a chat turn's, because the job is bigger.
 *
 * A candidate is a **full rewrite** of the current prompt under an overlay,
 * and on a reasoning model the thinking tokens come out of the same budget.
 * The first live run against Kimi K3 spent all 4000 on reasoning and returned
 * nothing, which is a budget defect rather than a model one — the request was
 * for more output than the budget could hold.
 */
const CANDIDATE_MAX_TOKENS = 12_000;
/**
 * Zero, deliberately.
 *
 * The variety a candidate set needs comes from the overlays, which are
 * structures. Buying it with sampling temperature instead would be exactly the
 * "short, medium and long wordings" `ST-R1` rules out, and would make the same
 * request answerable differently on a second try for no stated reason.
 */
const CANDIDATE_TEMPERATURE = 0;

/**
 * A candidate operation the conversation's state cannot express (`WS-R5`).
 *
 * Refusing is the specified behaviour: "where state is insufficient, the
 * action is refused with a diagnostic, not silently downgraded".
 */
export class CandidateStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateStateError";
  }
}

/** The ledger changed while a candidate model call was in flight (WS-R27.4). */
export class LedgerTamperedError extends Error {
  constructor() {
    super(
      "The requirement ledger changed while candidates were being generated. Only a user " +
        "action may add, edit, remove or unpin an entry (WS-R27.4); the request was refused.",
    );
    this.name = "LedgerTamperedError";
  }
}

// ── Rendering an overlay as instruction ──────────────────────────────────────

/**
 * The overlay, written out for the model.
 *
 * Every line is read off the derived overlay; none of it is prose this module
 * invented. That is what keeps the §9 archetypes the single source of
 * variation rather than a decoration on top of a hidden one.
 */
export function renderOverlayBrief(archetype: StrategyArchetype, overlay: DerivedOverlay): string {
  const t = overlay.template;
  const lines: string[] = [
    `STRATEGY OVERLAY: ${archetype.id} — ${archetype.description.replace(/\s+/g, " ").trim()}`,
    "",
    "Apply these as the shaping constraints of the alternative:",
  ];
  for (const constraint of t.added_constraints) {
    lines.push(`- [${constraint.hardness} ${constraint.kind}] ${constraint.statement}`);
  }
  for (const check of t.added_verification) {
    lines.push(`- [verification] ${check.spec} — expected: ${check.expected}`);
  }
  lines.push(
    `- Decision authority: ${t.autonomy.decision_authority}; ask when: ${t.autonomy.ask_threshold}`,
    `- Change budget: at most ${t.change_budget.max_files} files`,
    `- Verification intensity: ${t.verification_intensity}`,
    `- Context policy: ${t.context_policy}`,
    `- Challenge the architecture: ${t.exploration.challenge_architecture ? "yes" : "no"}; ` +
      `alternatives to offer: ${t.exploration.require_alternatives}`,
  );
  const params = Object.entries(overlay.params);
  if (params.length > 0) {
    lines.push(`- Tuned parameters: ${params.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * The pinned requirements, written out for the model (WS-R24, WS-R25).
 *
 * Layer 1 checks a candidate for each pinned text **word for word**. Found
 * live: a model that kept the meaning of "It must read the full diff before
 * judging" but wrote "Read the complete diff" failed that check in every
 * candidate, because nothing had told it which text had to survive. Telling it
 * is not a weakening of the guarantee — the check is unchanged and still
 * decides — it just stops the generator from being blind to a rule the system
 * enforces on its output.
 *
 * The texts are user-authored ledger entries (`origin: "user_input"`), already
 * present in the prompt being rewritten. Nothing here lets the model edit them.
 */
function renderPinnedBlock(pinned: readonly string[]): string[] {
  if (pinned.length === 0) return [];
  return [
    "PINNED REQUIREMENTS — the user pinned these. Each must appear in your alternative WORD FOR WORD,",
    "exactly as written below. Do not reword, shorten, merge or paraphrase them; place each as its own line.",
    ...pinned.map((text) => `- ${text}`),
    "",
  ];
}

function renderCandidateRequest(
  archetype: StrategyArchetype,
  overlay: DerivedOverlay,
  base: string,
  pinned: readonly string[] = [],
): { system: string; user: string } {
  const system = [
    "You are FORGE, writing ONE alternative version of an existing prompt.",
    "",
    "RESPONSE FORMAT — exactly one JSON object, no fences, no prose outside it:",
    '{"reply": "<one sentence on what this alternative emphasises>", "prompt": "<the FULL alternative prompt>"}',
    "",
    "RULES:",
    "- Rewrite the WHOLE prompt. A fragment or a diff is not an alternative.",
    "- The alternative must differ STRUCTURALLY, under the overlay below — not in wording, length or tone.",
    "- Never drop a requirement the current prompt states. Add and re-shape; do not silently remove.",
    "- Output must be proportional to the task. Padding is a defect.",
  ].join("\n");

  const user = [
    renderOverlayBrief(archetype, overlay),
    "",
    ...renderPinnedBlock(pinned),
    "CURRENT PROMPT:",
    base,
    "",
    `Write the ${archetype.id} alternative to the current prompt.`,
  ].join("\n");

  return { system, user };
}

/**
 * The offline stand-in generator.
 *
 * Structural, deterministic and obviously not a model: the base prompt plus
 * the overlay's own statements, one block each. It exists so the whole
 * candidate path — selection, generation, the duplicate gate, the ledger
 * check, persistence and the UI — is exercisable with no network and no key
 * (`NFR-007`), exactly as `stubDeps` and `stubExtraction` are.
 */
export function stubCandidateText(overlay: DerivedOverlay, base: string): string {
  const t = overlay.template;
  const blocks = [base, `This is the ${overlay.archetypeId} alternative.`];
  for (const constraint of t.added_constraints) blocks.push(constraint.statement);
  for (const check of t.added_verification) blocks.push(`${check.spec} (expected: ${check.expected})`);
  blocks.push(
    `Decision authority is ${t.autonomy.decision_authority} and you ask when ${t.autonomy.ask_threshold}.`,
  );
  blocks.push(`Change at most ${t.change_budget.max_files} files.`);
  return blocks.join("\n\n");
}

// ── Archetype selection ──────────────────────────────────────────────────────

interface ChosenArchetype {
  readonly archetype: StrategyArchetype;
  readonly overlay: DerivedOverlay;
  readonly score: number;
  readonly rationale: string;
}

/**
 * Pick which archetypes generate this set (§11.3, `ST-R3`, `ST-R6`).
 *
 * Fit-ranked first, because the ranking is the deciding rule the user is shown.
 * When fewer archetypes score above zero than the user asked for, the set is
 * topped up in configured order with a rationale that **honestly reports score
 * zero** — the core already treats an explicit choice as applying regardless of
 * fit, and asking for four alternatives is an explicit choice. Inventing a
 * score to make the list look decided would be the dishonest option.
 */
export function chooseArchetypes(ir: TaskIR, target: string, count: number): ChosenArchetype[] {
  const registry = builtinStrategies();
  const profile = builtinProfiles().get(target && target !== "generic" ? target : "claude-code");
  const ranked = new ArchetypeSource(registry).propose(ir, profile);

  const chosen: ChosenArchetype[] = [];
  const taken = new Set<string>();
  const irSignals = extractSignals(ir);
  const profileSignals = extractProfileSignals(profile);

  for (const candidate of ranked) {
    if (chosen.length >= count) break;
    const archetype = registry.all.find((a) => a.id === candidate.overlay.archetypeId);
    if (!archetype) continue;
    chosen.push({
      archetype,
      overlay: candidate.overlay,
      score: candidate.score,
      rationale: candidate.rationale,
    });
    taken.add(archetype.id);
  }

  for (const id of ARCHETYPE_ORDER) {
    if (chosen.length >= count) break;
    if (taken.has(id)) continue;
    const archetype = registry.all.find((a) => a.id === id);
    if (!archetype) continue;
    const { score, matched } = scoreArchetype(archetype, irSignals, profileSignals);
    const { params, sources } = deriveParameters(archetype, ir);
    const overlay: DerivedOverlay = {
      archetypeId: archetype.id,
      strategyId: `st_${archetype.id}`,
      version: archetype.version,
      params,
      template: archetype.overlay_template,
    };
    chosen.push({ archetype, overlay, score, rationale: renderRationale(archetype.id, score, matched, params, sources) });
    taken.add(id);
  }

  return chosen;
}

// ── Generation ───────────────────────────────────────────────────────────────

export interface GeneratedCandidate {
  readonly candidate: PromptCandidate;
  /** Layer 1 against this candidate's text. Deterministic, model-free. */
  readonly preservation: LedgerCheckResult;
}

export interface CandidateCallBudget {
  /** Task IRs extracted to rank the archetypes. Zero when already stored. */
  readonly extraction: number;
  /** One per candidate that was attempted. */
  readonly generation: number;
  readonly total: number;
}

export interface CandidateGenerationResult {
  readonly fromVersion: number;
  readonly candidates: readonly GeneratedCandidate[];
  /** §11.5 over the chosen overlays: the structural distinctness evidence. */
  readonly overlayDistinctness: DistinctnessResult;
  /** INV-012: everything that was attempted and did not make the set. */
  readonly diagnostics: readonly Diagnostic[];
  readonly calls: CandidateCallBudget;
  /**
   * Always false, and stated rather than implied.
   *
   * WS-R8's "candidates never become the current prompt by default" is a
   * property of this function, and a caller reading the result should be able
   * to see it without reading the implementation.
   */
  readonly versionCreated: false;
  /** WS-R28: which layer the preservation results in here belong to. */
  readonly layer: "deterministic";
}

/** One generation call's worth of transport. The seam the offline suite uses. */
export type CandidateCompletion = (request: {
  readonly strategy: string;
  readonly system: string;
  readonly user: string;
}) => Promise<{ readonly text: string; readonly model: string; readonly latencyMs: number }>;

export interface GenerateOptions {
  readonly count?: number;
  readonly provider?: string;
  readonly model?: string;
  /**
   * Override the transport (tests, and nothing else in the product).
   *
   * The same seam `TurnDeps.complete` gives the pipeline: it is what lets the
   * failure paths below be exercised with no network, which is the only way
   * to know they work before a live run finds out for the user.
   */
  readonly complete?: CandidateCompletion;
}

function callRecord(result: { model: string; latencyMs: number; text: string }, providerId: string, prompt: string): ModelCallRecord {
  return {
    boundaryId: CONVERSATION_CANDIDATE_ID,
    boundaryVersion: CONVERSATION_CANDIDATE_VERSION,
    provider: providerId,
    model: result.model,
    promptHash: sha256Hex(prompt),
    outputHash: sha256Hex(result.text),
    repairs: 0,
    latencyMs: result.latencyMs,
    replayed: false,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate alternatives to the current prompt (`WS-R8`).
 *
 * Writes to `convo.candidates` and to the run log, and to nothing else. The
 * caller saves.
 */
export async function generateCandidates(
  convo: Conversation,
  options: GenerateOptions = {},
): Promise<CandidateGenerationResult> {
  const base = currentPrompt(convo);
  if (base === null) {
    throw new CandidateStateError(
      "There is no current prompt to generate alternatives to. Create a prompt first (WS-R5).",
    );
  }
  const fromVersion = convo.currentV;
  const requested = Math.max(MIN_CANDIDATES, Math.min(MAX_CANDIDATES, Math.trunc(options.count ?? DEFAULT_CANDIDATES)));

  // WS-R27.4: taken before anything model-shaped happens.
  const ledgerAtStart = ledgerState(convo);

  const extracted = await irForVersion(convo, fromVersion, {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
  });
  const chosen = chooseArchetypes(extracted.ir, convo.target, requested);
  const overlayDistinctness = checkDistinctness(chosen.map((c) => c.overlay));

  const diagnostics: Diagnostic[] = [];
  const proposals: Array<{ id: string; label: string; text: string; chosen: ChosenArchetype }> = [];
  let generation = 0;

  const injected = options.complete ?? null;
  const stub = injected === null && Boolean(process.env["FORGE_CHAT_STUB"]);
  const resolved =
    injected !== null || stub
      ? null
      : // `resolveCall` + `transportFor`, the same pair the turn pipeline and
        // the connection test use, because they are the only routing that
        // reads the MODEL's documented protocol. Picking a transport from the
        // provider's kind alone sent every OpenCode Go candidate call to
        // /chat/completions, which is wrong for the 12 of its 29 models that
        // speak anthropic-messages or responses. It also gives the session
        // header the conversation id the docs require, in place of a fresh
        // uuid per call.
        transportFor(
          resolveCall(options.provider ?? convo.provider, options.model ?? convo.model ?? undefined),
          convo.id,
        );

  /**
   * The first transport failure, kept so a request in which *every* archetype
   * failed can report the real cause. An empty candidate set returned as a
   * success would read as "the model had no alternatives to offer", which is
   * not what happened — a hard error beats a plausible wrong answer.
   */
  let firstTransportFailure: unknown = null;

  /**
   * Fire every archetype's call at once (`WS-R13`).
   *
   * The calls are independent — one per overlay, none reading another's answer
   * — so running them one after another buys nothing and costs the sum of
   * their latencies. That is not merely slow: three reasoning-model calls in
   * one request exceeded a client's five-minute header timeout against a real
   * provider and the whole request failed, with no candidates and no useful
   * error. Concurrency is the structural fix; a longer timeout would only have
   * moved the wall.
   *
   * **Nothing about the result depends on who answers first.** The requests are
   * built in fit order, settled together, and then *consumed in that same
   * order* below — so the run log, the diagnostics and the candidate list are
   * functions of the request rather than of the network's mood.
   */
  const pinnedTexts = ledgerEntries(convo).map((entry) => entry.text);
  const requests = chosen.map((pick) => {
    const rendered = renderCandidateRequest(pick.archetype, pick.overlay, base, pinnedTexts);
    return {
      pick,
      rendered,
      input: CandidateInputSchema.parse({
        strategy: pick.archetype.id,
        base,
        system: rendered.system,
        user: rendered.user,
      }),
    };
  });
  generation = requests.length;

  const settled = await Promise.allSettled(
    requests.map(async ({ pick, rendered, input }) => {
      if (injected !== null) {
        return injected({ strategy: input.strategy, system: input.system, user: input.user });
      }
      if (stub) {
        return {
          text: JSON.stringify({
            reply: `The ${pick.archetype.id} alternative.`,
            prompt: stubCandidateText(pick.overlay, base),
          }),
          model: "stub",
          latencyMs: 0,
        };
      }
      const spec = resolved as NonNullable<typeof resolved>;
      const completion = await generate(spec, {
        system: rendered.system,
        prompt: rendered.user,
        maxTokens: CANDIDATE_MAX_TOKENS,
        temperature: CANDIDATE_TEMPERATURE,
      });
      return { text: completion.text, model: completion.modelId, latencyMs: completion.latencyMs };
    }),
  );

  for (const [at, { pick, input }] of requests.entries()) {
    const outcome = settled[at] as PromiseSettledResult<{ text: string; model: string; latencyMs: number }>;

    if (outcome.status === "rejected") {
      // One archetype's transport failing costs the user that alternative and
      // nothing else. It is recorded, never swallowed (INV-012), and if every
      // archetype fails the error is re-thrown below rather than dressed up as
      // an empty result.
      const error: unknown = outcome.reason;
      if (firstTransportFailure === null) firstTransportFailure = error;
      diagnostics.push(
        diagnostic(
          "FORGE-W003",
          `The ${pick.archetype.id} alternative could not be generated: ${
            error instanceof Error ? error.message : String(error)
          }`,
          [measureEvidence("failed_candidate_calls", 1, "calls")],
        ),
      );
      continue;
    }

    const { text, model, latencyMs } = outcome.value;

    // WS-R14: an unrecorded call is a gap in the audit trail whether or not
    // anything was made of its answer.
    recordModelCall(
      convo,
      callRecord({ model, latencyMs, text }, stub ? "stub" : convo.provider, `${input.strategy}\n${input.system}\n${input.user}`),
    );

    const envelope = parseEnvelope(text);
    if (envelope === null) {
      diagnostics.push(
        diagnostic(
          "FORGE-W003",
          `The ${pick.archetype.id} alternative did not come back as a readable FORGE envelope, so it was dropped.`,
          [measureEvidence("unreadable_responses", 1, "responses")],
        ),
      );
      continue;
    }
    const problems = conversationCandidateBoundary.postValidators.flatMap((validate) => validate(input, envelope));
    if (problems.length > 0) {
      // MB-R3: skip, recorded. Never a repair into something the model did
      // not say, and never a silent thinning of the set (INV-012).
      diagnostics.push(
        diagnostic("FORGE-W007", `The ${pick.archetype.id} alternative was dropped: ${problems.join(" ")}`, [
          measureEvidence("rejected_candidates", 1, "candidates"),
        ]),
      );
      continue;
    }
    proposals.push({
      id: pick.archetype.id,
      label: pick.archetype.id,
      text: envelope.prompt as string,
      chosen: pick,
    });
  }

  // ST-R5, applied across the set this time rather than against the base.
  const admitted = admitCandidates(proposals);
  diagnostics.push(...admitted.diagnostics);

  if (admitted.accepted.length === 0 && firstTransportFailure !== null) throw firstTransportFailure;

  if (ledgerState(convo) !== ledgerAtStart) throw new LedgerTamperedError();

  const entries = ledgerEntries(convo);
  const generated: GeneratedCandidate[] = admitted.accepted.map((proposal) => {
    const candidate = addCandidate(convo, {
      label: proposal.chosen.archetype.id,
      text: proposal.text,
      fromVersion,
      strategy: proposal.chosen.archetype.id,
      origin: "archetype",
      rationale: proposal.chosen.rationale,
      score: proposal.chosen.score,
    });
    return {
      candidate,
      // Layer 1 over a candidate. It names the version the candidate was
      // derived from, because that is the artifact it is being compared to.
      preservation: checkRequirementLedger(
        entries,
        proposal.text,
        fromVersion,
        `candidate ${proposal.chosen.archetype.id}`,
      ),
    };
  });

  return {
    fromVersion,
    candidates: generated,
    overlayDistinctness,
    diagnostics,
    calls: {
      extraction: extracted.extracted && !stub ? 1 : 0,
      generation,
      total: (extracted.extracted && !stub ? 1 : 0) + generation,
    },
    versionCreated: false,
    layer: "deterministic",
  };
}

/**
 * Layer 1 over one candidate, naming the candidate as its subject.
 *
 * The single place a candidate is checked, so every surface — generation, the
 * list route, comparison — reports a dropped pin against the candidate rather
 * than against the version it came from, which does contain it.
 */
export function candidatePreservation(convo: Conversation, candidate: PromptCandidate): LedgerCheckResult {
  return checkRequirementLedger(
    ledgerEntries(convo),
    candidate.text,
    candidate.fromVersion ?? convo.currentV,
    `candidate ${candidate.label}`,
  );
}

// ── Addressable artifacts ────────────────────────────────────────────────────

export interface ResolvedArtifact {
  readonly ref: string;
  readonly kind: "version" | "candidate";
  readonly label: string;
  readonly text: string;
  readonly strategy?: string;
  /** Layer 1 against this artifact. Deterministic, model-free (WS-R25). */
  readonly preservation: LedgerCheckResult;
}

/**
 * Resolve one artifact reference (`WS-R5`).
 *
 * `v<N>` names a prompt version; anything else is a candidate id. Two spaces
 * of names rather than one because they are two kinds of thing, and a
 * comparison that could not say which it was looking at would not be much of
 * a comparison.
 */
export function resolveArtifact(convo: Conversation, ref: string): ResolvedArtifact {
  const entries = ledgerEntries(convo);
  const versionMatch = /^v(\d+)$/.exec(ref);
  if (versionMatch) {
    const v = Number(versionMatch[1]);
    const version = convo.promptVersions.find((p) => p.v === v);
    if (!version) throw new CandidateStateError(`Version ${v} does not exist in this conversation (WS-R5).`);
    return {
      ref,
      kind: "version",
      label: `Version ${v}`,
      text: version.text,
      preservation: checkRequirementLedger(entries, version.text, v, `version ${v}`),
    };
  }
  const candidate = candidateById(convo, ref);
  if (!candidate) throw new CandidateStateError(`There is no artifact "${ref}" in this conversation (WS-R5).`);
  return {
    ref,
    kind: "candidate",
    label: candidate.label,
    text: candidate.text,
    ...(candidate.strategy ? { strategy: candidate.strategy } : {}),
    preservation: candidatePreservation(convo, candidate),
  };
}

export interface ComparisonView {
  readonly a: ResolvedArtifact;
  readonly b: ResolvedArtifact;
  /** Counted block differences — evidence, never a score (INV-008). */
  readonly divergence: CandidateDivergence;
  readonly hunks: readonly DiffHunk[];
  /** WS-R28: both sides' verdicts here are Layer 1's, and say so. */
  readonly layer: "deterministic";
}

/**
 * Compare two addressable artifacts side by side (`WS-R5`).
 *
 * Deterministic and model-free: a line diff, a block-level divergence count,
 * and each side's ledger verdict. Nothing judged appears here, so nothing in
 * this view can be mistaken for advice (`WS-R28`).
 */
export function compareArtifacts(convo: Conversation, aRef: string, bRef: string): ComparisonView {
  if (aRef === bRef) {
    throw new CandidateStateError("COMPARE needs two different artifacts; the same one was cited twice (WS-R5).");
  }
  const a = resolveArtifact(convo, aRef);
  const b = resolveArtifact(convo, bRef);
  return {
    a,
    b,
    divergence: candidateDivergence(a.text, b.text),
    hunks: diffLines(a.text, b.text),
    layer: "deterministic",
  };
}

// ── Promotion and merge ──────────────────────────────────────────────────────

export interface PromotionResult {
  readonly version: PromptVersion;
  /** Layer 1 over the version that was just written (WS-R25, WS-R29). */
  readonly preservation: LedgerCheckResult;
  readonly layer: "deterministic";
}

export interface MergeIntoResult extends PromotionResult {
  readonly merge: MergeResult;
}

/**
 * Promote a candidate to the current prompt (`ST-R6`, `WS-R2`, `WS-R7`).
 *
 * The user's explicit choice, and the only way a candidate becomes current.
 * The new version is appended; nothing earlier is touched and the candidate
 * stays in the set, because the set is a record of what was offered.
 */
export function promoteCandidate(convo: Conversation, candidateId: string): PromotionResult {
  const candidate = candidateById(convo, candidateId);
  if (!candidate) {
    throw new CandidateStateError(`There is no candidate "${candidateId}" in this conversation (WS-R5).`);
  }
  if (candidate.text === currentPrompt(convo)) {
    throw new CandidateStateError(
      "That candidate is already the current prompt; promoting it would write an identical version (WS-R7).",
    );
  }
  const action = currentPrompt(convo) === null ? "CREATE" : "REVISE";
  const version = addPromptVersion(convo, candidate.text, "model", { action });
  recordCandidatePromotion(convo, { v: version.v, promotion: "select", candidateIds: [candidate.id] });
  return { version, preservation: checkLedger(convo, version.v), layer: "deterministic" };
}

/**
 * Merge two or more artifacts into a new current prompt (`WS-R2`, `WS-R8`).
 *
 * The combination itself is the deterministic union in
 * `forge/dist/candidate/merge.js` — no model, so "nothing either candidate
 * said was dropped" is a mechanical property of the text rather than a claim
 * about a generation. Layer 1 then runs over the result and reports anything
 * the union could not keep contiguous, which is the honest remainder of that
 * guarantee rather than a hole in it (`INV-012`, `WS-R25`).
 */
export function mergeCandidatesInto(convo: Conversation, refs: readonly string[]): MergeIntoResult {
  const sources = refs.map((ref) => {
    const artifact = resolveArtifact(convo, ref);
    return { id: artifact.ref, label: artifact.label, text: artifact.text };
  });

  let merged: MergeResult;
  try {
    merged = mergeCandidateTexts(sources);
  } catch (error) {
    if (error instanceof MergeSourceError) throw new CandidateStateError(error.message);
    throw error;
  }

  const version = addPromptVersion(convo, merged.text, "merge", { action: "MERGE" });
  recordCandidatePromotion(convo, { v: version.v, promotion: "merge", candidateIds: refs });
  return { version, preservation: checkLedger(convo, version.v), merge: merged, layer: "deterministic" };
}

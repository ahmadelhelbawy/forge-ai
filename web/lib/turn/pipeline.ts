/**
 * The FORGE-owned turn pipeline (WS-R10, AD-17).
 *
 * One turn = resolve the action, then act on it. Nothing writes a prompt
 * version except this file, and this file writes one only for the four actions
 * WS-R2 permits — checked here again even though `conversation.generate`
 * already post-validates it, because a boundary failure must not be the only
 * thing between a question and a spurious version (WS-R3).
 *
 * The pipeline is an async generator over `TurnEvent`. That is the shape
 * V2-B's SSE stream needs, and it is the same event list the conversation
 * persists — one mechanism, not two. There is no graph runtime: the
 * append-only log is the checkpointer (AD-17).
 *
 * Transport is a single `complete` seam supplied by the caller, so this module
 * is exercised with a stand-in model and no network.
 */
import { randomUUID } from "node:crypto";

import {
  DEFAULT_ACTION,
  writesVersion,
  type ConversationAction,
} from "forge/dist/conversation/actions.js";
import {
  CONVERSATION_CLASSIFY_ID,
  CONVERSATION_CLASSIFY_MAX_TOKENS,
  CONVERSATION_CLASSIFY_VERSION,
  ClassifyInputSchema,
  conversationClassifyBoundary,
  parseClassifyOutput,
  renderClassifyPrompt,
  renderClassifyRepairPrompt,
  type ClassifyOutput,
  type ConversationStateSummary,
} from "forge/dist/conversation/classify.js";
import {
  CONVERSATION_GENERATE_ID,
  CONVERSATION_GENERATE_VERSION,
  conversationGenerateBoundary,
  createEnvelopeStreamReader,
  parseEnvelope,
} from "forge/dist/conversation/generate.js";
import {
  absentDiscoveredRequirements,
  applyDiscoveryUpdate,
  openDiscovery,
  readDiscoveryUpdate,
  unresolvedQuestions,
  type DiscoveryState,
} from "forge/dist/conversation/discovery.js";
import { readIntake, type Intake, type IntakeTarget, type TransformationMode } from "forge/dist/conversation/intake.js";
import { parseStages } from "forge/dist/conversation/stages.js";
import type { LedgerCheckResult } from "forge/dist/critic/deterministic/ledger.js";
import { diagnostic, measureEvidence, type Diagnostic } from "forge/dist/ir/diagnostic.js";
import { sha256Hex, type ModelCallRecord } from "forge/dist/model/provider.js";

import {
  addPromptVersion,
  appendTurnEvent,
  checkLedger,
  currentPrompt,
  governanceState,
  ledgerState,
  recordModelCall,
  resolvePendingClarification,
  type Conversation,
  type PromptVersion,
} from "../store";
import type { TurnDelta, TurnEvent, TurnEventBody, TurnStreamItem } from "./events";

/**
 * WS-R13: one classification, at most one repair of it (WS-R34), one
 * generation, and — on a DISCOVER turn only — at most one repair of the
 * discovery object. Declared, not implied. An explicit generate request, a
 * pasted prompt (WS-R37) and a discovery turn before any prompt exists spend no
 * classification at all.
 */
export const TURN_CALL_BUDGET = 4;

/** What the discovery repair may see of the unusable answer. */
const DISCOVERY_REPAIR_SOURCE_LIMIT = 12_000;
const DISCOVERY_REPAIR_MAX_TOKENS = 4000;

/**
 * What the classifier sees of a long message.
 *
 * A paste can be 200k characters; the boundary's input schema caps at 20k.
 * Choosing which action a message asks for is a job for its opening, not its
 * entirety, and spending a 200k-token classification call to decide between
 * ten labels would break the budget WS-R13 declares. The head is deliberate
 * and bounded, not an accident of a schema limit.
 */
export const CLASSIFY_MESSAGE_LIMIT = 20_000;

/**
 * Raised from 4000 in Product Sprint 1: a reasoning model (qwen3.8-flash) spent
 * all 4000 thinking and returned an empty prompt on a real generate request.
 * The cap bounds cost; it must leave room for the thinking and the answer.
 */
export const CHAT_MAX_TOKENS = 16000;
export const CHAT_TEMPERATURE = 0.7;

export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly model: string;
  readonly latencyMs: number;
  /** Why the model stopped, when the transport reports it (`length`, `stop`, …). */
  readonly finishReason?: string;
}

/** What the generation prompt needs to know beyond the action (§22.11). */
export interface GenerationContext {
  /** WS-R31: the user pressed generate; this is the approved transition. */
  readonly explicitGenerate: boolean;
  /** WS-R32: questions still open when generate was pressed. */
  readonly unresolved: readonly string[];
  /** WS-R38: the transformation mode named for this generate, if any. */
  readonly mode?: TransformationMode | null;
  /** WS-R37: the user asked to skip review, in words FORGE publishes. */
  readonly direct?: boolean;
}

export interface TurnDeps {
  /** Recorded on every call record (WS-R14). */
  readonly providerId: string;
  /** WS-R43: the effort sent with every call of this turn, recorded on its events. */
  readonly reasoningEffort?: string;
  /** WS-R36: the target profiles a pasted prompt's instruction may name. */
  readonly intakeTargets?: readonly IntakeTarget[];
  /** The workspace's system + user prompt for the resolved action. */
  renderGeneration(
    action: ConversationAction,
    message: string,
    context?: GenerationContext,
  ): { system: string; user: string };
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /**
   * The same call, streamed (WS-R10).
   *
   * A generator rather than a callback, so the chunks arrive on the pipeline's
   * own control flow: the pipeline yields each delta the moment it reads one,
   * checks for cancellation between chunks, and closes the transport by
   * returning from the generator. A callback could do none of those three.
   *
   * Optional, because not every provider or protocol streams and a turn that
   * cannot stream must still work. The pipeline falls back to `complete` and
   * records which happened in `TurnResult.streamed`.
   */
  streamComplete?(
    request: CompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<string, CompletionResult>;
}

export interface TurnOptions {
  readonly turnId?: string;
  readonly signal?: AbortSignal;
  /**
   * Re-run the message already at the end of the conversation (V2-B retry).
   *
   * The message is not appended again and the assistant answer it produced is
   * dropped, so a regenerated turn reads as one exchange rather than two. The
   * prompt history is untouched by that drop: versions are immutable and are
   * never removed (WS-R7), so a regenerated REVISE adds a version exactly as
   * the first attempt did.
   */
  readonly regenerate?: boolean;
  /**
   * WS-R31: the explicit generate control. The action is named by the user,
   * not classified — CREATE, or REVISE when a prompt exists — and it is the only
   * way a version is written while discovery is open.
   */
  readonly generate?: boolean;
  /** WS-R38: the transformation mode chosen with the generate control. */
  readonly mode?: TransformationMode;
}

export interface TurnResult {
  readonly turnId: string;
  readonly action: ConversationAction;
  readonly reply: string;
  readonly version: PromptVersion | null;
  /** True when WS-R4 applied: classification failed and DISCUSS was assumed. */
  readonly degraded: boolean;
  /** True when WS-R5 applied: the state could not express the action. */
  readonly refused: boolean;
  readonly cancelled: boolean;
  readonly failed: boolean;
  /** True when the generation call arrived as tokens rather than in one piece. */
  readonly streamed: boolean;
  /** True when this turn re-ran the previous message (WS-R13 retry). */
  readonly regenerated: boolean;
  /** The thrown error, preserved so the caller can build a real diagnostic. */
  readonly error?: unknown;
  /**
   * Layer 1's verdict on the version this turn wrote (WS-R25, WS-R29).
   *
   * Null when the turn wrote no version or the ledger is empty — which is not
   * the same as "nothing was dropped", and is why this is nullable rather than
   * an empty result. Kept separate from `diagnostics` so a caller can never
   * render a deterministic verdict and a judged one as one list (WS-R28).
   */
  readonly preservation: LedgerCheckResult | null;
  /** The conversation's discovery state after the turn (§22.11). */
  readonly discovery: DiscoveryState | null;
  /** WS-R36: how the first message was read, when it was read at all. */
  readonly intake: Intake | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly events: readonly TurnEvent[];
}

/**
 * The ledger was changed while a model call was in flight (WS-R27.4, AC-042).
 *
 * Nothing in this pipeline writes to the ledger, so this cannot be reached by
 * ordinary use — it is a tripwire, and it throws rather than warning because a
 * ledger a model path can edit is not a guarantee at all. A hard error beats a
 * plausible wrong answer.
 */
/**
 * The governance log, an advisory link or the repository binding changed while
 * a model call was in flight (RG-R6, AC-053). The same tripwire as the ledger's:
 * nothing in this pipeline writes any of them, so reaching this means a model
 * path found a way in, and the turn is refused rather than kept.
 */
export class GovernanceTamperedError extends Error {
  constructor() {
    super(
      "Requirement governance changed during a turn. Only a user action may record a decision, " +
        "assert a link or bind a repository (RG-R6); the turn was refused.",
    );
    this.name = "GovernanceTamperedError";
  }
}

export class LedgerTamperedError extends Error {
  constructor() {
    super(
      "The requirement ledger changed during a turn. Only a user action may add, edit, " +
        "remove or unpin an entry (WS-R27.4); the turn was refused.",
    );
    this.name = "LedgerTamperedError";
  }
}

/**
 * What each stage says to the user.
 *
 * Written in the user's terms, not FORGE's: "Adapting for target" is
 * something they chose in the header, and "Verifying result" is the WS-R3
 * check they benefit from. None of them is a spinner, and none of them can
 * carry model output (WS-R11).
 */
const STAGE_LABELS = {
  classifying: "Understanding request…",
  reading_prompt: "Analyzing current prompt…",
  adapting: "Adapting for target…",
  generating: "Generating prompt…",
  verifying: "Verifying result…",
  saving: "Saving…",
} as const;

/** A read-only action produces an answer, not a prompt. Say the true thing. */
const DISCUSSION_GENERATING_LABEL = "Writing your answer…";

/** Thrown to unwind the turn when the caller aborted (WS-R12). */
class TurnCancelled extends Error {}

export function conversationState(convo: Conversation): ConversationStateSummary {
  return {
    hasCurrentPrompt: currentPrompt(convo) !== null,
    versions: convo.promptVersions.map((p) => p.v).sort((a, b) => a - b),
    candidateCount: convo.candidates.length,
    hasPendingClarification: convo.pendingClarification !== null,
    discoveryOpen: convo.discovery?.status === "open",
  };
}

function callRecord(
  boundaryId: string,
  boundaryVersion: string,
  providerId: string,
  result: CompletionResult,
  prompt: string,
): ModelCallRecord {
  return {
    boundaryId,
    boundaryVersion,
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
 * Run one turn, emitting every event as it happens.
 *
 * The user's message is appended first and is never taken back: a failed or
 * cancelled turn loses the turn, not the message (WS-R12).
 */
export async function* runTurn(
  convo: Conversation,
  message: string,
  deps: TurnDeps,
  options: TurnOptions = {},
): AsyncGenerator<TurnStreamItem, TurnResult> {
  const turnId = options.turnId ?? randomUUID();
  const regenerated = options.regenerate === true;
  const diagnostics: Diagnostic[] = [];
  const emitted: TurnEvent[] = [];
  /**
   * WS-R27.4 / AC-042. Taken before anything model-shaped happens and checked
   * again after every model call and before the turn ends.
   */
  const ledgerAtStart = ledgerState(convo);
  const governanceAtStart = governanceState(convo);

  const push = (body: TurnEventBody): TurnEvent => {
    const event = appendTurnEvent(convo, { turnId, ...body });
    emitted.push(event);
    return event;
  };

  const checkCancelled = (): void => {
    if (options.signal?.aborted) throw new TurnCancelled();
  };

  const checkLedgerIntact = (): void => {
    if (ledgerState(convo) !== ledgerAtStart) throw new LedgerTamperedError();
    if (governanceState(convo) !== governanceAtStart) throw new GovernanceTamperedError();
  };

  const note = (finding: Diagnostic): void => {
    diagnostics.push(finding);
    push({ kind: "diagnostic", diagnostic: finding });
  };

  const result = (over: Partial<TurnResult>): TurnResult => ({
    turnId,
    action: DEFAULT_ACTION,
    reply: "",
    version: null,
    degraded: false,
    refused: false,
    cancelled: false,
    failed: false,
    streamed: false,
    regenerated,
    preservation: null,
    discovery: convo.discovery,
    intake: null,
    diagnostics,
    events: emitted,
    ...over,
  });

  if (regenerated) {
    // Drop only the answer being replaced. The user's message stays where it
    // was, so the retry reads as one exchange; versions are never removed.
    while (convo.messages.at(-1)?.role === "assistant") convo.messages.pop();
    yield push({ kind: "turn_started", message, regenerated: true });
  } else {
    convo.messages.push({ role: "user", content: message, at: new Date().toISOString() });
    yield push({ kind: "turn_started", message });
    yield push({ kind: "message_appended", role: "user" });
  }

  try {
    checkCancelled();

    // ── Resolve the action ────────────────────────────────────────────────
    yield push({ kind: "stage", stage: "classifying", label: STAGE_LABELS.classifying });
    const state = conversationState(convo);

    let action: ConversationAction = DEFAULT_ACTION;
    let cited: readonly number[] = [];
    let degraded = false;
    let unsupported: readonly string[] = [];
    let unresolved: string[] = [];

    // ── Intake (WS-R36, WS-R37) ───────────────────────────────────────────
    //
    // A first message that is a developed prompt is read by a pure function,
    // not asked of a model: its shape and its words are facts, and a paste the
    // classifier sees is a paste that can argue with the classifier.
    const intake: Intake | null =
      !regenerated && options.generate !== true && !state.hasCurrentPrompt && convo.discovery === null
        ? readIntake(message, deps.intakeTargets ?? [])
        : null;
    const direct = intake?.kind === "existing_prompt" && intake.direct;
    const explicitGenerate = options.generate === true || direct;
    const mode: TransformationMode | null = options.mode ?? (direct ? (intake?.mode ?? "strengthen") : null);

    if (explicitGenerate) {
      // WS-R31: the user named the transition — with the control, or (WS-R37)
      // in words FORGE publishes. No model decides it, so no classification
      // call is spent and none can overrule it.
      action = state.hasCurrentPrompt ? "REVISE" : "CREATE";
      unresolved = convo.discovery?.status === "open" ? unresolvedQuestions(convo.discovery) : [];
      yield push({ kind: "action_resolved", action, degraded: false, explicit: true });
      if (unresolved.length > 0) {
        note(
          diagnostic(
            "FORGE-W010",
            `Generating with ${unresolved.length} unresolved question(s); each is stated as an assumption in the prompt: ` +
              unresolved.map((q) => `"${q}"`).join("; "),
            [measureEvidence("unresolved_questions", unresolved.length, "questions")],
          ),
        );
      }
      if (direct && intake) {
        const choices: string[] = [`mode ${mode}${intake.mode ? " (named in your message)" : " (FORGE's default)"}`];
        if (intake.target && intake.target !== convo.target) {
          choices.push(`target changed from ${convo.target} to ${intake.target} (named in your message)`);
          convo.target = intake.target;
        } else {
          choices.push(`target ${convo.target}`);
        }
        choices.push(
          convo.artifactKind === "unspecified"
            ? "artifact kind not chosen — the model states which it assumed"
            : `artifact kind ${convo.artifactKind}`,
        );
        choices.push(`output shape ${convo.outputShape}`);
        note(
          diagnostic(
            "FORGE-W012",
            `You asked to skip review, so FORGE wrote the prompt directly with these choices: ${choices.join("; ")}. Change any of them and generate again if they are wrong.`,
            [measureEvidence("assumed_choices", choices.length, "choices")],
          ),
        );
      }
    } else if (intake?.kind === "existing_prompt") {
      // WS-R37: a pasted prompt already did the discovery. Refine discovery
      // asks at most two material questions, and no classification is spent.
      action = "DISCOVER";
      convo.discovery = openDiscovery("refine");
      yield push({ kind: "action_resolved", action, degraded: false });
    } else if (state.discoveryOpen && !state.hasCurrentPrompt) {
      // WS-R31: with discovery open and no prompt, every action the state can
      // express resolves to DISCOVER, so asking a model would only add latency
      // and a failure mode. The answer is deterministic; no call is spent.
      action = "DISCOVER";
      yield push({ kind: "action_resolved", action, degraded: false });
    } else {
      const classifyCalls: CompletionResult[] = [];
      try {
        const classifyInput = ClassifyInputSchema.parse({
          message: message.slice(0, CLASSIFY_MESSAGE_LIMIT),
          state,
        });
        const ask = async (prompt: string): Promise<CompletionResult> => {
          let response: CompletionResult;
          try {
            response = await deps.complete({
              system: "You are FORGE's conversation-action classifier.",
              user: prompt,
              maxTokens: CONVERSATION_CLASSIFY_MAX_TOKENS,
              temperature: 0,
            });
          } catch (error) {
            push({
              kind: "model_call_failed",
              boundaryId: CONVERSATION_CLASSIFY_ID,
              reason: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          classifyCalls.push(response);
          recordModelCall(
            convo,
            callRecord(CONVERSATION_CLASSIFY_ID, CONVERSATION_CLASSIFY_VERSION, deps.providerId, response, prompt),
          );
          checkCancelled();
          checkLedgerIntact();
          return response;
        };
        const first = await ask(renderClassifyPrompt(classifyInput));
        let output: ClassifyOutput;
        try {
          output = parseClassifyOutput(first.text);
        } catch (firstError) {
          if (!(firstError instanceof Error) || firstError.name !== "ClassificationError") throw firstError;
          // WS-R34: exactly one repair, stating the error and the shape.
          const repaired = await ask(renderClassifyRepairPrompt(classifyInput, firstError.message));
          try {
            output = parseClassifyOutput(repaired.text);
          } catch (secondError) {
            throw new Error(
              `${firstError.message} After one repair: ${secondError instanceof Error ? secondError.message : String(secondError)}`,
            );
          }
        }
        action = output.action;
        cited = output.versions;
        // The boundary's own post-validators, run where the answer arrives.
        unsupported = conversationClassifyBoundary.postValidators.flatMap((validate) =>
          validate(classifyInput, output),
        );
      } catch (error) {
        if (error instanceof TurnCancelled) throw error;
        if (error instanceof LedgerTamperedError || error instanceof GovernanceTamperedError) throw error;
        // WS-R4: the least destructive action, never "let the model decide".
        degraded = true;
        action = DEFAULT_ACTION;
        cited = [];
        unsupported = [];
        note(
          diagnostic(
            "FORGE-W001",
            `Action classification failed (${error instanceof Error ? error.message : String(error)}); the turn was treated as DISCUSS and no prompt version was written.`,
            [measureEvidence("classification_failures", 1, "calls")],
          ),
        );
      }
      for (const response of classifyCalls) {
        yield push({
          kind: "model_call",
          boundaryId: CONVERSATION_CLASSIFY_ID,
          model: response.model,
          latencyMs: response.latencyMs,
          ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
        });
      }

      // ── The discovery gate (WS-R31) ──────────────────────────────────────
      //
      // While discovery is open, nothing a classifier says writes a version.
      // A write it proposed is refused loudly; a plain discussion or answer is
      // simply more discovery.
      let gatedFrom: ConversationAction | undefined;
      if (state.discoveryOpen && ["CREATE", "REVISE", "DISCUSS", "CLARIFY"].includes(action)) {
        if (writesVersion(action)) {
          gatedFrom = action;
          note(
            diagnostic(
              "FORGE-W011",
              `The message was classified ${action}, but discovery is still open, so it was treated as DISCOVER and no prompt was written. Press Generate when you want the prompt.`,
              [measureEvidence("gated_writes", 1, "writes")],
            ),
          );
        }
        action = "DISCOVER";
        unsupported = [];
      }
      if (action === "DISCOVER" && convo.discovery?.status !== "open") {
        // Opening (or reopening) discovery keeps whatever was already learnt.
        convo.discovery = convo.discovery ? { ...convo.discovery, status: "open" } : openDiscovery();
      }
      yield push({ kind: "action_resolved", action, degraded, ...(gatedFrom ? { gatedFrom } : {}) });
    }

    // ── Refuse what the state cannot express (WS-R5) ──────────────────────
    if (unsupported.length > 0) {
      const reason = unsupported.join(" ");
      note(
        diagnostic("FORGE-W002", `${action} was refused: ${reason}`, [
          measureEvidence("addressable_artifacts", state.versions.length + state.candidateCount, "artifacts"),
        ]),
      );
      yield push({ kind: "action_refused", action, reason });
      const reply = `I can't ${action.toLowerCase()} here. ${reason}`;
      convo.messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });
      yield push({ kind: "message_appended", role: "assistant" });
      yield push({ kind: "turn_completed", action, versionCreated: false });
      return result({ action, reply, refused: true, degraded });
    }

    // ── RESTORE is deterministic: move the pointer, spend no model call ────
    if (action === "RESTORE") {
      const target = cited[0] as number;
      convo.currentV = target;
      yield push({ kind: "current_version_moved", v: target });
      const reply = `Restored version ${target}. It is the current prompt again; nothing was rewritten.`;
      convo.messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });
      yield push({ kind: "message_appended", role: "assistant" });
      yield push({ kind: "turn_completed", action, versionCreated: false });
      return result({ action, reply, degraded });
    }

    if (action === "CLARIFY") {
      const resolved = resolvePendingClarification(convo, message, turnId);
      if (resolved) yield push({ kind: "clarification_resolved", question: resolved.question });
    }

    // ── Read the prompt being worked on, and the target being adapted to ──
    checkCancelled();
    yield push({ kind: "stage", stage: "reading_prompt", label: STAGE_LABELS.reading_prompt });
    if (convo.target && convo.target !== "generic") {
      yield push({ kind: "stage", stage: "adapting", label: STAGE_LABELS.adapting });
    }

    // ── Generate ──────────────────────────────────────────────────────────
    checkCancelled();
    yield push({
      kind: "stage",
      stage: "generating",
      label: writesVersion(action) ? STAGE_LABELS.generating : DISCUSSION_GENERATING_LABEL,
    });
    const rendered = deps.renderGeneration(action, message, { explicitGenerate, unresolved, mode, direct });
    const request: CompletionRequest = {
      system: rendered.system,
      user: rendered.user,
      maxTokens: CHAT_MAX_TOKENS,
      temperature: CHAT_TEMPERATURE,
    };

    // Streaming is presentation. The deltas below are what the user sees; the
    // envelope is still read from the accumulated text after the call, so the
    // artifact never depends on how the network chopped the answer (WS-R10).
    let response: CompletionResult;
    let streamed = false;
    if (deps.streamComplete) {
      const reader = createEnvelopeStreamReader();
      const stream = deps.streamComplete(request, options.signal);
      try {
        let next = await stream.next();
        while (!next.done) {
          for (const delta of reader.push(next.value)) {
            const item: TurnDelta = {
              kind: delta.field === "reply" ? "reply_delta" : "prompt_delta",
              turnId,
              text: delta.text,
            };
            yield item;
          }
          // Between chunks is where a cancel can be honoured promptly. The
          // partial text is simply dropped: nothing has been written yet.
          checkCancelled();
          next = await stream.next();
        }
        response = next.value;
      } finally {
        // Closes the transport whether the turn finished, failed or was
        // cancelled, so an abandoned stream leaves no open request behind.
        await stream.return(undefined as never).catch(() => undefined);
      }
      streamed = true;
    } else {
      response = await deps.complete(request);
    }
    recordModelCall(
      convo,
      callRecord(
        CONVERSATION_GENERATE_ID,
        CONVERSATION_GENERATE_VERSION,
        deps.providerId,
        response,
        `${action}\n${rendered.system}\n${rendered.user}`,
      ),
    );
    yield push({
      kind: "model_call",
      boundaryId: CONVERSATION_GENERATE_ID,
      model: response.model,
      latencyMs: response.latencyMs,
      ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
    });
    checkCancelled();
    checkLedgerIntact();

    // An empty completion is a failure, not an answer. Recording it as a
    // blank assistant message told the user nothing and looked like success;
    // failing the turn keeps their message, writes nothing, and puts the
    // reason on screen (WS-R12, INV-012). Unreadable but NON-empty text is a
    // different case and still degrades to chat below (FORGE-W003).
    if (response.text.trim().length === 0) {
      throw new Error(
        response.finishReason === "length"
          ? `The model (${response.model}) used its whole output budget (${CHAT_MAX_TOKENS} tokens) without ` +
              "writing an answer — reasoning models can spend it all thinking. Nothing was written; retry, " +
              "or choose a model with a larger output limit."
          : `The model (${response.model}) returned an empty response${
              response.finishReason ? ` (finish reason: ${response.finishReason})` : ""
            }, so nothing was written. Check the model ID and the provider account, then retry.`,
      );
    }

    yield push({ kind: "stage", stage: "verifying", label: STAGE_LABELS.verifying });
    const envelope = parseEnvelope(response.text);
    let reply: string;
    let proposed: string | null;
    if (envelope === null) {
      // INV-012: degradation is never silent. The prose is still useful; a
      // response FORGE could not read can never become a version.
      reply = response.text.trim();
      proposed = null;
      note(
        diagnostic(
          "FORGE-W003",
          "The response was not a readable FORGE envelope, so it was kept as chat and no prompt version was written.",
          [measureEvidence("unreadable_responses", 1, "responses")],
        ),
      );
    } else {
      reply = envelope.reply;
      proposed = envelope.prompt;
      const problems = conversationGenerateBoundary.postValidators.flatMap((validate) =>
        validate({ action, system: rendered.system, user: rendered.user }, envelope),
      );
      if (problems.length > 0) {
        // WS-R3: the label is unverifiable; the effect is not. Blocking the
        // write is the enforcement, and it is loud (INV-012).
        proposed = null;
        note(
          diagnostic("FORGE-W004", `A prompt write was blocked: ${problems.join(" ")}`, [
            measureEvidence("blocked_version_writes", 1, "writes"),
          ]),
        );
      }
    }

    // ── Discovery state (WS-R30) ──────────────────────────────────────────
    if (action === "DISCOVER") {
      let { update, problem } = readDiscoveryUpdate(response.text);
      if (update === null) {
        // WS-R34 applied to discovery: ONE bounded repair, which may return
        // only the discovery object. The reply the user already saw stays;
        // nothing a repair returns can become a version (DISCOVER is read-only).
        const firstProblem = problem;
        const repairPrompt = renderDiscoveryRepairPrompt(response.text, firstProblem ?? "invalid");
        const repaired = await deps.complete({
          system: "You are FORGE's discovery formatter. You return JSON only.",
          user: repairPrompt,
          maxTokens: DISCOVERY_REPAIR_MAX_TOKENS,
          temperature: 0,
        });
        recordModelCall(convo, {
          ...callRecord(CONVERSATION_GENERATE_ID, CONVERSATION_GENERATE_VERSION, deps.providerId, repaired, repairPrompt),
          repairs: 1,
        });
        yield push({
          kind: "model_call",
          boundaryId: CONVERSATION_GENERATE_ID,
          model: repaired.model,
          latencyMs: repaired.latencyMs,
          repair: true,
          ...(deps.reasoningEffort ? { reasoningEffort: deps.reasoningEffort } : {}),
        });
        checkCancelled();
        checkLedgerIntact();
        ({ update, problem } = readDiscoveryUpdate(repaired.text));
        if (update === null) problem = `${firstProblem}; after one repair: ${problem}`;
      }
      if (update !== null) {
        convo.discovery = applyDiscoveryUpdate(convo.discovery ?? openDiscovery(), update);
        yield push({
          kind: "discovery_updated",
          status: "open",
          questions: update.questions.length,
          ready: update.ready,
        });
      } else {
        note(
          diagnostic(
            "FORGE-W003",
            `The discovery update was unusable (${problem}), so the brief was left unchanged.`,
            [measureEvidence("unreadable_discovery_updates", 1, "responses")],
          ),
        );
      }
    }

    // ── Apply (WS-R2) ─────────────────────────────────────────────────────
    yield push({ kind: "stage", stage: "saving", label: STAGE_LABELS.saving });
    let version: PromptVersion | null = null;
    const before = currentPrompt(convo);
    if (proposed !== null && proposed !== before && writesVersion(action)) {
      version = addPromptVersion(convo, proposed, "model", {
        action,
        turnId,
        ...(mode ? { mode } : {}),
        shape: convo.outputShape,
      });
      yield push({ kind: "version_created", v: version.v, action });
      if (convo.outputShape === "staged") {
        // WS-R40: a staged version is still one version. If it does not parse,
        // it is shown as one prompt and the reason is named — never repaired.
        const parsed = parseStages(version.text);
        if (!parsed.ok) {
          note(
            diagnostic(
              "FORGE-W013",
              `Staged output was requested, but version ${version.v} is not readable as stages: ${parsed.reason}. It is shown as one prompt.`,
              [measureEvidence("stage_parse_failures", 1, "versions")],
            ),
          );
        }
      }
    }

    // ── Discovery coverage and close (WS-R31, WS-R33) ─────────────────────
    if (version !== null && explicitGenerate && convo.discovery !== null) {
      const absent = absentDiscoveredRequirements(convo.discovery.brief, version.text);
      if (absent.length > 0) {
        // WS-R33 (amended): one finding naming every absent item, not one per
        // item — a wall of near-identical warnings is noise, and noise is how
        // a real drop gets ignored.
        note(
          diagnostic(
            "FORGE-W009",
            `${absent.length} discovered item(s) are not covered by version ${version.v} (at least 80% of an item's content words must appear): ` +
              absent.map((item) => `${item.field} "${item.text}"`).join("; ") +
              ". They may be paraphrased or dropped; check them.",
            [measureEvidence("absent_discovered_requirements", absent.length, "items")],
          ),
        );
      }
      if (convo.discovery.status === "open") {
        convo.discovery = { ...convo.discovery, status: "generated", questions: [], ready: false };
        yield push({ kind: "discovery_updated", status: "generated", questions: 0, ready: false });
      }
    }

    // ── Layer 1: the requirement ledger (WS-R25, WS-R29) ──────────────────
    //
    // Deterministic, model-free, and run on every version that has a
    // non-empty ledger. The version is NOT withdrawn when a pinned
    // requirement is missing: versions are immutable and never removed
    // (WS-R7), and hiding the revision would hide the evidence. What FORGE
    // owes the user here is to say so, loudly, as an error (INV-012).
    let preservation: LedgerCheckResult | null = null;
    if (version !== null && convo.ledger.length > 0) {
      preservation = checkLedger(convo, version.v);
      yield push({
        kind: "preservation_checked",
        v: version.v,
        pinned: preservation.findings.length,
        missing: preservation.diagnostics.length,
      });
      for (const finding of preservation.diagnostics) note(finding);
    }
    checkLedgerIntact();

    convo.messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });
    yield push({ kind: "message_appended", role: "assistant" });
    yield push({ kind: "turn_completed", action, versionCreated: version !== null });
    return result({ action, reply, version, degraded, streamed, preservation, discovery: convo.discovery, intake });
  } catch (error) {
    // WS-R12: a cancelled turn and a failed turn end in the same place. The
    // user's message stays; no assistant message and no version are written.
    if (error instanceof TurnCancelled) {
      yield push({ kind: "turn_cancelled" });
      return result({ cancelled: true });
    }
    yield push({ kind: "turn_failed", reason: error instanceof Error ? error.message : String(error) });
    return result({ failed: true, error });
  }
}

/** Drain the pipeline. V2-B streams the same events instead of collecting them. */
export async function executeTurn(
  convo: Conversation,
  message: string,
  deps: TurnDeps,
  options: TurnOptions = {},
): Promise<TurnResult> {
  const iterator = runTurn(convo, message, deps, options);
  let next = await iterator.next();
  while (!next.done) next = await iterator.next();
  return next.value;
}

/**
 * The one discovery repair (WS-R34 applied to §22.11). It states the error and
 * the required shape, quotes the unusable answer as data, and asks for the
 * discovery object alone — so a repair cannot carry a prompt, a reply or
 * anything else back into the turn.
 */
export function renderDiscoveryRepairPrompt(previous: string, problem: string): string {
  return [
    "Your previous answer's `discovery` object could not be used.",
    `Problem: ${problem}`,
    "",
    "Return ONLY one JSON object of exactly this shape — no prose, no fences:",
    '{"discovery": {"brief": {"goal": "...", "constraints": ["..."], "success_criteria": ["..."], "open_questions": ["..."]}, "questions": [{"question": "...", "options": ["..."]}], "ready": false, "research_needed": null, "artifact_kind": null}}',
    "Rules: brief fields are optional strings or string lists (at most 12 items, 600 characters each); at most 3 questions with at most 8 options each; ready is true or false; research_needed and artifact_kind are null, or a string (artifact_kind: \"agent\" or \"builder\").",
    "",
    "Your previous answer, as data:",
    "<<<PREVIOUS",
    previous.slice(0, DISCOVERY_REPAIR_SOURCE_LIMIT),
    "PREVIOUS>>>",
  ].join("\n");
}

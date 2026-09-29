/**
 * How the turn pipeline reaches a model, and the stand-in that replaces it
 * offline.
 *
 * This lived in the messages route until V2-B gave the product a second
 * entry point (the SSE stream). Two routes composing the same system prompt
 * by copy would be two chances to drift, and AD-19 is explicit that streaming
 * and cancellation must not be implemented twice. So the seam is one module,
 * and the routes own HTTP only.
 */
import { generate, generateStream } from "@/lib/ai-provider";
import { buildSystemPrompt } from "@/lib/chat";
import { getTargetBrief, ProviderError, resolveCall, transportFor } from "@/lib/forge";
import type { Conversation } from "@/lib/store";
import { renderBrief } from "forge/dist/conversation/discovery.js";
import type { CompletionResult, TurnDeps } from "@/lib/turn/pipeline";
import type { TransportSpec } from "@/lib/ai-provider";
import type { ReasoningRequest } from "@/lib/reasoning";
import { intakeTargets } from "@/lib/intake-targets";


const ATTACH_BUDGET = 100_000;

/**
 * The live seam.
 *
 * `streamComplete` is a generator whose chunks are pushed into a queue by the
 * SDK callback and pulled out here, because the SDK hands text to a callback
 * and the pipeline wants to iterate. The queue is bounded by nothing but the
 * response itself, which is already bounded by `maxOutputTokens`.
 */
export function buildDeps(convo: Conversation, before: string | null, reasoning?: ReasoningRequest): TurnDeps {
  const call = resolveCall(convo.provider, convo.model || undefined);
  let budget = ATTACH_BUDGET;
  const attachments = convo.attachments.map((a) => {
    const full = convo.attachmentContents[a.name] ?? "";
    const excerpt = full.length > budget ? full.slice(0, budget) : full;
    budget = Math.max(0, budget - excerpt.length);
    return { name: a.name, excerpt, truncated: excerpt.length < full.length };
  });
  // The conversation id IS the session: stable across every turn, retry and
  // revision of this conversation, and unique to it.
  const spec: TransportSpec = { ...transportFor(call, convo.id), ...(reasoning ? { reasoning } : {}) };

  return {
    providerId: call.providerId,
    ...(reasoning ? { reasoningEffort: reasoning.effort } : {}),
    intakeTargets: intakeTargets(),
    renderGeneration: (action, message, context) => {
      // Read at render time: a direct intake may have changed the target
      // after these deps were built (WS-R37).
      const brief = getTargetBrief(convo.target);
      const history = convo.messages
        .slice(0, -1)
        .slice(-20)
        .map((m) => `${m.role === "user" ? "User" : "FORGE"}: ${m.content}`)
        .join("\n\n");
      return {
        system: buildSystemPrompt({
          target: brief,
          targetId: convo.target,
          currentPrompt: before,
          currentVersion: convo.currentV,
          attachments,
          isFirstTurn: convo.messages.length <= 1,
          action,
          discovery: convo.discovery,
          artifactKind: convo.artifactKind,
          outputShape: convo.outputShape,
          ...(context ? { generation: context } : {}),
        }),
        user: history ? `${history}\n\nUser: ${message}` : message,
      };
    },
    complete: async (request) => {
      const response = await generate(spec, {
        system: request.system,
        prompt: request.user,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      return {
        text: response.text,
        model: response.modelId,
        latencyMs: response.latencyMs,
        ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
      };
    },
    async *streamComplete(request, signal) {
      const chunks: string[] = [];
      let notify: (() => void) | null = null;
      let done = false;
      let failure: unknown = null;

      const finished = generateStream(spec, {
        system: request.system,
        prompt: request.user,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        ...(signal ? { signal } : {}),
        onChunk: (text) => {
          chunks.push(text);
          notify?.();
        },
      }).then(
        (value) => {
          done = true;
          notify?.();
          return value;
        },
        (error: unknown) => {
          failure = error;
          done = true;
          notify?.();
          throw error;
        },
      );
      // Errors are surfaced by rethrowing below; this keeps the rejection from
      // being unhandled while the consumer is still draining chunks.
      finished.catch(() => undefined);

      while (true) {
        while (chunks.length > 0) yield chunks.shift() as string;
        if (done) break;
        await new Promise<void>((resolve) => {
          notify = () => {
            notify = null;
            resolve();
          };
        });
      }
      if (failure !== null) throw failure;
      const response = await finished;
      const result: CompletionResult = {
        text: response.text,
        model: response.modelId,
        latencyMs: response.latencyMs,
        ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
      };
      return result;
    },
  };
}

/**
 * How the stand-in model rewrites a prompt.
 *
 * It behaves the way the cheapest honest model would: it keeps what is there
 * and appends the change, unless the user asked for something to be taken out,
 * in which case it takes the matching lines out. That asymmetry is what makes
 * requirement preservation testable offline — a preserving revision and a
 * dropping one are both reachable without a network — and it is a property of
 * the *instruction*, not a switch FORGE flips to make a test pass.
 */
const REMOVAL = /\b(remove|drop|delete|without|no longer|get rid of)\b/i;

function revise(before: string | null, asked: string): string {
  if (!before) return `Stub prompt v1 — created from: ${asked}`;
  if (!REMOVAL.test(asked)) return `${before}\nStub revision: ${asked}`;
  const drop = asked
    .replace(/.*\b(remove|drop|delete|without|no longer|get rid of)\b/i, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 3);
  const kept = before
    .split("\n")
    .filter((line) => !drop.some((word) => line.toLowerCase().includes(word)));
  return `${kept.join("\n")}\nStub revision: ${asked}`;
}

/**
 * A stand-in model for the offline product suite. It is a fake MODEL, not a
 * second classifier: FORGE's own classification path runs unchanged over its
 * answer, which is the point of testing through it.
 *
 * It streams in small pieces because that is the shape the streaming route
 * has to survive — an envelope split across chunk boundaries.
 */
/**
 * Asking the stub for an unreadable response. Only the stub reads it; a real
 * provider never sees it treated as anything but part of the user's message.
 */
export const STUB_UNREADABLE_SENTINEL = "[[forge:stub-unreadable]]";
/** Makes the stub stop at its output limit mid-prompt, as a live model can. */
export const STUB_OUTPUT_LIMIT_SENTINEL = "[[forge:stub-output-limit]]";

export function stubDeps(convo: Conversation, before: string | null): TurnDeps {
  const answer = (request: { system: string; user: string }): CompletionResult => {
    if (process.env["FORGE_CHAT_STUB"] === "error") {
      throw new ProviderError("Stub provider failure (FORGE_CHAT_STUB=error).", "stub");
    }
    if (request.user.includes("Classify the user's message")) {
      const message = request.user.slice(request.user.lastIndexOf("USER MESSAGE:"));
      // The stub has no judgement, so it reads one plain signal: a user who says
      // they do not know what they want is discovering. Production reads none
      // of this — the classifier model decides (§22.11).
      const unsure = /\b(not sure|don't know|do not know|no idea|unsure)\b/i.test(message);
      const action = unsure ? "DISCOVER" : message.trimEnd().endsWith("?") ? "EXPLAIN" : before ? "REVISE" : "CREATE";
      return { text: JSON.stringify({ action, versions: [] }), model: "stub", latencyMs: 0 };
    }
    if (request.system.startsWith("stub:DISCOVER")) return stubDiscovery(convo, request.user);
    const asked = request.user.slice(-80);
    // A degraded turn has to be reachable offline, or the only place
    // FORGE-W003 can be seen is a live provider misbehaving — which is not
    // something a test can arrange. The sentinel makes the stub answer with
    // prose instead of an envelope: non-empty, useful to read, and impossible
    // to turn into a version. That is the exact shape `pipeline.ts` degrades
    // on, so R4 exercises the real path rather than a mock of it.
    if (request.user.includes(STUB_OUTPUT_LIMIT_SENTINEL)) {
      return {
        text: '{"reply": "I wrote the full prompt.", "prompt": "You are a careful agent. Always',
        model: "stub",
        latencyMs: 0,
        finishReason: "length",
      };
    }
    if (request.user.includes(STUB_UNREADABLE_SENTINEL)) {
      return {
        text: "Here is my answer in plain prose, with no envelope around it.",
        model: "stub",
        latencyMs: 0,
      };
    }
    return {
      text: JSON.stringify({ reply: `Stub reply to: ${asked}`, prompt: withBrief(revise(before, asked), request.system) }),
      model: "stub",
      latencyMs: 0,
    };
  };

  return {
    providerId: "stub",
    intakeTargets: intakeTargets(),
    renderGeneration: (action, message, context) => {
      // The stub is a model, so what it "was told" travels the way a model's
      // instruction does: as lines the stand-in carries into its answer.
      const told = [
        ...(context?.explicitGenerate && convo.discovery ? renderBrief(convo.discovery.brief) : []),
        ...(context?.explicitGenerate && context.unresolved.length > 0
          ? ["Assumptions:", ...context.unresolved.map((q) => `- ${q}`)]
          : []),
        ...(context?.mode ? [`Mode: ${context.mode}`] : []),
        ...(convo.outputShape === "staged" && context?.explicitGenerate !== undefined && action !== "DISCOVER" ? ["[[staged]]"] : []),
      ];
      return { system: [`stub:${action}`, ...told].join("\n"), user: message };
    },
    complete: async (request) => answer(request),
    async *streamComplete(request, signal) {
      const result = answer(request);
      // A real stream is not synchronous; neither is this one, so the
      // consumer's cancellation window is real in the offline suite too.
      // The delay is tunable because a browser run needs a stream slow enough
      // for a human (or a screenshot) to catch mid-flight.
      const delay = Number(process.env["FORGE_CHAT_STUB_DELAY_MS"] ?? "1");
      for (let at = 0; at < result.text.length; at += 24) {
        if (signal?.aborted) break;
        yield result.text.slice(at, at + 24);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      return result;
    },
  };
}

/** The stub carries the discovered brief into a generated prompt, as a good model would. */
function withBrief(prompt: string, system: string): string {
  const [, ...told] = system.split("\n");
  const staged = told.includes("[[staged]]");
  const lines = told.filter((l) => l !== "[[staged]]");
  const body = lines.length > 0 ? `${prompt}\n${lines.join("\n")}` : prompt;
  // WS-R40: a staged request gets the published form, so the stage parser and
  // the per-stage carry are exercised offline on the real path.
  return staged ? `## Stage 1 — Plan\nDepends on: none\n${body}\n\n## Stage 2 — Build\nDepends on: Stage 1\n${body}` : body;
}

/**
 * The stub's discovery turn (§22.11). Deterministic, and adaptive in the one
 * way a test can check: each question quotes the answer it follows, and the
 * brief grows by what the user said.
 */
function stubDiscovery(convo: Conversation, user: string): CompletionResult {
  const previous = convo.discovery?.brief ?? {};
  const answer = user.trim().split("\n").at(-1)!.slice(0, 200);
  const turns = convo.discovery?.turns ?? 0;
  const brief = {
    ...previous,
    goal: previous.goal ?? answer,
    ...(turns > 0 ? { constraints: [...(previous.constraints ?? []), answer] } : {}),
    open_questions: ["Who exactly will use it?"],
  };
  const questions =
    turns === 0
      ? [{ question: "What is your main goal?", options: ["Save time", "Make money", "Build for my company", "Research / learning"] }]
      : [{ question: `You said "${answer.slice(0, 60)}". Who exactly will use it?`, options: [] }];
  return {
    text: JSON.stringify({
      reply: `Let's work out what to build. ${questions[0]!.question}`,
      prompt: null,
      discovery: { brief, questions, ready: turns >= 1, research_needed: null },
    }),
    model: "stub",
    latencyMs: 0,
  };
}

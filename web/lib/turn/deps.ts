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
import type { CompletionResult, TurnDeps } from "@/lib/turn/pipeline";

const ATTACH_BUDGET = 100_000;

/**
 * The live seam.
 *
 * `streamComplete` is a generator whose chunks are pushed into a queue by the
 * SDK callback and pulled out here, because the SDK hands text to a callback
 * and the pipeline wants to iterate. The queue is bounded by nothing but the
 * response itself, which is already bounded by `maxOutputTokens`.
 */
export function buildDeps(convo: Conversation, before: string | null): TurnDeps {
  const call = resolveCall(convo.provider, convo.model || undefined);
  const brief = getTargetBrief(convo.target);
  let budget = ATTACH_BUDGET;
  const attachments = convo.attachments.map((a) => {
    const full = convo.attachmentContents[a.name] ?? "";
    const excerpt = full.length > budget ? full.slice(0, budget) : full;
    budget = Math.max(0, budget - excerpt.length);
    return { name: a.name, excerpt, truncated: excerpt.length < full.length };
  });
  // The conversation id IS the session: stable across every turn, retry and
  // revision of this conversation, and unique to it.
  const spec = transportFor(call, convo.id);

  return {
    providerId: call.providerId,
    renderGeneration: (action, message) => {
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
      });
      return { text: response.text, model: response.modelId, latencyMs: response.latencyMs };
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
export function stubDeps(convo: Conversation, before: string | null): TurnDeps {
  const answer = (request: { user: string }): CompletionResult => {
    if (process.env["FORGE_CHAT_STUB"] === "error") {
      throw new ProviderError("Stub provider failure (FORGE_CHAT_STUB=error).", "stub");
    }
    if (request.user.includes("Classify the user's message")) {
      const message = request.user.slice(request.user.lastIndexOf("USER MESSAGE:"));
      const action = message.trimEnd().endsWith("?") ? "EXPLAIN" : before ? "REVISE" : "CREATE";
      return { text: JSON.stringify({ action, versions: [] }), model: "stub", latencyMs: 0 };
    }
    const asked = request.user.slice(-80);
    return {
      text: JSON.stringify({ reply: `Stub reply to: ${asked}`, prompt: revise(before, asked) }),
      model: "stub",
      latencyMs: 0,
    };
  };

  return {
    providerId: "stub",
    renderGeneration: (action, message) => ({ system: `stub:${action}`, user: message }),
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

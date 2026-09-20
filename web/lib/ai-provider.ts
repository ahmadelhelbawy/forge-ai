/**
 * Model transport, delegated to the official Vercel AI SDK providers.
 *
 * FORGE's own raw-fetch provider stays in the core for the CLI; the web app
 * routes through maintained SDK adapters so protocol details (Responses vs
 * Chat Completions vs Anthropic Messages, streaming, error shapes) are not
 * re-implemented here.
 *
 * Protocol selects the adapter AND the endpoint path:
 *   chat-completions   -> /chat/completions  (@ai-sdk/openai-compatible)
 *   responses          -> /responses         (@ai-sdk/openai .responses)
 *   anthropic-messages -> /messages          (@ai-sdk/anthropic)
 *
 * Nothing here interprets task content: it sends text and returns text.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText, type LanguageModel } from "ai";

import type { Protocol } from "./opencode-models";
import { PROTOCOL_PATH } from "./opencode-models";

export interface TransportSpec {
  readonly providerId: string;
  /** Native Anthropic, or anything speaking an OpenAI-compatible family. */
  readonly kind: "anthropic" | "openai-compat";
  readonly apiKey: string;
  readonly baseURL: string | null;
  /** The API model id. NEVER a display name. */
  readonly modelId: string;
  readonly protocol: Protocol;
  /** Transport headers, including the stable conversation session id. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface GenerateInput {
  readonly system: string;
  readonly prompt: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface GenerateResult {
  readonly text: string;
  readonly modelId: string;
  readonly latencyMs: number;
}

export interface StreamInput extends GenerateInput {
  /** Called with each text chunk as it arrives. */
  onChunk(text: string): void;
  readonly signal?: AbortSignal;
}

/** The full URL a spec will call — for diagnostics, never for the request. */
export function endpointFor(spec: TransportSpec): string {
  const base = (spec.baseURL ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
  return `${base}${PROTOCOL_PATH[spec.protocol]}`;
}

function buildModel(spec: TransportSpec): LanguageModel {
  const headers = { ...spec.headers };
  const baseURL = spec.baseURL ? spec.baseURL.replace(/\/+$/, "") : undefined;

  if (spec.protocol === "anthropic-messages" || spec.kind === "anthropic") {
    // The SDK appends /messages and authenticates with x-api-key, which the
    // OpenCode gateway accepts on this path.
    const anthropic = createAnthropic({
      apiKey: spec.apiKey,
      ...(baseURL ? { baseURL } : {}),
      headers,
    });
    return anthropic(spec.modelId);
  }

  if (spec.protocol === "responses") {
    const openai = createOpenAI({
      apiKey: spec.apiKey,
      ...(baseURL ? { baseURL } : {}),
      headers,
    });
    return openai.responses(spec.modelId);
  }

  const compatible = createOpenAICompatible({
    name: spec.providerId,
    apiKey: spec.apiKey,
    baseURL: baseURL ?? "https://api.openai.com/v1",
    headers,
  });
  return compatible(spec.modelId);
}

/**
 * One completion. Errors propagate unchanged so the caller can read the SDK's
 * structured status and upstream body — never flattened into a string here.
 */
export async function generate(spec: TransportSpec, input: GenerateInput): Promise<GenerateResult> {
  const started = Date.now();
  const result = await generateText({
    model: buildModel(spec),
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
  });
  return { text: result.text, modelId: spec.modelId, latencyMs: Date.now() - started };
}

/**
 * One completion, streamed (WS-R10).
 *
 * The SDK is here precisely because streaming and cancellation are what it is
 * good at (AD-19), so this function owns no protocol detail beyond handing the
 * abort signal down and passing chunks up. The full text is still returned, so
 * a caller that needs the authoritative answer does not have to reassemble
 * what it was shown.
 *
 * Errors propagate unchanged, including an abort, so the turn pipeline can
 * tell cancellation from failure and the diagnostics layer still sees the
 * SDK's structured status.
 */
export async function generateStream(spec: TransportSpec, input: StreamInput): Promise<GenerateResult> {
  const started = Date.now();
  const result = streamText({
    model: buildModel(spec),
    system: input.system,
    prompt: input.prompt,
    maxOutputTokens: input.maxTokens,
    temperature: input.temperature,
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  const text = await collectTextStream(result.fullStream, input.onChunk);
  return { text, modelId: spec.modelId, latencyMs: Date.now() - started };
}

/**
 * Read a stream's parts into text, and fail on the first error part.
 *
 * `fullStream`, not `textStream`, on purpose. The SDK reports an API failure —
 * a 402 for insufficient credits, a 404 for an unknown model — as an `error`
 * PART, and `textStream` simply ends empty when one arrives. Reading
 * `textStream` turned every such failure into an empty "success": the turn
 * completed with a blank reply and the user saw nothing. Rethrowing the
 * provider's own error lets the diagnostics layer read its status and body,
 * and lets the turn fail visibly (INV-012).
 */
export async function collectTextStream(
  parts: AsyncIterable<unknown>,
  onChunk: (text: string) => void,
): Promise<string> {
  let text = "";
  for await (const raw of parts) {
    const part = raw as { type?: string; text?: unknown; error?: unknown };
    if (part.type === "text-delta" && typeof part.text === "string") {
      text += part.text;
      onChunk(part.text);
    } else if (part.type === "error") {
      throw part.error instanceof Error ? part.error : new Error(String(part.error));
    }
  }
  return text;
}

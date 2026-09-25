/**
 * The default model provider: Anthropic Messages API via the official SDK
 * (FR-047).
 *
 * A thin adapter, nothing more. It sends text and returns text; schema,
 * validation, repair and attribution all live in `src/intent/`. No Anthropic
 * type appears outside `src/model/` (NFR-003).
 */
import Anthropic from "@anthropic-ai/sdk";

import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type ModelProvider,
} from "./provider.js";

/**
 * Model resolution: explicit argument, then `FORGE_MODEL`, then the default.
 * The default is a documented starting point, not a claim — pin the model you
 * evaluated with in `FORGE_MODEL`.
 */
export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-5";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly defaultModel: string;
  private readonly client: Anthropic;

  /**
   * `baseURL` names an alternative host that speaks the anthropic-messages
   * protocol — a gateway, not a different vendor.
   *
   * It is optional, and its absence was a real defect rather than a missing
   * convenience. Without it there was no core transport that could reach a
   * gateway's `/messages` path, so `intent.extract` had only the
   * OpenAI-compatible provider to fall back to and sent anthropic-messages
   * models to `/chat/completions`, where they returned HTTP 503 with an empty
   * body. Counted on the OpenCode Go table, that stranded 8 of 29 models
   * (V2-R step 11).
   *
   * This adds no vendor knowledge to the core. The protocol is Anthropic's
   * either way; who is serving it is transport, and transport is exactly what
   * a base URL is.
   */
  constructor(apiKey: string, defaultModel?: string, baseURL?: string) {
    if (!apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY is empty — cannot create the client.", "anthropic");
    }
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
    this.defaultModel = defaultModel ?? process.env["FORGE_MODEL"] ?? ANTHROPIC_DEFAULT_MODEL;
  }

  async complete(request: CompletionRequest, model?: string): Promise<CompletionResponse> {
    const started = Date.now();
    const useModel = model ?? this.defaultModel;
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(
        {
          model: useModel,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: "user", content: request.user }],
          temperature: request.temperature,
        },
        // `extraHeaders` is transport the contract says every provider sends
        // verbatim (a gateway's session id). This one dropped them, so a
        // gateway that requires a session refused every extraction with 400.
        request.extraHeaders ? { headers: { ...request.extraHeaders } } : undefined,
      );
    } catch (error) {
      // The SDK surfaces the HTTP status on APIError; read it structurally so
      // callers render a real status instead of scraping the message text.
      const status = (error as { status?: unknown }).status;
      throw new ProviderError(error instanceof Error ? error.message : String(error), "anthropic", {
        model: useModel,
        ...(typeof status === "number" ? { httpStatus: status } : {}),
        ...(error instanceof Error ? { providerMessage: error.message } : {}),
      });
    }
    const text = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text) {
      // Name the cause when the endpoint states it: a reasoning model that
      // stops at max_tokens has spent the whole budget thinking, and "no text
      // blocks" sent users looking for a broken key.
      const cause =
        response.stop_reason === "max_tokens"
          ? `used its whole output budget (${request.maxTokens} tokens) without writing an answer — reasoning models can spend it all thinking. Retry, or choose a model with a larger output limit or less reasoning`
          : `returned no text${response.stop_reason ? ` (stop reason: ${response.stop_reason})` : ""}`;
      throw new ProviderError(`Model ${useModel} ${cause}.`, "anthropic", { model: useModel });
    }
    return {
      text,
      model: response.model,
      latencyMs: Date.now() - started,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  }
}

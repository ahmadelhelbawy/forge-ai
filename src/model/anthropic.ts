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

  constructor(apiKey: string, defaultModel?: string) {
    if (!apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY is empty — cannot create the client.", "anthropic");
    }
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel ?? process.env["FORGE_MODEL"] ?? ANTHROPIC_DEFAULT_MODEL;
  }

  async complete(request: CompletionRequest, model?: string): Promise<CompletionResponse> {
    const started = Date.now();
    const useModel = model ?? this.defaultModel;
    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create({
        model: useModel,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
        temperature: request.temperature,
      });
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
      throw new ProviderError(`model ${useModel} returned no text blocks.`, "anthropic", {
        model: useModel,
      });
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

/**
 * The minimal OpenAI-compatible provider (FR-047).
 *
 * Native `fetch` against any `/chat/completions` endpoint — OpenAI itself or a
 * compatible gateway. Adds NO dependency (plan.md dependency budget: the
 * OpenAI-compatible provider uses native fetch).
 */
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResponse,
  type ModelProvider,
} from "./provider.js";
import packageJson from "../../package.json" with { type: "json" };

export const OPENAI_COMPAT_DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface ChatCompletionsResponse {
  readonly model?: string;
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string | null };
    /** `"length"` means the budget ran out before the model finished. */
    readonly finish_reason?: string | null;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    /** Reasoning models bill thinking against the same completion budget. */
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
  readonly error?: unknown;
  readonly message?: unknown;
}

/**
 * The upstream's own explanation, whatever shape it arrives in.
 *
 * "OpenAI-compatible" is a loose family: `{error:{message}}` is the common
 * case, but gateways also send `{error:"…"}`, `{message:"…"}`, a `detail`
 * field, or an array of errors. Reading only one shape reported "request
 * rejected" and threw the real reason away.
 */
function upstreamMessage(payload: ChatCompletionsResponse, rawBody: string): string | undefined {
  // Some endpoints wrap the whole envelope in an array ([{error:{…}}]).
  const seen = [
    payload.error,
    payload.message,
    (payload as { detail?: unknown }).detail,
    ...(Array.isArray(payload) ? [payload] : []),
  ];
  for (const candidate of seen) {
    const found = messageFrom(candidate);
    if (found !== undefined) return found;
  }
  // No field we recognise. The body itself is then the only evidence there
  // is — showing it beats reporting "request rejected" and discarding it.
  const trimmed = rawBody.trim();
  if (trimmed.length === 0) return "(the endpoint returned an empty body)";
  return trimmed.length <= 500 ? trimmed : `${trimmed.slice(0, 500)}…`;
}

function messageFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = messageFrom(entry);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "detail", "description", "error_description", "reason"]) {
      const found = typeof record[key] === "string" ? messageFrom(record[key]) : undefined;
      if (found !== undefined) return found;
    }
    // Wrapper objects such as {error:{message}} need one more hop.
    if (record["error"] !== undefined) return messageFrom(record["error"]);
  }
  return undefined;
}

export class OpenAiCompatProvider implements ModelProvider {
  readonly id = "openai-compat";
  readonly defaultModel: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;

  constructor(apiKey: string, baseUrl?: string, defaultModel?: string, userAgent?: string) {
    if (!apiKey) {
      throw new ProviderError("OPENAI_API_KEY is empty — cannot create the client.", "openai-compat");
    }
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl ?? process.env["OPENAI_BASE_URL"] ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.defaultModel = defaultModel ?? process.env["FORGE_MODEL"] ?? OPENAI_COMPAT_DEFAULT_MODEL;
    this.userAgent = userAgent ?? `forge/${packageJson.version}`;
  }

  async complete(request: CompletionRequest, model?: string): Promise<CompletionResponse> {
    const started = Date.now();
    const useModel = model ?? this.defaultModel;
    const endpoint = `${this.baseUrl}/chat/completions`;
    let http: Response;
    try {
      http = await fetch(endpoint, {
        method: "POST",
        // A provider that never answers must not hang the caller forever.
        signal: AbortSignal.timeout(300_000),
        headers: {
          "content-type": "application/json",
          "user-agent": this.userAgent,
          authorization: `Bearer ${this.apiKey}`,
          ...request.extraHeaders,
        },
        body: JSON.stringify({
          model: useModel,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          ...(request.responseFormat === "text"
            ? {}
            : { response_format: { type: "json_object" } }),
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
    } catch (error) {
      throw new ProviderError(
        `transport failure: ${error instanceof Error ? error.message : String(error)}`,
        "openai-compat",
        { endpoint, model: useModel },
      );
    }
    // Read the body once as text: a rejection is frequently not JSON at all
    // (a proxy's HTML error page), and the raw text is the only explanation
    // there is. Parsing from text keeps both paths on the same evidence.
    let rawBody: string;
    try {
      rawBody = await http.text();
    } catch (error) {
      throw new ProviderError(
        `HTTP ${http.status}: response body could not be read: ${error instanceof Error ? error.message : String(error)}`,
        "openai-compat",
        { endpoint, model: useModel, httpStatus: http.status },
      );
    }
    let payload: ChatCompletionsResponse;
    try {
      payload = JSON.parse(rawBody) as ChatCompletionsResponse;
    } catch {
      const snippet = rawBody.trim().slice(0, 300);
      throw new ProviderError(
        `HTTP ${http.status}: response was not JSON.`,
        "openai-compat",
        {
          endpoint,
          model: useModel,
          httpStatus: http.status,
          providerMessage: snippet.length > 0 ? snippet : "(the endpoint returned an empty body)",
        },
      );
    }
    if (!http.ok || payload.error) {
      const providerMessage = upstreamMessage(payload, rawBody);
      throw new ProviderError(
        `HTTP ${http.status}: ${providerMessage ?? "request rejected"}.`,
        "openai-compat",
        {
          endpoint,
          model: useModel,
          httpStatus: http.status,
          ...(providerMessage !== undefined ? { providerMessage } : {}),
        },
      );
    }
    const choice = payload.choices?.[0];
    const text = choice?.message?.content ?? "";
    const reasoningTokens = payload.usage?.completion_tokens_details?.reasoning_tokens;

    /**
     * A budget exhausted mid-answer is not "the model returned nothing".
     *
     * A reasoning model bills its thinking against `max_tokens`, so a budget
     * sized for the answer alone produces either a truncated JSON body or an
     * empty one — and reporting either as "no message content" sends the
     * reader looking for a broken key or a wrong model id. INV-012: say which
     * degradation happened, and say what would fix it.
     */
    if (choice?.finish_reason === "length") {
      const spent =
        reasoningTokens !== undefined ? ` ${reasoningTokens} of them were reasoning tokens.` : "";
      throw new ProviderError(
        `model ${useModel} hit the ${request.maxTokens}-token output budget before finishing` +
          `${text ? " (the response is truncated)" : " (no content was left for the answer)"}.${spent}`,
        "openai-compat",
        { endpoint, model: useModel, httpStatus: http.status },
      );
    }
    if (!text) {
      throw new ProviderError(`model ${useModel} returned no message content.`, "openai-compat", {
        endpoint,
        model: useModel,
        httpStatus: http.status,
      });
    }
    return {
      text,
      model: payload.model ?? useModel,
      latencyMs: Date.now() - started,
      inputTokens: payload.usage?.prompt_tokens,
      outputTokens: payload.usage?.completion_tokens,
    };
  }
}

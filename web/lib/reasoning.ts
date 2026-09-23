/**
 * Reasoning effort (`spec.md` §22.13, WS-R42/WS-R43, FR-062).
 *
 * The rule is the one WS-R21 set for protocols: a capability FORGE cannot show
 * a model has is a capability FORGE does not use. So support comes from exactly
 * two places —
 *
 *   DECLARED    the tables below, for providers whose documentation names the
 *               models that accept a reasoning setting;
 *   DISCOVERED  OpenRouter's own model listing, whose `supported_parameters`
 *               says per model whether `reasoning` is accepted.
 *
 * — and everything else, every custom model id included, is unsupported. The
 * control is disabled with the reason and the server refuses a request that
 * names an effort anyway, before any call is made. Sending `reasoning_effort` to
 * a model that rejects it is a 400 the user did not cause; sending it to one
 * that ignores it is a setting that silently does nothing. Both are forbidden.
 */
import { openCodeModel, type Protocol } from "./opencode-models";
import type { ReasoningEffort } from "./store-types";

/** How the effort travels. One entry per wire shape the SDK adapters accept. */
export type ReasoningWire = "openai-chat" | "openai-responses" | "anthropic-thinking" | "openrouter";

export interface ReasoningSupport {
  readonly wire: ReasoningWire;
  readonly source: "declared" | "discovered";
  readonly levels: readonly Exclude<ReasoningEffort, "default">[];
}

export interface ReasoningAvailability {
  readonly support: ReasoningSupport | null;
  /** Why the control is disabled, in the user's terms. Null when supported. */
  readonly reason: string | null;
}

const LEVELS = ["low", "medium", "high"] as const;

/**
 * WS-R43: Anthropic extended thinking takes a token budget, not a level. The
 * budget is ADDED to the output cap, so thinking can never eat the answer —
 * the exact failure Sprint 1 measured on a reasoning model.
 */
export const THINKING_BUDGET: Readonly<Record<Exclude<ReasoningEffort, "default">, number>> = Object.freeze({
  low: 2048,
  medium: 6144,
  high: 12288,
});

/**
 * DECLARED support. Patterns over model ids, per provider, from each vendor's
 * documentation of which families accept the parameter. Narrow on purpose: a
 * family not listed is unsupported until someone shows it is.
 */
const DECLARED: ReadonlyArray<{ provider: string; pattern: RegExp; wire: ReasoningWire }> = [
  { provider: "anthropic", pattern: /^claude-(?:opus|sonnet|haiku)-4|^claude-3-7-sonnet/, wire: "anthropic-thinking" },
  { provider: "openai", pattern: /^(?:o[134](?:-|$)|gpt-5)/, wire: "openai-chat" },
  { provider: "google", pattern: /^gemini-(?:2\.5|[3-9])/, wire: "openai-chat" },
  { provider: "xai", pattern: /^grok-3-mini/, wire: "openai-chat" },
];

/** OpenCode Go: only models on the Responses API are documented to take it. */
function openCodeSupport(modelId: string): ReasoningSupport | null {
  const spec = openCodeModel(modelId);
  if (spec?.protocol === "responses") return { wire: "openai-responses", source: "declared", levels: LEVELS };
  return null;
}

export function isOpenRouter(providerId: string, baseURL: string | null): boolean {
  return providerId === "openrouter" || (baseURL ?? "").includes("openrouter.ai");
}

// ── Discovery (OpenRouter) ──────────────────────────────────────────────────

export type OpenRouterFetcher = () => Promise<ReadonlyArray<{ id: string; supported_parameters?: readonly string[] }>>;

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_MS = 60 * 60 * 1000;
let cache: { at: number; byId: Map<string, readonly string[]> } | null = null;

const defaultFetcher: OpenRouterFetcher = async () => {
  // The listing is public: no key is sent, so none can leak (WS-R16).
  const response = await fetch(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OpenRouter model list returned HTTP ${response.status}`);
  const body = (await response.json()) as { data?: Array<{ id: string; supported_parameters?: string[] }> };
  return body.data ?? [];
};

/** Test seam; resets the cache. */
export function resetReasoningCache(): void {
  cache = null;
}

async function openRouterParameters(modelId: string, fetcher: OpenRouterFetcher): Promise<readonly string[] | null> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const models = await fetcher();
    cache = { at: Date.now(), byId: new Map(models.map((m) => [m.id, m.supported_parameters ?? []])) };
  }
  return cache.byId.get(modelId) ?? null;
}

/**
 * Where a model stands. Async only for discovery; declared answers need no I/O.
 * A discovery failure is reported as the reason, never guessed past.
 */
export async function reasoningAvailability(
  input: { providerId: string; baseURL: string | null; protocol: Protocol; modelId: string; openCode: boolean },
  fetcher: OpenRouterFetcher = defaultFetcher,
): Promise<ReasoningAvailability> {
  const { providerId, baseURL, modelId } = input;
  if (input.openCode) {
    const support = openCodeSupport(modelId);
    return support
      ? { support, reason: null }
      : { support: null, reason: `OpenCode Go does not document a reasoning setting for ${modelId}.` };
  }
  if (isOpenRouter(providerId, baseURL)) {
    try {
      const params = await openRouterParameters(modelId, fetcher);
      if (params === null) return { support: null, reason: `OpenRouter does not list ${modelId}, so its reasoning support is unknown.` };
      return params.includes("reasoning")
        ? { support: { wire: "openrouter", source: "discovered", levels: LEVELS }, reason: null }
        : { support: null, reason: `OpenRouter reports that ${modelId} does not accept a reasoning setting.` };
    } catch (error) {
      return {
        support: null,
        reason: `Could not read OpenRouter's model list (${error instanceof Error ? error.message : String(error)}); reasoning support is unknown.`,
      };
    }
  }
  const declared = DECLARED.find((d) => d.provider === providerId && d.pattern.test(modelId));
  if (declared) return { support: { wire: declared.wire, source: "declared", levels: LEVELS }, reason: null };
  return {
    support: null,
    reason: `FORGE has no record that ${modelId} accepts a reasoning setting, so it sends none.`,
  };
}

export class ReasoningUnsupportedError extends Error {
  constructor(effort: ReasoningEffort, reason: string) {
    super(`Reasoning effort "${effort}" was requested, but ${reason} Choose "Default" or a model that supports it.`);
    this.name = "ReasoningUnsupportedError";
  }
}

export interface ReasoningRequest {
  readonly wire: ReasoningWire;
  readonly effort: Exclude<ReasoningEffort, "default">;
}

/**
 * WS-R43: the SDK call options for one request. `providerOptionsName` is the
 * name the OpenAI-compatible adapter was created with; unknown keys under it
 * pass through to the request body, which is how OpenRouter's `reasoning`
 * object travels.
 */
export function reasoningCallOptions(
  request: ReasoningRequest | undefined,
  providerOptionsName: string,
  maxTokens: number,
): { providerOptions?: Record<string, Record<string, unknown>>; maxTokens: number; omitTemperature: boolean } {
  if (!request) return { maxTokens, omitTemperature: false };
  switch (request.wire) {
    case "openai-chat":
      return { providerOptions: { [providerOptionsName]: { reasoningEffort: request.effort } }, maxTokens, omitTemperature: false };
    case "openrouter":
      return { providerOptions: { [providerOptionsName]: { reasoning: { effort: request.effort } } }, maxTokens, omitTemperature: false };
    case "openai-responses":
      return { providerOptions: { openai: { reasoningEffort: request.effort } }, maxTokens, omitTemperature: false };
    case "anthropic-thinking": {
      const budgetTokens = THINKING_BUDGET[request.effort];
      // Anthropic rejects a modified temperature while thinking is on.
      return {
        providerOptions: { anthropic: { thinking: { type: "enabled", budgetTokens } } },
        maxTokens: maxTokens + budgetTokens,
        omitTemperature: true,
      };
    }
  }
}

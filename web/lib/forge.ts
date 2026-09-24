/**
 * FORGE engine wiring for the web product (server-only: imported by API
 * routes, never by client components).
 *
 * Reuses the frozen P0–P4 core through its built modules: the
 * ModelProvider abstraction (never coupled to a vendor), the agent-profile
 * registry (target intelligence), intent.extract (structure inspection),
 * and strategy selection (candidate overlays). No core code is duplicated
 * here — this module only adapts core outputs to web shapes.
 */
import { randomUUID } from "node:crypto";

import { AnthropicProvider } from "forge/dist/model/anthropic.js";
import { OpenAiCompatProvider } from "forge/dist/model/openai-compat.js";
import type { ModelCallRecord, ModelProvider } from "forge/dist/model/provider.js";
import { ProviderError } from "forge/dist/model/provider.js";
import { builtinProfiles } from "forge/dist/profile/registry.js";
import { extractIntent } from "forge/dist/intent/extract.js";
import { ArchetypeSource } from "forge/dist/strategy/source.js";
import { builtinStrategies } from "forge/dist/strategy/registry.js";

import type { TransportSpec } from "./ai-provider";
import type { Protocol } from "./opencode-models";
import { openCodeModel } from "./opencode-models";
import type { ProviderKind } from "./providers";
import { getDefaultModel, listModelOptions, resolveProvider } from "./providers";

export { ProviderError };

/** Identifies FORGE to gateways that log or route on User-Agent. */
export const FORGE_USER_AGENT = "forge/0.1.0-alpha.0";

export interface ProviderInfo {
  readonly id: string;
  readonly available: boolean;
  readonly defaultModel: string;
  readonly baseUrlConfigured: boolean;
}

function openAiBaseUrl(): string {
  return process.env["FORGE_BASE_URL"] ?? process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
}

function openAiKey(): string {
  return process.env["FORGE_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
}

export function listProviders(): ProviderInfo[] {
  return [
    {
      id: "anthropic",
      available: Boolean(process.env["ANTHROPIC_API_KEY"] ?? process.env["FORGE_API_KEY"]),
      defaultModel: process.env["FORGE_MODEL"] ?? "claude-sonnet-4-5",
      baseUrlConfigured: false,
    },
    {
      id: "openai-compat",
      available: openAiKey().length > 0,
      defaultModel: process.env["FORGE_MODEL"] ?? "kimi-k3",
      baseUrlConfigured: (process.env["FORGE_BASE_URL"] ?? process.env["OPENAI_BASE_URL"] ?? "").length > 0,
    },
  ];
}

/** Build a provider from server-side credentials. Keys never leave the server. */
export function getProvider(id: string): ModelProvider {
  if (id === "anthropic") {
    const key = process.env["ANTHROPIC_API_KEY"] ?? process.env["FORGE_API_KEY"] ?? "";
    return new AnthropicProvider(key, process.env["FORGE_MODEL"]);
  }
  const key = openAiKey();
  return new OpenAiCompatProvider(key, openAiBaseUrl(), process.env["FORGE_MODEL"]);
}

export function defaultProviderId(): string {
  if (openAiKey().length > 0) return "openai-compat";
  if (process.env["ANTHROPIC_API_KEY"]) return "anthropic";
  return "openai-compat";
}

export interface ResolvedChatProvider {
  readonly provider: ModelProvider;
  readonly providerId: string;
  readonly model: string;
  readonly sessionHeader: string | null;
  readonly extraHeaders: Record<string, string>;
}

/** Everything one live call needs, with the API model id already resolved. */
export interface ResolvedCall {
  readonly providerId: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly apiKey: string;
  readonly baseURL: string | null;
  /** The API model id. Never a display name. */
  readonly modelId: string;
  readonly displayModel: string;
  readonly protocol: Protocol;
  readonly sessionHeader: string | null;
  readonly configuredHeaders: Record<string, string>;
}

/** Raised when a model's wire protocol is not documented, so routing would guess. */
export class UnsupportedModelError extends Error {
  constructor(
    readonly modelId: string,
    readonly providerName: string,
  ) {
    super(
      `"${modelId}" is not a documented ${providerName} model, so FORGE cannot tell which protocol it speaks. Pick a listed model, or check the provider's model list.`,
    );
    this.name = "UnsupportedModelError";
  }
}

/** True for a provider whose base URL is an OpenCode Zen gateway. */
export function isOpenCodeGateway(providerId: string, baseURL: string | null): boolean {
  return providerId === "opencode-go" || (baseURL ?? "").includes("opencode.ai/zen");
}

/**
 * Resolve provider + model to a routable call.
 *
 * `overrides` carries values typed into Settings but not yet saved, so
 * "Test connection" exercises what is on screen rather than stored state.
 */
export function resolveCall(
  providerId: string,
  model?: string,
  overrides?: { apiKey?: string; baseURL?: string | null },
): ResolvedCall {
  const eff = resolveProvider(providerId);
  if (!eff || !eff.enabled) {
    throw new ProviderError(
      `Provider "${providerId}" is not enabled. Open Settings > AI Providers to enable it.`,
      providerId,
    );
  }
  const suppliedKey = overrides?.apiKey?.trim() ?? "";
  const overriddenURL = overrides?.baseURL ? overrides.baseURL.trim() : "";
  if (!suppliedKey && overriddenURL && overriddenURL !== (eff.baseURL ?? "")) {
    // The stored key is never sent to an endpoint the request chose: that
    // pairing is how a caller exfiltrates the key (a test against
    // https://attacker/…). A new endpoint is tested with a key typed for it.
    throw new ProviderError(
      `To test ${eff.displayName} against a different base URL, enter the API key again — the saved key is only sent to the saved endpoint.`,
      providerId,
    );
  }
  const apiKey = (suppliedKey || eff.apiKey).trim();
  if (!apiKey) {
    throw new ProviderError(
      `No API key configured for ${eff.displayName}. Open Settings > AI Providers to add one.`,
      providerId,
    );
  }
  const baseURL =
    overrides?.baseURL !== undefined
      ? overrides.baseURL === null
        ? eff.baseURL
        : overrides.baseURL.trim() || eff.baseURL
      : eff.baseURL;
  const modelId = (model && model.trim()) || eff.defaultModel;

  let protocol: Protocol;
  let displayModel = modelId;
  if (isOpenCodeGateway(providerId, baseURL)) {
    const spec = openCodeModel(modelId);
    if (!spec) throw new UnsupportedModelError(modelId, eff.displayName);
    protocol = spec.protocol;
    displayModel = spec.displayName;
  } else {
    protocol = eff.kind === "anthropic" ? "anthropic-messages" : "chat-completions";
  }

  return {
    providerId: eff.id,
    displayName: eff.displayName,
    kind: eff.kind,
    apiKey,
    baseURL,
    modelId,
    displayModel,
    protocol,
    sessionHeader: eff.sessionHeader,
    configuredHeaders: eff.headers,
  };
}

/**
 * Transport headers for a call, carrying a STABLE session id.
 *
 * OpenCode Go documents `x-opencode-session` as "a stable session ID for each
 * conversation so we can optimize routing and prompt caching". A fresh UUID
 * per call defeats that. The conversation id is already unique and stable for
 * exactly the right lifetime, so it IS the session.
 */
export function transportFor(call: ResolvedCall, sessionId: string): TransportSpec {
  const headers: Record<string, string> = {
    "user-agent": FORGE_USER_AGENT,
    ...call.configuredHeaders,
  };
  const sessionHeader = call.sessionHeader ?? process.env["FORGE_SESSION_HEADER"];
  if (sessionHeader) headers[sessionHeader] = sessionId;
  return {
    providerId: call.providerId,
    kind: call.kind,
    apiKey: call.apiKey,
    baseURL: call.baseURL,
    modelId: call.modelId,
    protocol: call.protocol,
    headers,
  };
}

/**
 * Resolve a conversation's provider+model to a live backend using the
 * settings store first, environment fallback second. Throws a user-facing
 * error when no key is configured (the UI turns this into Settings guidance).
 */
export function getEffectiveProvider(providerId: string, model?: string): ResolvedChatProvider {
  const eff = resolveProvider(providerId);
  if (!eff || !eff.enabled) {
    throw new ProviderError(`Provider "${providerId}" is not enabled. Open Settings > AI Providers to enable it.`, providerId);
  }
  if (!eff.apiKey) {
    throw new ProviderError(
      `No API key configured for ${eff.displayName}. Open Settings > AI Providers to add one.`,
      providerId,
    );
  }
  const useModel = model && model.length > 0 ? model : eff.defaultModel;

  /**
   * Transport comes from the MODEL's protocol, not the provider's kind
   * (V2-R step 11).
   *
   * This line used to read `eff.kind === "anthropic"`, which is a statement
   * about who sells the key, not about what the endpoint speaks. On a gateway
   * serving three protocols it sent every anthropic-messages model to
   * `/chat/completions`, where it got HTTP 503 with an empty body: 8 of the 29
   * documented OpenCode Go models unreachable, measured at 183s of retries
   * before failing incomprehensibly. `resolveCall` has resolved the protocol
   * correctly for the chat path since V2-E; this is the same resolution, now
   * used by the one path that still guessed.
   */
  const call = resolveCall(providerId, useModel);
  let provider: ModelProvider;
  if (call.protocol === "anthropic-messages") {
    provider = new AnthropicProvider(eff.apiKey, useModel, eff.baseURL ?? undefined);
  } else if (call.protocol === "chat-completions") {
    provider = new OpenAiCompatProvider(eff.apiKey, eff.baseURL ?? undefined, useModel);
  } else {
    // The `responses` protocol. The core has no provider that speaks it, and
    // the previous behaviour — send it to /chat/completions and report the
    // empty-bodied 503 that came back — is precisely the silent-wrong-answer
    // the no-fallback rule exists to prevent. Refusing with the reason turns
    // an unexplained failure into an actionable one.
    throw new ProviderError(
      `Model "${useModel}" speaks the "responses" protocol, which FORGE's extraction path ` +
        `does not support yet — the request would be sent to the wrong endpoint and fail without ` +
        `a usable error. Choose a chat-completions or anthropic-messages model for this operation.`,
      providerId,
      { model: useModel },
    );
  }
  return { provider, providerId: eff.id, model: useModel, sessionHeader: eff.sessionHeader, extraHeaders: eff.headers };
}

/**
 * Transport headers for one call: the provider's configured headers plus a
 * fresh session id when the gateway requires one (OpenCode Zen's
 * `x-opencode-session`). Single source of truth — every call site that builds
 * these itself is a place the session header can go missing.
 */
export function callHeaders(resolved: ResolvedChatProvider): Record<string, string> {
  const headers: Record<string, string> = { ...resolved.extraHeaders };
  const sessionHeader = resolved.sessionHeader ?? process.env["FORGE_SESSION_HEADER"];
  if (sessionHeader) headers[sessionHeader] = randomUUID();
  return headers;
}

/** First usable model across enabled providers: stored default, else first listed. */
export async function defaultModelSelection(): Promise<{ provider: string; model: string } | null> {
  const stored = getDefaultModel();
  if (stored) return stored;
  try {
    const options = await listModelOptions();
    const first = options[0];
    return first ? { provider: first.provider, model: first.id } : null;
  } catch {
    return null;
  }
}

export interface TargetBrief {
  readonly id: string;
  readonly displayName: string;
  readonly fidelity: string;
  readonly retrieval: string;
  readonly autonomy: string;
  readonly supported: string[];
  readonly conditional: string[];
  readonly absent: string[];
  readonly knownGaps: string[];
}

/** Target intelligence for the chat model + UI, straight from the YAML registry. */
export function getTargetBrief(target: string): TargetBrief | null {
  if (target === "generic") return null;
  let profile;
  try {
    profile = builtinProfiles().get(target);
  } catch {
    return null;
  }
  const supported: string[] = [];
  const conditional: string[] = [];
  const absent: string[] = [];
  for (const [cap, level] of Object.entries(profile.capabilities)) {
    if (level.level === "supported") supported.push(cap);
    else if (level.level === "conditional") conditional.push(`${cap} (${level.note ?? "conditional"})`);
    else absent.push(cap);
  }
  return {
    id: profile.id,
    displayName: profile.display_name,
    fidelity: profile.fidelity,
    retrieval: profile.retrieval.autonomous_search,
    autonomy: profile.autonomy.default,
    supported: supported.sort(),
    conditional: conditional.sort(),
    absent: absent.sort(),
    knownGaps: [...profile.limits.known_gaps],
  };
}

export function listTargets(): Array<{ id: string; displayName: string }> {
  return [
    { id: "generic", displayName: "Generic" },
    ...builtinProfiles().all.map((p) => ({ id: p.id, displayName: p.display_name })),
  ];
}

export interface PromptAnalysis {
  readonly goals: string[];
  readonly constraints: { statement: string; hardness: string }[];
  readonly questions: { question: string; blocking: boolean; options: string[] }[];
  readonly assumptions: string[];
  readonly verification: { spec: string; expected: string }[];
  readonly risk: string;
  readonly repairs: number;
  readonly model: string;
  readonly latencyMs: number;
  readonly strategies: Array<{ archetype: string; score: number; rationale: string }>;
  /**
   * The boundary's own call record (WS-R14). Surfaced rather than flattened so
   * the caller can append it to the conversation's run log: a call the product
   * made but did not record is a call the audit trail cannot account for.
   */
  readonly record: ModelCallRecord;
}

/** Structure inspection: intent.extract + strategy candidates on the result. */
export async function analyzePrompt(
  text: string,
  resolved: ResolvedChatProvider,
  target: string,
): Promise<PromptAnalysis> {
  // The session header is as required here as it is in chat: a gateway that
  // demands it rejects this call too. Passing the resolved provider (rather
  // than a bare ModelProvider) makes it impossible to forget.
  const headers = callHeaders(resolved);
  const { ir, repairs, record } = await extractIntent(text, {
    provider: resolved.provider,
    model: resolved.model,
    ...(Object.keys(headers).length > 0 ? { sessionHeaders: headers } : {}),
  });
  let strategies: PromptAnalysis["strategies"] = [];
  try {
    const profile = builtinProfiles().get(target === "generic" ? "claude-code" : target);
    strategies = new ArchetypeSource(builtinStrategies()).propose(ir, profile).map((c) => ({
      archetype: c.overlay.archetypeId,
      score: c.score,
      rationale: c.rationale,
    }));
  } catch {
    strategies = [];
  }
  return {
    goals: ir.goals.map((g) => g.statement),
    constraints: ir.constraints.map((c) => ({ statement: c.statement, hardness: c.hardness })),
    questions: ir.open_questions.map((q) => ({ question: q.question, blocking: q.blocking, options: [...q.options] })),
    assumptions: ir.assumptions.map((a) => a.statement),
    verification: ir.verification.map((v) => ({ spec: v.spec, expected: v.expected })),
    risk: ir.risk.level,
    repairs,
    model: record.model,
    latencyMs: record.latencyMs,
    strategies,
    record,
  };
}

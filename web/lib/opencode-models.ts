/**
 * OpenCode Go model registry: API id, display name, and wire protocol.
 *
 * Two facts drive this file:
 *
 *  1. A display name is NOT an API id ("DeepSeek V4 Flash" vs
 *     `deepseek-v4-flash`). The UI shows one; the wire carries the other.
 *  2. OpenCode Go serves three different protocols on three different paths.
 *     Routing every model through /chat/completions is wrong for roughly half
 *     of them.
 *
 * Source of truth: https://dev.opencode.ai/docs/go/ and
 * https://opencode.ai/v2/docs/console/go. `GET /v1/models` returns ids only —
 * no protocol — so the mapping cannot be discovered at runtime.
 *
 * A model absent from this table is reported UNSUPPORTED rather than guessed
 * at: sending it to the wrong endpoint produces a misleading 4xx.
 */

/** Wire protocol, which selects both the endpoint path and the SDK adapter. */
export type Protocol = "chat-completions" | "responses" | "anthropic-messages";

export interface ModelSpec {
  /** What the API receives. Never a display name. */
  readonly id: string;
  /** What the UI shows. Never sent upstream. */
  readonly displayName: string;
  readonly protocol: Protocol;
}

/** Endpoint path for a protocol, relative to the provider base URL. */
export const PROTOCOL_PATH: Readonly<Record<Protocol, string>> = Object.freeze({
  "chat-completions": "/chat/completions",
  responses: "/responses",
  "anthropic-messages": "/messages",
});

const MODELS: readonly ModelSpec[] = [
  // --- chat-completions -------------------------------------------------
  { id: "kimi-k3", displayName: "Kimi K3", protocol: "chat-completions" },
  { id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", protocol: "chat-completions" },
  { id: "kimi-k2.6", displayName: "Kimi K2.6", protocol: "chat-completions" },
  { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro", protocol: "chat-completions" },
  { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash", protocol: "chat-completions" },
  { id: "deepseek-v4.1-flash", displayName: "DeepSeek V4.1 Flash", protocol: "chat-completions" },
  {
    id: "deepseek-v4-flash-vision-exp",
    displayName: "DeepSeek V4 Flash Vision Exp",
    protocol: "chat-completions",
  },
  { id: "glm-5.3", displayName: "GLM-5.3", protocol: "chat-completions" },
  { id: "glm-5.3-flash", displayName: "GLM-5.3 Flash", protocol: "chat-completions" },
  { id: "glm-5.2", displayName: "GLM-5.2", protocol: "chat-completions" },
  { id: "glm-5.1", displayName: "GLM-5.1", protocol: "chat-completions" },
  { id: "longcat-2.0", displayName: "LongCat-2.0", protocol: "chat-completions" },
  { id: "mimo-v2.5", displayName: "MiMo-V2.5", protocol: "chat-completions" },
  { id: "mimo-v2.5-pro", displayName: "MiMo-V2.5-Pro", protocol: "chat-completions" },
  { id: "hy3", displayName: "Hy3", protocol: "chat-completions" },
  { id: "hy4-preview", displayName: "Hy4 preview", protocol: "chat-completions" },
  { id: "grok-4.5", displayName: "Grok 4.5", protocol: "chat-completions" },

  // --- responses --------------------------------------------------------
  { id: "gpt-5.6-luna", displayName: "GPT 5.6 Luna", protocol: "responses" },
  { id: "grok-4.6", displayName: "Grok 4.6", protocol: "responses" },
  {
    id: "muse-spark-1.3-contributor",
    displayName: "Muse Spark 1.3 Contributor",
    protocol: "responses",
  },
  {
    id: "muse-spark-1.2-contributor",
    displayName: "Muse Spark 1.2 Contributor",
    protocol: "responses",
  },

  // --- anthropic-messages -----------------------------------------------
  { id: "minimax-m3", displayName: "MiniMax M3", protocol: "anthropic-messages" },
  { id: "minimax-m2.7", displayName: "MiniMax M2.7", protocol: "anthropic-messages" },
  { id: "minimax-m2.5", displayName: "MiniMax M2.5", protocol: "anthropic-messages" },
  { id: "qwen3.8-max", displayName: "Qwen3.8 Max", protocol: "anthropic-messages" },
  { id: "qwen3.8-flash", displayName: "Qwen3.8 Flash", protocol: "anthropic-messages" },
  { id: "qwen3.7-max", displayName: "Qwen3.7 Max", protocol: "anthropic-messages" },
  { id: "qwen3.7-plus", displayName: "Qwen3.7 Plus", protocol: "anthropic-messages" },
  { id: "qwen3.6-plus", displayName: "Qwen3.6 Plus", protocol: "anthropic-messages" },
];

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function openCodeModels(): readonly ModelSpec[] {
  return MODELS;
}

/** The spec for an API id, or null when the protocol is not documented. */
export function openCodeModel(id: string): ModelSpec | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Merge discovered ids with the documented table. An id we cannot route is
 * returned with `protocol: null` so the UI can mark it unsupported instead of
 * silently sending it to the wrong endpoint.
 */
export function describeDiscovered(
  ids: readonly string[],
): Array<{ id: string; displayName: string; protocol: Protocol | null }> {
  return ids.map((id) => {
    const known = BY_ID.get(id);
    return known
      ? { id: known.id, displayName: known.displayName, protocol: known.protocol }
      : { id, displayName: id, protocol: null };
  });
}

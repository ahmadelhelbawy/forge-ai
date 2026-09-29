/**
 * The reasoning request for a conversation (WS-R42), resolved against the
 * configured provider. Kept apart from `reasoning.ts` so the pure tables and
 * wire mapping there carry no provider configuration.
 */
import { isOpenCodeGateway, resolveCall } from "./forge";
import { isOpenRouter, reasoningAvailability, ReasoningUnsupportedError, type ReasoningRequest } from "./reasoning";
import type { Conversation } from "./store";

/**
 * WS-R42: the reasoning request for this conversation's model, or none. A
 * conversation asking for an effort its model is not known to accept is refused
 * here — before any call, and before the user's message is touched.
 *
 * WS-R43 (amended): "default" sends nothing, except to a model whose declared
 * support names a bounded default level because it reasons without a bound
 * otherwise. Only declared tables carry one, so the default path never waits
 * on OpenRouter's listing.
 */
export async function reasoningFor(
  convo: Conversation,
  options: { readonly strict?: boolean } = {},
): Promise<ReasoningRequest | undefined> {
  const call = resolveCall(convo.provider, convo.model || undefined);
  if (convo.reasoningEffort === "default") {
    if (isOpenRouter(call.providerId, call.baseURL)) return undefined;
    const { support } = await reasoningAvailability({
      providerId: call.providerId,
      baseURL: call.baseURL,
      protocol: call.protocol,
      modelId: call.modelId,
      openCode: isOpenCodeGateway(call.providerId, call.baseURL),
    });
    return support?.defaultLevel ? { wire: support.wire, effort: support.defaultLevel } : undefined;
  }
  const { support, reason } = await reasoningAvailability({
    providerId: call.providerId,
    baseURL: call.baseURL,
    protocol: call.protocol,
    modelId: call.modelId,
    openCode: isOpenCodeGateway(call.providerId, call.baseURL),
  });
  if (!support) {
    // A stored preference the current model cannot take: nothing is sent, and
    // the header already says "Not supported". Only a request that names the
    // effort is refused (WS-R42).
    if (options.strict === false) return undefined;
    throw new ReasoningUnsupportedError(convo.reasoningEffort, reason ?? "its support is unknown.");
  }
  return { wire: support.wire, effort: convo.reasoningEffort };
}


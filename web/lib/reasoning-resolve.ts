/**
 * The reasoning request for a conversation (WS-R42), resolved against the
 * configured provider. Kept apart from `reasoning.ts` so the pure tables and
 * wire mapping there carry no provider configuration.
 */
import { isOpenCodeGateway, resolveCall } from "./forge";
import { reasoningAvailability, ReasoningUnsupportedError, type ReasoningRequest } from "./reasoning";
import type { Conversation } from "./store";

/**
 * WS-R42: the reasoning request for this conversation's model, or none. A
 * conversation asking for an effort its model is not known to accept is refused
 * here — before any call, and before the user's message is touched.
 */
export async function reasoningFor(convo: Conversation): Promise<ReasoningRequest | undefined> {
  if (convo.reasoningEffort === "default") return undefined;
  const call = resolveCall(convo.provider, convo.model || undefined);
  const { support, reason } = await reasoningAvailability({
    providerId: call.providerId,
    baseURL: call.baseURL,
    protocol: call.protocol,
    modelId: call.modelId,
    openCode: isOpenCodeGateway(call.providerId, call.baseURL),
  });
  if (!support) throw new ReasoningUnsupportedError(convo.reasoningEffort, reason ?? "its support is unknown.");
  return { wire: support.wire, effort: convo.reasoningEffort };
}


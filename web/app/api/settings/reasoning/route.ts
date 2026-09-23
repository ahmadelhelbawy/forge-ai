import { NextResponse } from "next/server";

import { isOpenCodeGateway, resolveCall } from "@/lib/forge";
import { reasoningAvailability } from "@/lib/reasoning";

/**
 * Whether a provider+model accepts a reasoning setting (WS-R42), so the header
 * control can be enabled — or disabled with the reason — before the user
 * tries. Answers from declared tables or the provider's own listing; never a
 * guess, and never with a credential in the response (WS-R16).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") ?? "";
  const model = url.searchParams.get("model") ?? "";
  if (!provider || !model) {
    return NextResponse.json({ error: "`provider` and `model` are required." }, { status: 400 });
  }
  try {
    const call = resolveCall(provider, model);
    const { support, reason } = await reasoningAvailability({
      providerId: call.providerId,
      baseURL: call.baseURL,
      protocol: call.protocol,
      modelId: call.modelId,
      openCode: isOpenCodeGateway(call.providerId, call.baseURL),
    });
    return NextResponse.json({
      supported: support !== null,
      levels: support?.levels ?? [],
      source: support?.source ?? null,
      wire: support?.wire ?? null,
      reason,
    });
  } catch (error) {
    return NextResponse.json({
      supported: false,
      levels: [],
      source: null,
      wire: null,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

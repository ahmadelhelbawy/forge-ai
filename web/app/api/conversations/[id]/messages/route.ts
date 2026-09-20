import { NextResponse } from "next/server";

import { loadConversation, saveConversation, currentPrompt } from "@/lib/store";
import { depsFor, failure, prepareTurn, type TurnRequestBody } from "@/lib/turn/http";
import { executeTurn, type TurnDeps } from "@/lib/turn/pipeline";

interface Params {
  params: { id: string };
}

/**
 * The whole-response turn.
 *
 * V2-B added a streaming sibling at `messages/stream`; this route stays
 * because it is the fallback when streaming is unavailable and because the
 * product HTTP suite reads a turn's outcome as one JSON object. Both routes
 * run the same pipeline over the same deps — the difference is transport.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: TurnRequestBody = {};
  try {
    body = (await request.json()) as TurnRequestBody;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const prepared = prepareTurn(convo, body);
  if (prepared instanceof NextResponse) return prepared;

  let deps: TurnDeps;
  try {
    deps = depsFor(convo, prepared.before);
  } catch (error) {
    // Configuration problems (no key, unknown model) are reported before the
    // user's message is touched.
    return failure(convo, error);
  }

  const result = await executeTurn(convo, prepared.content, deps, {
    signal: request.signal,
    regenerate: prepared.regenerate,
  });
  saveConversation(convo);

  if (result.failed) {
    // The original error is passed through, so the structured provider detail
    // survives to the diagnostic rather than being flattened into a string.
    return failure(convo, result.error);
  }
  if (result.cancelled) {
    return NextResponse.json({ cancelled: true, conversationIntact: true }, { status: 499 });
  }

  return NextResponse.json({
    reply: result.reply,
    version: result.version,
    promptChanged: result.version !== null,
    prompt: currentPrompt(convo),
    action: result.action,
    degraded: result.degraded,
    refused: result.refused,
    streamed: result.streamed,
    regenerated: result.regenerated,
    // WS-R28: Layer 1's verdict travels in its own field, labelled
    // deterministic, and never merged into a list of advice.
    preservation: result.preservation
      ? {
          layer: "deterministic",
          v: result.preservation.v,
          findings: result.preservation.findings,
          diagnostics: result.preservation.diagnostics,
        }
      : null,
    diagnostics: result.diagnostics.map((d) => ({
      code: d.code,
      name: d.name,
      severity: d.severity,
      source: d.source,
      message: d.message,
    })),
  });
}


import { NextResponse } from "next/server";

import { loadConversation, saveConversation, currentPrompt } from "@/lib/store";
import { depsFor, settingsRefusal, failure, prepareTurn, type TurnRequestBody } from "@/lib/turn/http";
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
    deps = await depsFor(convo, prepared.before, prepared.effortNamed);
  } catch (error) {
    const refused = settingsRefusal(convo, error);
    if (refused) return refused;
    // Configuration problems (no key, unknown model) are reported before the
    // user's message is touched.
    return failure(convo, error);
  }

  const result = await executeTurn(convo, prepared.content, deps, {
    signal: request.signal,
    regenerate: prepared.regenerate,
    generate: prepared.generate,
    ...(prepared.mode ? { mode: prepared.mode } : {}),
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
    // §22.11: the brief, the outstanding questions and whether the gate is open.
    discovery: result.discovery,
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
    // `evidence` travels with the finding (INV-007). A diagnostic stripped of
    // it arrives as an assertion the reader cannot check, which is the one
    // thing the diagnostic system exists not to be — and the chat surface
    // renders it, so dropping it here would silently cap what the UI can show.
    diagnostics: result.diagnostics.map((d) => ({
      code: d.code,
      name: d.name,
      severity: d.severity,
      source: d.source,
      message: d.message,
      evidence: d.evidence,
    })),
  });
}


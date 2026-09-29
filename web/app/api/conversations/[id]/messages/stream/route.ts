import { NextResponse } from "next/server";

import { currentPrompt, loadConversation, saveConversation, type Conversation } from "@/lib/store";
import { isTurnDelta } from "@/lib/turn/events";
import { depsFor, settingsRefusal, failureReport, prepareTurn, type TurnRequestBody } from "@/lib/turn/http";
import { runTurn, type TurnDeps, type TurnResult } from "@/lib/turn/pipeline";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * The same turn, streamed over SSE (WS-R10).
 *
 * §23.2 of the architecture prescribes exactly this: HTTP + SSE carrying
 * `TurnEvent`. There is no second event vocabulary for the wire — what the
 * pipeline yields is what is framed here, so a stage the log records is a
 * stage the user sees, and the only thing on the stream that is NOT in the
 * log is the token text itself (see `TurnDelta`).
 *
 * Three rules this handler exists to hold:
 *
 *  1. The conversation is saved on **every** exit — completion, failure,
 *     cancellation, and client disconnect. A turn whose HTTP response nobody
 *     is listening to still happened, and WS-R12 is about what is on disk.
 *  2. A cancel is the client aborting the request. `request.signal` reaches
 *     the pipeline, which stops between chunks and writes nothing.
 *  3. A provider failure is reported *on the stream*, because the headers
 *     were sent long before the failure happened. The client reads a `failed`
 *     frame carrying the same diagnostic the non-streaming route returns.
 */
export const dynamic = "force-dynamic";

function frame(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function outcome(convo: Conversation, result: TurnResult): Record<string, unknown> {
  return {
    type: "result",
    turnId: result.turnId,
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
    cancelled: result.cancelled,
    // The deterministic preservation verdict, kept in its own field for the
    // same reason it is kept in its own field on the non-streaming route: a
    // guarantee and a piece of advice must never arrive as one list (WS-R28).
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
  };
}

export async function POST(request: Request, context: Params): Promise<Response> {
  const params = await context.params;
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
    // A configuration problem is known before the user's message is touched,
    // so it is an ordinary HTTP error rather than a stream that opens to fail.
    saveConversation(convo);
    const report = failureReport(convo, error);
    return NextResponse.json(
      { error: report.message, diagnostic: report.diagnostic, detail: report.detail, conversationIntact: true },
      { status: 502 },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown): void => {
        try {
          controller.enqueue(frame(payload));
        } catch {
          // The client is gone. The turn continues to a clean end so that what
          // lands on disk is a finished turn, not a half of one.
        }
      };

      try {
        const iterator = runTurn(convo, prepared.content, deps, {
          signal: request.signal,
          regenerate: prepared.regenerate,
          generate: prepared.generate,
          ...(prepared.mode ? { mode: prepared.mode } : {}),
        });
        let next = await iterator.next();
        while (!next.done) {
          const item = next.value;
          send(isTurnDelta(item) ? { type: "delta", kind: item.kind, text: item.text } : { type: "event", event: item });
          next = await iterator.next();
        }
        const result = next.value;
        saveConversation(convo);
        if (result.failed) {
          const report = failureReport(convo, result.error);
          send({ type: "failed", error: report.message, diagnostic: report.diagnostic, detail: report.detail, conversationIntact: true });
        } else {
          send(outcome(convo, result));
        }
      } catch (error) {
        // The pipeline itself does not throw, so reaching here means the
        // transport or the store did. It is still reported, never swallowed.
        saveConversation(convo);
        const report = failureReport(convo, error);
        send({ type: "failed", error: report.message, diagnostic: report.diagnostic, detail: report.detail, conversationIntact: true });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Streaming dies behind a proxy that buffers; this is the standard ask.
      "x-accel-buffering": "no",
    },
  });
}

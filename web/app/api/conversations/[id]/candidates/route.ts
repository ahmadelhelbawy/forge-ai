import { NextResponse } from "next/server";

import {
  candidatePreservation,
  CandidateStateError,
  DEFAULT_CANDIDATES,
  generateCandidates,
  LedgerTamperedError,
  MAX_CANDIDATES,
  MIN_CANDIDATES,
} from "@/lib/candidates";
import { failureReport } from "@/lib/turn/http";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: { id: string };
}

/**
 * The candidate set (WS-R8).
 *
 * `GET` is free and reads what is already there. `POST` is the **request for
 * alternatives** — candidates exist only because someone asked, so there is no
 * path here that produces them as a side effect of anything else.
 *
 * Neither verb writes a prompt version. Promotion lives behind its own route
 * because it is a different act with a different consequence (ST-R6, WS-R2).
 */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({
    candidates: convo.candidates.map((candidate) => ({
      ...candidate,
      // WS-R28: Layer 1's verdict, labelled, and never mixed with advice.
      preservation: {
        layer: "deterministic",
        ...candidatePreservation(convo, candidate),
      },
    })),
    promotions: convo.candidatePromotions,
    currentV: convo.currentV,
    limits: { min: MIN_CANDIDATES, max: MAX_CANDIDATES, default: DEFAULT_CANDIDATES },
    layer: "deterministic",
  });
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { count?: unknown; provider?: unknown; model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is a request for the default number of alternatives.
  }
  const count = typeof body.count === "number" ? body.count : DEFAULT_CANDIDATES;

  try {
    const result = await generateCandidates(convo, {
      count,
      ...(typeof body.provider === "string" && body.provider ? { provider: body.provider } : {}),
      ...(typeof body.model === "string" && body.model ? { model: body.model } : {}),
    });
    saveConversation(convo);
    return NextResponse.json(
      {
        fromVersion: result.fromVersion,
        candidates: result.candidates.map((generated) => ({
          ...generated.candidate,
          preservation: { layer: "deterministic", ...generated.preservation },
        })),
        overlayDistinctness: result.overlayDistinctness,
        diagnostics: result.diagnostics,
        calls: result.calls,
        // WS-R8, stated in the payload so a client cannot assume otherwise.
        versionCreated: result.versionCreated,
        currentV: convo.currentV,
        layer: result.layer,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof CandidateStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof LedgerTamperedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // WS-R12's principle applied outside a turn: the conversation is intact,
    // and what was lost is the request.
    saveConversation(convo);
    const report = failureReport(convo, error);
    return NextResponse.json(
      { error: report.message, diagnostic: report.diagnostic, detail: report.detail, conversationIntact: true },
      { status: 502 },
    );
  }
}

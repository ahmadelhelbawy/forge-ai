import { NextResponse } from "next/server";

import { CandidateStateError, promoteCandidate } from "@/lib/candidates";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: { id: string; candidateId: string };
}

/**
 * Promote a candidate to the current prompt (ST-R6, WS-R2).
 *
 * A candidate never becomes the current prompt on its own; this route is the
 * explicit act that makes it one, and it is reachable only from a user
 * gesture. The version it writes is appended, never substituted (WS-R7), and
 * Layer 1 runs over it before the response is returned (WS-R25, WS-R29).
 */
export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  try {
    const promoted = promoteCandidate(convo, params.candidateId);
    saveConversation(convo);
    return NextResponse.json(
      {
        version: promoted.version,
        currentV: convo.currentV,
        prompt: promoted.version.text,
        preservation: { layer: "deterministic", ...promoted.preservation },
        promotions: convo.candidatePromotions,
        layer: promoted.layer,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof CandidateStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

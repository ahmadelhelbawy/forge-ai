import { NextResponse } from "next/server";

import { conflictResponse } from "@/lib/turn/http";

import { CandidateStateError, mergeCandidatesInto } from "@/lib/candidates";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Merge two or more artifacts into a new current prompt (WS-R2, WS-R5, WS-R8).
 *
 * The combination is deterministic — a union of paragraph blocks, no model —
 * so "nothing either candidate said was dropped" is a property of the text
 * rather than a claim about a generation. Layer 1 runs over the result and is
 * returned with it, so a pinned requirement the union could not keep is
 * reported rather than absorbed (INV-012, WS-R25).
 */
export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { refs?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === "string") : [];
  if (refs.length < 2) {
    return NextResponse.json({ error: "MERGE needs at least two artifact refs (WS-R5)." }, { status: 400 });
  }

  try {
    const merged = mergeCandidatesInto(convo, refs);
    saveConversation(convo);
    return NextResponse.json(
      {
        version: merged.version,
        currentV: convo.currentV,
        prompt: merged.version.text,
        merge: { blocks: merged.merge.blocks, contributions: merged.merge.contributions },
        preservation: { layer: "deterministic", ...merged.preservation },
        promotions: convo.candidatePromotions,
        layer: merged.layer,
      },
      { status: 201 },
    );
  } catch (error) {
    const conflict = conflictResponse(error);
    if (conflict) return conflict;
    if (error instanceof CandidateStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

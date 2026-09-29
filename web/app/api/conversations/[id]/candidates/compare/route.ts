import { NextResponse } from "next/server";

import { CandidateStateError, compareArtifacts } from "@/lib/candidates";
import { loadConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Side-by-side comparison of two addressable artifacts (WS-R5).
 *
 * `a` and `b` are artifact refs: `v<N>` for a prompt version, a candidate id
 * otherwise. Deterministic and model-free, so nothing in the response can be
 * mistaken for advice (WS-R28), and read-only, so comparing can never change
 * what is being compared (WS-R2).
 */
export async function GET(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const url = new URL(request.url);
  const a = url.searchParams.get("a") ?? "";
  const b = url.searchParams.get("b") ?? "";
  if (!a || !b) {
    return NextResponse.json({ error: "COMPARE needs two artifact refs, `a` and `b` (WS-R5)." }, { status: 400 });
  }

  try {
    const view = compareArtifacts(convo, a, b);
    return NextResponse.json(view);
  } catch (error) {
    if (error instanceof CandidateStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}

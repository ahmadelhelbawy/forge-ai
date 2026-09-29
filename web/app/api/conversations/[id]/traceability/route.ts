import { NextResponse } from "next/server";

import { traceabilityFor } from "@/lib/requirements";
import { loadConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/** The longest evidence body accepted, matching the verify route. */
const MAX_EVIDENCE_LENGTH = 1_000_000;

/**
 * The requirement traceability matrix (TM-R1–TM-R4).
 *
 * `POST {target?, evidence?}` because evidence is a body, not a query string.
 * A join over data the conversation already holds: the cached IR (never
 * extracted here, so no model call), the package built from it, the verdicts
 * of any pasted evidence, the bound repository's deterministic linkage, and the
 * advisory links — kept in their own field. The response is the matrix's
 * canonical JSON, byte-identical for identical inputs.
 */
export async function POST(request: Request, context: Params): Promise<Response> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: { target?: unknown; evidence?: unknown } = {};
  try {
    const text = await request.text();
    body = text.trim() === "" ? {} : (JSON.parse(text) as typeof body);
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const target = typeof body.target === "string" && body.target !== "" ? body.target : convo.target;
  const evidence = typeof body.evidence === "string" && body.evidence.trim() !== "" ? body.evidence : null;
  if (evidence !== null && evidence.length > MAX_EVIDENCE_LENGTH) {
    return NextResponse.json({ error: "Evidence is too large." }, { status: 413 });
  }
  try {
    const matrix = await traceabilityFor(convo, { target, evidence });
    return new Response(matrix.json, { headers: { "content-type": "application/json" } });
  } catch (error) {
    if (error instanceof Error && error.name === "RepositoryBindingRefused") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    // A malformed evidence file is refused whole, as the verify route does (EV-R5).
    if (error instanceof Error && error.name === "EvidenceShapeError") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

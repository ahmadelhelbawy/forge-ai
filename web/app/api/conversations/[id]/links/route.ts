import { NextResponse } from "next/server";

import { addAdvisoryLink, removeAdvisoryLink, RequirementActionError } from "@/lib/requirements";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * User-asserted advisory links (LK-R4).
 *
 * Always advisory: a link a person asserts is not deterministic evidence. The
 * collection is returned under its own name and never merged with the
 * authoritative linkage the traceability matrix derives.
 */
export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ advisory: true, links: convo.advisoryLinks });
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: { requirementId?: unknown; path?: unknown; note?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const link = addAdvisoryLink(convo, body);
    saveConversation(convo);
    return NextResponse.json({ advisory: true, link, links: convo.advisoryLinks }, { status: 201 });
  } catch (error) {
    if (error instanceof RequirementActionError) {
      return NextResponse.json({ error: error.message, reason: error.reason ?? null }, { status: error.status });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const linkId = new URL(request.url).searchParams.get("linkId") ?? "";
  const removed = removeAdvisoryLink(convo, linkId);
  if (!removed) return NextResponse.json({ error: "No such link." }, { status: 404 });
  saveConversation(convo);
  return NextResponse.json({ advisory: true, links: convo.advisoryLinks });
}

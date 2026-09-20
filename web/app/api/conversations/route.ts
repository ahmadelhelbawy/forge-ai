export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { defaultProviderId } from "@/lib/forge";
import { listConversations, newConversation, saveConversation } from "@/lib/store";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ conversations: listConversations() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { title?: unknown; target?: unknown; provider?: unknown; model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const convo = newConversation({
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : undefined,
    target: typeof body.target === "string" ? body.target : undefined,
    provider: typeof body.provider === "string" ? body.provider : defaultProviderId(),
    model: typeof body.model === "string" ? body.model : undefined,
  });
  saveConversation(convo);
  return NextResponse.json({ id: convo.id }, { status: 201 });
}

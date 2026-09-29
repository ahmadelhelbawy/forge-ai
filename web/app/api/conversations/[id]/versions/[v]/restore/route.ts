import { NextResponse } from "next/server";

import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string; v: string }>;
}

export async function POST(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const v = Number.parseInt(params.v, 10);
  const found = convo.promptVersions.find((p) => p.v === v);
  if (!found) return NextResponse.json({ error: `Version ${params.v} does not exist.` }, { status: 404 });
  convo.currentV = v;
  saveConversation(convo);
  return NextResponse.json({ currentV: v, prompt: found.text });
}

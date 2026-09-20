import { NextResponse } from "next/server";

import { currentPrompt, loadConversation, deleteConversation } from "@/lib/store";

interface Params {
  params: { id: string };
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { attachmentContents: _dropped, ...rest } = convo;
  void _dropped;
  return NextResponse.json({ ...rest, prompt: currentPrompt(convo) });
}

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const ok = deleteConversation(params.id);
  if (!ok) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

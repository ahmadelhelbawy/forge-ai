import { NextResponse } from "next/server";

import { diffLines } from "@/lib/diff";
import { loadConversation } from "@/lib/store";

interface Params {
  params: { id: string };
}

export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { searchParams } = new URL(request.url);
  const a = Number.parseInt(searchParams.get("a") ?? "", 10);
  const b = Number.parseInt(searchParams.get("b") ?? "", 10);
  const va = convo.promptVersions.find((p) => p.v === a);
  const vb = convo.promptVersions.find((p) => p.v === b);
  if (!va || !vb) return NextResponse.json({ error: "Both versions must exist (?a=N&b=M)." }, { status: 404 });
  return NextResponse.json({ a, b, hunks: diffLines(va.text, vb.text) });
}

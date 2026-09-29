import { NextResponse } from "next/server";

import { loadConversation, versionHistory } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Version history with its provenance (WS-R7, WS-R9).
 *
 * V2-C adds `textHash` to every row. A version's identity is the hash of its
 * content, and the Studio shows it: it is how a user can tell that a
 * "restored" version really is the same text they had before, without
 * trusting the label. The hash comes from the index, which holds hashes
 * rather than text precisely so it can be deleted without loss (AC-032).
 */
export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({
    versions: versionHistory(params.id),
    currentV: convo.currentV,
    candidates: convo.candidates,
  });
}

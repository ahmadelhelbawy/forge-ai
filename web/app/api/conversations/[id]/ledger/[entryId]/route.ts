import { NextResponse } from "next/server";

import { checkLedger, loadConversation, saveConversation, unpinRequirement } from "@/lib/store";

interface Params {
  params: { id: string; entryId: string };
}

/**
 * Unpin (WS-R27.4).
 *
 * Reachable only from an explicit user action in the Studio. There is
 * deliberately no server-side path — no envelope field, no action, no
 * diagnostic resolution — that reaches this handler: "unpinning is a user
 * action" is enforced by there being nothing else that can call it.
 */
export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const removed = unpinRequirement(convo, params.entryId);
  if (!removed) return NextResponse.json({ error: "That requirement is not pinned." }, { status: 404 });
  saveConversation(convo);
  const check = checkLedger(convo);
  return NextResponse.json({
    unpinned: removed,
    entries: convo.ledger,
    layer: "deterministic",
    check: { layer: "deterministic", v: check.v, findings: check.findings, diagnostics: check.diagnostics },
  });
}

import { NextResponse } from "next/server";

import { conflictResponse } from "@/lib/turn/http";

import { addPromptVersion, checkLedger, currentPrompt, loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({
    prompt: currentPrompt(convo),
    currentV: convo.currentV,
    versions: convo.promptVersions,
  });
}

export async function PUT(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: { text?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return NextResponse.json({ error: "Prompt text must not be empty." }, { status: 400 });
  if (text.length > 500_000) return NextResponse.json({ error: "Prompt too large." }, { status: 413 });
  if (text === currentPrompt(convo)) {
    return NextResponse.json({ version: null, promptChanged: false, prompt: text });
  }
  const version = addPromptVersion(convo, text, "manual");
  try {
    saveConversation(convo);
  } catch (error) {
    const conflict = conflictResponse(error);
    if (conflict) return conflict;
    throw error;
  }
  // WS-R29: Layer 1 runs on every version with a non-empty ledger, including
  // one the user typed. A hand edit can drop a pinned requirement as easily as
  // a model can, and the guarantee is about versions, not about authors.
  const check = convo.ledger.length > 0 ? checkLedger(convo, version.v) : null;
  return NextResponse.json({
    version,
    promptChanged: true,
    prompt: text,
    preservation: check
      ? { layer: "deterministic", v: check.v, findings: check.findings, diagnostics: check.diagnostics }
      : null,
  });
}

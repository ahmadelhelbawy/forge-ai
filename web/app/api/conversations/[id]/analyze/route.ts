import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { formatDiagnostic, logProviderFailure, providerDiagnostic } from "@/lib/diagnostics";
import { analyzePrompt, defaultProviderId, getEffectiveProvider } from "@/lib/forge";
import { appendTurnEvent, currentPrompt, loadConversation, recordModelCall, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Structure inspection (Advanced panel): runs the frozen intent.extract
 * boundary over the current prompt plus deterministic strategy selection.
 * Read-only — it never edits the conversation.
 */
export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const prompt = currentPrompt(convo);
  if (!prompt) return NextResponse.json({ error: "No prompt to analyze yet." }, { status: 400 });

  let body: { provider?: unknown; model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const providerId =
    (typeof body.provider === "string" && body.provider) || convo.provider || defaultProviderId();
  const model = (typeof body.model === "string" && body.model) || convo.model || undefined;

  if (process.env["FORGE_CHAT_STUB"]) {
    return NextResponse.json({
      goals: ["Stub goal"],
      constraints: [],
      questions: [],
      assumptions: [],
      verification: [],
      risk: "low",
      repairs: 0,
      model: "stub",
      latencyMs: 0,
      strategies: [],
    });
  }

  try {
    const resolved = getEffectiveProvider(providerId, model);
    const analysis = await analyzePrompt(prompt, resolved, convo.target);
    // WS-R14: a call the product made and did not record is a call the audit
    // trail cannot account for. ANALYZE is read-only for the artifact, not for
    // the run log.
    const turnId = randomUUID();
    recordModelCall(convo, analysis.record);
    appendTurnEvent(convo, {
      turnId,
      kind: "model_call",
      boundaryId: analysis.record.boundaryId,
      model: analysis.record.model,
      latencyMs: analysis.record.latencyMs,
    });
    appendTurnEvent(convo, { turnId, kind: "turn_completed", action: "ANALYZE", versionCreated: false });
    saveConversation(convo);
    const { record: _record, ...payload } = analysis;
    void _record;
    return NextResponse.json(payload);
  } catch (error) {
    const diagnostic = providerDiagnostic(error, {
      provider: providerId,
      stage: "structure analysis",
      ...(model !== undefined ? { model } : {}),
    });
    logProviderFailure(diagnostic);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: `Analysis failed: ${message}`,
        diagnostic: `Analysis failed.\n\n${formatDiagnostic(diagnostic)}`,
        detail: diagnostic,
      },
      { status: 502 },
    );
  }
}

import { NextResponse } from "next/server";

import { briefMarks, discoveredRequirements, unresolvedQuestions } from "forge/dist/conversation/discovery.js";
import { isArtifactKind, isOutputShape, parseStages, stageCarry } from "forge/dist/conversation/stages.js";

import { currentPrompt, loadConversation, deleteConversation, saveConversation } from "@/lib/store";
import { isReasoningEffort } from "@/lib/store-types";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { attachmentContents: _dropped, ...rest } = convo;
  void _dropped;
  const prompt = currentPrompt(convo);
  const version = convo.promptVersions.find((p) => p.v === convo.currentV);
  // WS-R40: the stage view is computed here, by the one parser, so the browser
  // never re-implements the rule. Offered for a version written as staged, or
  // any version that parses as stages.
  let stages: unknown = null;
  if (prompt) {
    const parsed = parseStages(prompt);
    if (parsed.ok) {
      const items = [
        ...convo.ledger.map((e) => ({ text: e.text, kind: "pinned" as const })),
        ...(convo.discovery ? discoveredRequirements(convo.discovery.brief).map((i) => ({ text: i.text, kind: "discovered" as const })) : []),
      ];
      stages = { ok: true, stages: parsed.stages, carry: stageCarry(parsed.stages, items) };
    } else if (version?.shape === "staged") {
      stages = { ok: false, reason: parsed.reason };
    }
  }
  return NextResponse.json({
    ...rest,
    prompt,
    stages,
    // WS-R32: the same de-duplicated set a generate would name in W010.
    discoveryUnresolved: unresolvedQuestions(convo.discovery),
    // WS-R45: computed on read, display-only, never stored and never provenance.
    discoveryMarks: convo.discovery
      ? briefMarks(
          convo.discovery.brief,
          convo.messages.filter((m) => m.role === "user").map((m) => m.content),
        )
      : {},
  });
}

/**
 * The user's own settings for a conversation (WS-R39, WS-R40, WS-R43) and the
 * way out of discovery that is not Generate (WS-R46).
 *
 * Every field here is a USER action. No turn, no model response and no
 * discovery suggestion reaches this handler: the artifact kind FORGE *reads*
 * from a conversation is offered for confirmation in the UI and becomes a
 * setting only when the user sends it here.
 */
export async function PATCH(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (body["artifactKind"] !== undefined) {
    if (!isArtifactKind(body["artifactKind"])) {
      return NextResponse.json({ error: "`artifactKind` must be unspecified, agent or builder." }, { status: 400 });
    }
    convo.artifactKind = body["artifactKind"];
  }
  if (body["outputShape"] !== undefined) {
    if (!isOutputShape(body["outputShape"])) {
      return NextResponse.json({ error: "`outputShape` must be single or staged." }, { status: 400 });
    }
    convo.outputShape = body["outputShape"];
  }
  if (body["reasoningEffort"] !== undefined) {
    if (!isReasoningEffort(body["reasoningEffort"])) {
      return NextResponse.json({ error: "`reasoningEffort` must be default, low, medium or high." }, { status: 400 });
    }
    convo.reasoningEffort = body["reasoningEffort"];
  }
  if (typeof body["target"] === "string" && body["target"]) convo.target = body["target"];

  if (body["discovery"] !== undefined) {
    const d = convo.discovery;
    if (body["discovery"] === "close") {
      if (d?.status !== "open") {
        return NextResponse.json({ error: "Discovery is not open, so there is nothing to close." }, { status: 409 });
      }
      convo.discovery = { ...d, status: "closed", questions: [], ready: false };
    } else if (body["discovery"] === "reopen") {
      if (!d || d.status === "open") {
        return NextResponse.json({ error: "There is no closed or generated discovery to reopen." }, { status: 409 });
      }
      convo.discovery = { ...d, status: "open" };
    } else {
      return NextResponse.json({ error: "`discovery` must be close or reopen." }, { status: 400 });
    }
  }

  saveConversation(convo);
  return NextResponse.json({
    artifactKind: convo.artifactKind,
    outputShape: convo.outputShape,
    reasoningEffort: convo.reasoningEffort,
    target: convo.target,
    discovery: convo.discovery,
  });
}

export async function DELETE(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const ok = deleteConversation(params.id);
  if (!ok) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

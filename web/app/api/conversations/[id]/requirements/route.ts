import { NextResponse } from "next/server";

import { decideRequirement, requirementRegistry, RequirementActionError } from "@/lib/requirements";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Requirement governance (RG-R1–RG-R6, `spec.md` §22.10).
 *
 * `GET` returns every requirement with its derived status. `POST {decision}`
 * records one explicit human decision — accept, supersede or conflict — naming
 * ids only. There is no model on any path in this file, and a refused decision
 * records nothing (409, with the rule it broke).
 */
export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const registry = requirementRegistry(convo);
  return NextResponse.json({ layer: "deterministic", ...registry, decisions: convo.governance });
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: { decision?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const record = decideRequirement(convo, body.decision);
    saveConversation(convo);
    return NextResponse.json({ record, ...requirementRegistry(convo) }, { status: 201 });
  } catch (error) {
    if (error instanceof RequirementActionError) {
      return NextResponse.json({ error: error.message, reason: error.reason ?? null }, { status: error.status });
    }
    throw error;
  }
}

import { NextResponse } from "next/server";

import { proposeRequirementCandidates } from "forge/dist/critic/deterministic/ledger.js";

import {
  checkLedger,
  currentPrompt,
  loadConversation,
  pinRequirement,
  saveConversation,
} from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/** The longest text that can usefully be pinned verbatim and matched. */
const MAX_REQUIREMENT_LENGTH = 2000;

/**
 * The requirement ledger (WS-R24, WS-R25) — Layer 1 of preservation.
 *
 * `GET` answers three different questions and keeps them apart on purpose:
 * what is pinned, what the **deterministic** check says about the current
 * version, and what FORGE would *propose* pinning. A proposal is not an entry
 * and is never counted as one — only the user promotes one (WS-R24).
 *
 * There is no model on any path in this file. That is the requirement, not an
 * optimization: a ledger a model could reach would make the guarantee only as
 * good as an extraction call (spec §22.8).
 */
export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const prompt = currentPrompt(convo);
  const check = checkLedger(convo);
  return NextResponse.json({
    entries: convo.ledger,
    // WS-R28: the deterministic layer is labelled as such wherever it surfaces.
    layer: "deterministic",
    check: { layer: "deterministic", v: check.v, findings: check.findings, diagnostics: check.diagnostics },
    proposals: prompt ? proposeRequirementCandidates(prompt) : [],
  });
}

/** Pin a requirement. The only way an entry enters the ledger. */
export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { text?: unknown; fromVersion?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "A pinned requirement must not be empty." }, { status: 400 });
  if (text.length > MAX_REQUIREMENT_LENGTH) {
    return NextResponse.json(
      { error: `A pinned requirement must be at most ${MAX_REQUIREMENT_LENGTH} characters.` },
      { status: 413 },
    );
  }
  if (convo.ledger.some((e) => e.text === text)) {
    return NextResponse.json({ error: "That requirement is already pinned." }, { status: 409 });
  }

  const fromVersion =
    typeof body.fromVersion === "number" && Number.isInteger(body.fromVersion) ? body.fromVersion : convo.currentV || null;
  const entry = pinRequirement(convo, { text, fromVersion });
  saveConversation(convo);
  const check = checkLedger(convo);
  return NextResponse.json(
    {
      entry,
      entries: convo.ledger,
      layer: "deterministic",
      check: { layer: "deterministic", v: check.v, findings: check.findings, diagnostics: check.diagnostics },
    },
    { status: 201 },
  );
}

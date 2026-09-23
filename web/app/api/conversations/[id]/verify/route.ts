import { NextResponse } from "next/server";

import { recordVerification, verifyVersion } from "@/lib/verify";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: { id: string };
}

/**
 * Evaluate pasted evidence against a prompt version's Execution Package (V2-G,
 * `FR-053`, `spec.md` §11.1).
 *
 * The body is `{ evidence: string, target?, v? }` — the evidence as TEXT, so the
 * report's `evidence_hash` is over exactly the bytes the user supplied. A
 * malformed evidence file is a 400 (`EV-R5`); the verdict report is returned
 * verbatim, `json` included, so the workspace shows what `forge verify --json`
 * would print.
 *
 * This route **writes no prompt version, executes nothing, and calls no
 * model** (`WS-R2`, `INV-004`, `EV-R1`).
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { evidence?: unknown; target?: string; v?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body with an `evidence` string." }, { status: 400 });
  }
  if (typeof body.evidence !== "string") {
    return NextResponse.json({ error: "`evidence` must be the evidence file's text." }, { status: 400 });
  }
  const target = body.target ?? convo.target ?? "generic";
  const v = body.v ?? convo.currentV;
  if (!convo.promptVersions.some((p) => p.v === v)) {
    return NextResponse.json({ error: `Version ${v} does not exist.` }, { status: 404 });
  }

  try {
    const result = await verifyVersion(convo, v, target, body.evidence);
    // Kept, so a reload shows the last verdicts instead of an empty box.
    const record = recordVerification(convo, { v: result.v, target, profileId: result.profileId, report: result.report, evidence: body.evidence });
    saveConversation(convo);
    const { report } = result;
    return NextResponse.json({
      v: result.v,
      profileId: result.profileId,
      packageValid: report.package_valid,
      semanticId: report.package_semantic_id,
      verdicts: report.verdicts,
      diagnostics: report.diagnostics,
      json: report.json,
      evidenceKept: record.evidenceKept,
    });
  } catch (error) {
    saveConversation(convo);
    const name = error instanceof Error ? error.name : "";
    const status = name === "EvidenceShapeError" ? 400 : 502;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), conversationIntact: true },
      { status },
    );
  }
}

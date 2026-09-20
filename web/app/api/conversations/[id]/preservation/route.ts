import { NextResponse } from "next/server";

import { loadConversation, saveConversation } from "@/lib/store";
import { preservationFor } from "@/lib/preservation";

interface Params {
  params: { id: string };
}

/**
 * Both preservation layers, in one response and never in one list (WS-R28, AC-043).
 *
 * `GET` answers with Layer 1 alone — deterministic, free, and always available.
 * `POST` additionally runs Layer 2 over a pair of versions, which is the
 * **opt-in** half (WS-R29): it costs at most two extraction calls, it happens
 * on its own request rather than inside a turn, and a failure in it is
 * reported without touching the deterministic verdict beside it.
 *
 * The payload keeps the layers in separate keys, each carrying its own `layer`
 * tag, so no client can render them as one undifferentiated list even by
 * accident.
 */
function payload(view: Awaited<ReturnType<typeof preservationFor>>, driftError?: string): Record<string, unknown> {
  const { ledger } = view.result;
  return {
    ledger: {
      layer: "deterministic",
      guarantee: true,
      v: ledger.v,
      findings: ledger.findings,
      diagnostics: ledger.diagnostics,
    },
    drift: view.drift
      ? {
          layer: "judged",
          guarantee: false,
          advisory: true,
          from: view.drift.from,
          to: view.drift.to,
          compared: view.drift.compared,
          skippedPinned: view.drift.skippedPinned,
          discarded: view.drift.discarded,
          findings: view.drift.findings.map((f) => ({
            kind: f.kind,
            similarity: f.similarity,
            from: f.from,
            nearest: f.nearest,
            diagnostic: f.diagnostic,
          })),
        }
      : null,
    // Null drift never means "nothing drifted" — say which it is.
    driftRan: view.drift !== null,
    ...(driftError ? { driftError } : {}),
    citations: view.citations,
    extractedCalls: view.extractedCalls,
  };
}

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json(payload(await preservationFor(convo, null)));
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { from?: unknown; to?: unknown; provider?: unknown; model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const versions = convo.promptVersions.map((p) => p.v).sort((a, b) => a - b);
  const to = typeof body.to === "number" ? body.to : convo.currentV;
  const from = typeof body.from === "number" ? body.from : (versions[versions.indexOf(to) - 1] ?? versions[0]);
  if (from === undefined || !versions.includes(from) || !versions.includes(to)) {
    return NextResponse.json({ error: "Two existing versions are needed to compare." }, { status: 400 });
  }
  if (from === to) {
    return NextResponse.json({ error: "Pick two different versions to compare." }, { status: 400 });
  }

  const options = {
    ...(typeof body.provider === "string" ? { provider: body.provider } : {}),
    ...(typeof body.model === "string" ? { model: body.model } : {}),
  };

  try {
    const view = await preservationFor(convo, { from, to }, options);
    saveConversation(convo);
    return NextResponse.json(payload(view));
  } catch (error) {
    // WS-R27.3: Layer 2 failing changes nothing about Layer 1. The
    // deterministic verdict is computed again and returned, with the advisory
    // half reported as what it is — absent, not silent.
    saveConversation(convo);
    const fallback = await preservationFor(convo, null);
    return NextResponse.json(
      payload(fallback, error instanceof Error ? error.message : String(error)),
      { status: 200 },
    );
  }
}

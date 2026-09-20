import { NextResponse } from "next/server";

import { getDefaultModel, resolveProvider, setDefaultModel } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ defaultModel: getDefaultModel() });
}

export async function PUT(request: Request): Promise<NextResponse> {
  let body: { provider?: unknown; model?: unknown; custom?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body.provider !== "string" || typeof body.model !== "string" || !body.model.trim()) {
    return NextResponse.json({ error: "Provide {provider, model}." }, { status: 400 });
  }
  if (!resolveProvider(body.provider)) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }
  // `custom` marks a typed model id, so a refresh restores it as typed rather
  // than discarding it as a stale list entry.
  setDefaultModel(body.provider, body.model.trim(), body.custom === true);
  return NextResponse.json({ defaultModel: getDefaultModel() });
}

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { createCustomProvider, getDefaultModel, listProviderSummaries } from "@/lib/providers";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ providers: listProviderSummaries(), defaultModel: getDefaultModel() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: { name?: unknown; baseURL?: unknown; model?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const created = createCustomProvider({
      name: typeof body.name === "string" ? body.name : "",
      baseURL: typeof body.baseURL === "string" ? body.baseURL : "",
      model: typeof body.model === "string" ? body.model : "",
    });
    return NextResponse.json({ provider: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

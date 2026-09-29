import { NextResponse } from "next/server";

import { deleteProvider, ProviderInputError, resolveProvider, saveProvider } from "@/lib/providers";

interface Params {
  params: Promise<{ id: string }>;
}

function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export async function PUT(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const id = decodeId(params.id);
  if (!resolveProvider(id)) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  let body: {
    enabled?: unknown;
    displayName?: unknown;
    apiKey?: unknown;
    baseURL?: unknown;
    defaultModel?: unknown;
    headers?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (body.headers !== undefined && body.headers !== null && (typeof body.headers !== "object" || Array.isArray(body.headers))) {
    return NextResponse.json({ error: "headers must be an object of name/value pairs." }, { status: 400 });
  }
  let saved;
  try {
    saved = saveProvider(id, {
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
      baseURL: typeof body.baseURL === "string" ? body.baseURL : body.baseURL === null ? null : undefined,
      defaultModel: typeof body.defaultModel === "string" ? body.defaultModel : undefined,
      headers: body.headers === null ? null : (body.headers as Record<string, string> | undefined),
    });
  } catch (error) {
    if (error instanceof ProviderInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ provider: saved });
}

export async function DELETE(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const id = decodeId(params.id);
  const result = deleteProvider(id);
  if (!result.deleted && !result.reset) {
    return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  }
  return NextResponse.json(result);
}

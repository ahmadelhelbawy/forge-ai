import { NextResponse } from "next/server";

import { bindRepository, boundRepository, unbindRepository } from "@/lib/requirements";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Repository binding (RB-R1–RB-R3, `spec.md` §22.10).
 *
 * `POST {path}` binds, `DELETE` unbinds, `GET` reports. Each is an explicit user
 * action; nothing else in the workspace binds a repository. The response names
 * the bound root to the user who asked for it and carries no file content.
 */
export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  if (convo.repository === null) return NextResponse.json({ bound: false, root: null, usable: false });
  try {
    boundRepository(convo);
    return NextResponse.json({ bound: true, root: convo.repository.root, usable: true });
  } catch (error) {
    // Bound, but the allowlist no longer admits it (RB-R2): say so, read nothing.
    return NextResponse.json({
      bound: true,
      root: convo.repository.root,
      usable: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let body: { path?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body.path !== "string" || body.path.trim() === "") {
    return NextResponse.json({ error: "A repository path is required." }, { status: 400 });
  }
  try {
    const binding = bindRepository(convo, body.path.trim());
    saveConversation(convo);
    return NextResponse.json({ bound: true, root: binding.root, usable: true }, { status: 201 });
  } catch (error) {
    // Matched by name: routes reach the core only through web/lib/requirements (AC-053).
    if (error instanceof Error && error.name === "RepositoryBindingRefused") {
      const reason = (error as Error & { reason: string }).reason;
      return NextResponse.json({ error: error.message, reason }, { status: reason === "not-configured" ? 403 : 400 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const was = unbindRepository(convo);
  if (was) saveConversation(convo);
  return NextResponse.json({ bound: false, root: null, usable: false, unbound: was });
}

import { NextResponse } from "next/server";
import { routeErrorMessage } from "@/lib/turn/http";

import { packageVersion, PackageLeakError } from "@/lib/package";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * Build an Execution Package for a prompt version (V2-F, `FR-040`, `FR-046`).
 *
 * `POST` because the first packaging of a version may extract its IR;
 * `extracted` says whether this one did, and the conversation is saved so a
 * second call is free.
 *
 * The response carries the package as **files with their bytes**, not as a
 * zip: the client writes them, and a consumer needs only JSON parsing to read
 * what lands (`PK-R8`). Returning an opaque archive would put a decoder
 * between the user and a format whose whole point is that it needs none.
 *
 * This route **writes no prompt version and executes nothing** (`WS-R2`,
 * `INV-004`).
 */
export async function POST(request: Request, context: Params): Promise<Response> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { target?: string; v?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body means "the current version, for this conversation's target".
  }

  const target = body.target ?? convo.target ?? "generic";
  const v = body.v ?? convo.currentV;
  if (convo.promptVersions.length === 0) {
    return NextResponse.json({ error: "This conversation has no prompt to package yet." }, { status: 409 });
  }
  if (!convo.promptVersions.some((p) => p.v === v)) {
    return NextResponse.json({ error: `Version ${v} does not exist.` }, { status: 404 });
  }

  try {
    const built = await packageVersion(convo, v, target);
    saveConversation(convo);
    return NextResponse.json({
      v: built.v,
      target: built.target,
      profileId: built.profileId,
      semanticId: built.package.semanticId,
      refused: built.refused,
      extracted: built.extracted,
      files: [...built.package.files, built.package.run].map((f) => ({
        path: f.path,
        content: f.content,
        contentHash: f.contentHash,
        bytes: Buffer.byteLength(f.content, "utf8"),
      })),
    });
  } catch (error) {
    saveConversation(convo);
    const status = error instanceof PackageLeakError ? 500 : 502;
    return NextResponse.json(
      // Through the same classifier as a chat failure: a status in the user's
      // terms, never a provider's raw body (which was once a whole HTML page).
      { error: routeErrorMessage(convo, error, "package"), conversationIntact: true },
      { status },
    );
  }
}

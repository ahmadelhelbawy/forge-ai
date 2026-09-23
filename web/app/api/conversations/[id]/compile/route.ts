import { NextResponse } from "next/server";

import { compileVersionForTargets, MAX_COMPILE_TARGETS, profileForTarget, type VersionCompilation } from "@/lib/compile";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: { id: string };
}

/**
 * Compile a prompt version for a target (V2-R step 9, FR-018).
 *
 * `POST` because it may need a model call — the first compilation of a version
 * extracts its IR, and `extracted` in the response says whether this one did.
 * Subsequent compilations of the same version are free, which is why the
 * conversation is saved: the extracted IR is cached on it exactly as the
 * preservation path caches it.
 *
 * This route WRITES NO PROMPT VERSION and never can. Compiling is a read of the
 * current prompt: the prose stays the truth (WS-R2 admits only
 * CREATE/REVISE/MERGE/RESTORE as writers, and none of them is reachable from
 * here). The artifacts are the compiler's output, offered for export.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  let body: { target?: string; targets?: unknown; v?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body means "the current version, for this conversation's target".
  }

  // WS-R41: `targets` asks for several profiles at once; `target` stays the
  // single-target form, answered in the single-target shape it always had.
  let targets: string[];
  const many = body.targets !== undefined;
  if (many) {
    if (!Array.isArray(body.targets) || body.targets.length === 0 || !body.targets.every((t) => typeof t === "string")) {
      return NextResponse.json({ error: "`targets` must be a non-empty list of target ids." }, { status: 400 });
    }
    targets = [...new Set(body.targets as string[])];
    if (targets.length > MAX_COMPILE_TARGETS) {
      return NextResponse.json({ error: `At most ${MAX_COMPILE_TARGETS} targets per request.` }, { status: 400 });
    }
  } else {
    targets = [body.target ?? convo.target ?? "generic"];
  }
  const v = body.v ?? convo.currentV;
  if (convo.promptVersions.length === 0) {
    return NextResponse.json({ error: "This conversation has no prompt to compile yet." }, { status: 409 });
  }
  if (!convo.promptVersions.some((p) => p.v === v)) {
    return NextResponse.json({ error: `Version ${v} does not exist.` }, { status: 404 });
  }

  // An unknown target is the request being wrong, not a server fault, and it is
  // answered as such rather than as a 500 with a stack behind it.
  for (const target of targets) {
    try {
      profileForTarget(target);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : `Unknown target "${target}".` },
        { status: 400 },
      );
    }
  }

  try {
    const results = await compileVersionForTargets(convo, v, targets);
    saveConversation(convo);
    return NextResponse.json(many ? { v, results: results.map(wire) } : wire(results[0]!));
  } catch (error) {
    // The conversation may carry a newly extracted IR even when compilation
    // then failed; keeping it means a retry does not pay for the call twice.
    saveConversation(convo);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), conversationIntact: true },
      { status: 502 },
    );
  }
}

/** One target's compilation as the wire carries it; the single-target shape. */
function wire(result: VersionCompilation) {
  return {
    v: result.v,
    target: result.target,
    profileId: result.profileId,
    semanticHash: result.semanticHash,
    extracted: result.extracted,
    refused: result.refused,
    tokenizer: result.tokenizer,
    artifacts: result.artifacts.map((a) => ({
      path: a.path,
      content: a.content,
      contentHash: a.content_hash,
      bytes: Buffer.byteLength(a.content, "utf8"),
    })),
    // Spans are the evidence behind INV-010 and what makes `forge explain`
    // possible. They travel with the artifacts so a client can show where a
    // byte came from rather than asking the user to take it on faith.
    spans: result.spans.map((s) => ({
      artifactPath: s.artifact_path,
      start: s.start,
      end: s.end,
      origin: s.origin,
    })),
    diagnostics: result.diagnostics.map((d) => ({
      code: d.code,
      name: d.name,
      severity: d.severity,
      source: d.source,
      message: d.message,
      evidence: d.evidence,
    })),
  };
}

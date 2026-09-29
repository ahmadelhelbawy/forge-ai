import { NextResponse } from "next/server";

import { ingestAttachment } from "@/lib/attachments";
import { loadConversation, saveConversation } from "@/lib/store";

interface Params {
  params: Promise<{ id: string }>;
}

const ALLOWED_EXT = new Set([
  ".txt", ".md", ".markdown", ".json", ".js", ".ts", ".tsx", ".jsx",
  ".py", ".yaml", ".yml", ".css", ".html", ".sql", ".sh", ".toml", ".xml",
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 5;

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export async function POST(request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Request must be multipart form-data." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "No files attached." }, { status: 400 });
  if (convo.attachments.length + files.length > MAX_FILES) {
    return NextResponse.json({ error: `At most ${MAX_FILES} attachments per conversation.` }, { status: 413 });
  }
  const added: Array<{
    name: string;
    size: number;
    truncated: boolean;
    trust: string;
    redactions: Array<{ rule: string; count: number }>;
  }> = [];
  for (const file of files) {
    const ext = extOf(file.name);
    if (!ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.name}.` }, { status: 415 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${file.name} exceeds 512KB.` }, { status: 413 });
    }
    // Scanned and trust-classified BEFORE it is stored, so no un-redacted copy
    // ever reaches the object store or a provider (SC-R6, INV-002).
    const ingested = ingestAttachment(file.name, await file.text());
    convo.attachmentContents[file.name] = ingested.content;
    const meta = {
      name: file.name,
      size: file.size,
      truncated: false,
      at: new Date().toISOString(),
      trust: ingested.trust,
      // Rule and count only. A record of a secret must never be a second copy
      // of the secret, which is why `SecretFinding` carries no value.
      redactions: ingested.findings.map((f) => ({ rule: f.rule, count: f.count })),
    };
    const existing = convo.attachments.findIndex((a) => a.name === file.name);
    if (existing >= 0) convo.attachments[existing] = meta;
    else convo.attachments.push(meta);
    added.push({
      name: file.name,
      size: file.size,
      truncated: false,
      trust: ingested.trust,
      redactions: meta.redactions,
    });
  }
  saveConversation(convo);
  return NextResponse.json({ attachments: convo.attachments, added }, { status: 201 });
}

export async function GET(_request: Request, context: Params): Promise<NextResponse> {
  const params = await context.params;
  const convo = loadConversation(params.id);
  if (!convo) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ attachments: convo.attachments });
}

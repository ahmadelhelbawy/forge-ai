import { NextResponse } from "next/server";

import { describeDiscovered } from "@/lib/opencode-models";
import { resolveProvider } from "@/lib/providers";

interface Params {
  params: { id: string };
}

function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/**
 * Model list for one provider: live discovery where the endpoint supports
 * it, otherwise the curated presets. Failures fall back silently — the
 * selector always offers presets plus a custom ID field.
 */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const id = decodeId(params.id);
  const eff = resolveProvider(id);
  if (!eff) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });
  let discovered: string[] | null = null;
  const isOpenCode = id === "opencode-go" || (eff.baseURL ?? "").includes("opencode.ai/zen");
  if (eff.kind === "openai-compat" && eff.apiKey && eff.baseURL) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const response = await fetch(`${eff.baseURL.replace(/\/+$/, "")}/models`, {
        headers: { authorization: `Bearer ${eff.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.ok) {
        const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
        if (Array.isArray(body.data)) {
          discovered = body.data
            .map((d) => (typeof d.id === "string" ? d.id : ""))
            .filter((modelId) => modelId.length > 0)
            .sort();
        }
      }
    } catch {
      discovered = null;
    }
  }
  // Real objects, not labels: the UI shows displayName, the API receives id,
  // and protocol says how the model must be routed. An id we cannot route is
  // returned with protocol null so it can be shown as unsupported.
  const models =
    discovered && isOpenCode ? describeDiscovered(discovered) : (discovered ?? []).map((m) => ({ id: m, displayName: m, protocol: null }));
  return NextResponse.json({
    provider: id,
    discovered,
    models,
    source: discovered ? "discovered" : "presets",
  });
}

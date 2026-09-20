import { NextResponse } from "next/server";

import { listTargets } from "@/lib/forge";
import { getDefaultModel, listModelOptions, listProviderSummaries } from "@/lib/providers";

/**
 * Catalog for the top bar: provider summaries (masked, never secrets),
 * targets, models from ENABLED providers only (presets; per-provider
 * discovery refreshes lazily), and the stored default model.
 *
 * MUST be dynamic. This route reads the settings store, which only exists at
 * runtime; prerendering it froze an empty catalog into the build, so the UI
 * reported "No models available" no matter what the user had configured.
 */
export const dynamic = "force-dynamic";
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    providers: listProviderSummaries(),
    targets: listTargets(),
    models: await listModelOptions(),
    defaultModel: getDefaultModel(),
  });
}

export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { listProviderSummaries } from "@/lib/providers";
import { dataDir } from "@/lib/store";
import { accessSync, constants, mkdirSync } from "node:fs";

export async function GET(): Promise<NextResponse> {
  let storage: string;
  try {
    mkdirSync(dataDir(), { recursive: true });
    accessSync(dataDir(), constants.W_OK);
    storage = "writable";
  } catch {
    storage = "unavailable";
  }
  // Availability only — never a key, masked or otherwise.
  const providers = listProviderSummaries().filter((p) => p.enabled);
  return NextResponse.json({
    ok: storage === "writable",
    version: "0.1.0",
    time: new Date().toISOString(),
    storage,
    providers: providers.map((p) => ({
      id: p.id,
      available: p.maskedKey.length > 0,
      defaultModel: p.defaultModel,
      baseUrlConfigured: p.baseURL !== null,
    })),
  });
}

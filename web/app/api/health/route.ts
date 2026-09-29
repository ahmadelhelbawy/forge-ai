export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { listProviderSummaries } from "@/lib/providers";
import { dataDir, store } from "@/lib/store";
import { accessSync, constants, mkdirSync } from "node:fs";

export async function GET(): Promise<NextResponse> {
  let storage: string;
  let damagedLines = 0;
  try {
    mkdirSync(dataDir(), { recursive: true });
    accessSync(dataDir(), constants.W_OK);
    storage = "writable";
    // INV-012: a torn or corrupted log line is skipped on read, never hidden.
    damagedLines = store().log.damaged().length;
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
    damagedLogLines: damagedLines,
    providers: providers.map((p) => ({
      id: p.id,
      available: p.maskedKey.length > 0,
      defaultModel: p.defaultModel,
      baseUrlConfigured: p.baseURL !== null,
    })),
  });
}

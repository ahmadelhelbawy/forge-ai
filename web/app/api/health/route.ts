export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { listProviders } from "@/lib/forge";
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
  const providers = listProviders();
  return NextResponse.json({
    ok: storage === "writable",
    version: "0.1.0",
    time: new Date().toISOString(),
    storage,
    providers: providers.map((p) => ({
      id: p.id,
      available: p.available,
      defaultModel: p.defaultModel,
      baseUrlConfigured: p.baseUrlConfigured,
    })),
  });
}

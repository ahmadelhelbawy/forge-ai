import { NextResponse } from "next/server";

import { endpointFor, generate } from "@/lib/ai-provider";
import {
  classifyFailure,
  formatDiagnostic,
  logProviderFailure,
  providerDiagnostic,
} from "@/lib/diagnostics";
import { resolveCall, transportFor, UnsupportedModelError } from "@/lib/forge";
import { recordTestResult, resolveProvider } from "@/lib/providers";

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
 * Live connection test against the values currently on screen.
 *
 * The request body may carry an unsaved apiKey/baseURL/model: testing stored
 * state instead silently tested the PREVIOUS key and reported it as this
 * one's result. Nothing here is persisted except the pass/fail verdict.
 *
 * The session id is stable for the test so repeated clicks reuse one session,
 * as the OpenCode Go docs require.
 */
export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const id = decodeId(params.id);
  const summary = resolveProvider(id);
  if (!summary) return NextResponse.json({ error: "Unknown provider." }, { status: 404 });

  let body: { model?: unknown; apiKey?: unknown; baseURL?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const overrides = {
    ...(typeof body.apiKey === "string" && body.apiKey.trim() ? { apiKey: body.apiKey } : {}),
    ...(typeof body.baseURL === "string" ? { baseURL: body.baseURL } : {}),
  };
  const requestedModel = typeof body.model === "string" ? body.model : undefined;

  const started = Date.now();
  let call;
  try {
    call = resolveCall(id, requestedModel, overrides);
  } catch (error) {
    // Configuration is wrong before any network call: no endpoint to report.
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof UnsupportedModelError ? 400 : 400;
    recordTestResult(id, false, message);
    return NextResponse.json({ ok: false, error: message, message, diagnostic: message }, { status });
  }

  const spec = transportFor(call, `forge-connection-test-${call.providerId}`);
  try {
    const result = await generate(spec, {
      system: "You are a connection check. Reply with exactly: FORGE_OK",
      prompt: "ping",
      // Generous on purpose: reasoning models spend the budget on reasoning
      // first, and a tiny cap returns an empty text part that looks like a
      // silent failure rather than a working connection.
      maxTokens: 512,
      temperature: 0,
    });
    const message =
      `${call.displayName} connected — ${call.displayModel} (${call.modelId}) ` +
      `over ${call.protocol} in ${Date.now() - started}ms.`;
    recordTestResult(id, true, message);
    return NextResponse.json({
      ok: true,
      message,
      model: call.modelId,
      displayModel: call.displayModel,
      protocol: call.protocol,
      reply: result.text.slice(0, 200),
    });
  } catch (error) {
    const diagnostic = providerDiagnostic(error, {
      provider: call.displayName,
      stage: "connection test",
      model: call.modelId,
      protocol: call.protocol,
      endpoint: endpointFor(spec),
    });
    const message = classifyFailure(diagnostic);
    logProviderFailure(diagnostic);
    recordTestResult(id, false, message);
    return NextResponse.json(
      {
        ok: false,
        message,
        error: message,
        model: call.modelId,
        protocol: call.protocol,
        diagnostic: `${message}\n\n${formatDiagnostic(diagnostic)}`,
        detail: diagnostic,
      },
      { status: 502 },
    );
  }
}

/**
 * What both turn routes must do before and after the pipeline runs.
 *
 * Next.js route files may only export handlers, and V2-B gave the product two
 * of them (whole-response and SSE) over the same turn. The shared half lives
 * here so validation, provider selection and failure reporting cannot differ
 * between them.
 */
import { NextResponse } from "next/server";
import { ProviderError } from "forge/dist/model/provider.js";

import {
  classifyFailure,
  formatDiagnostic,
  logProviderFailure,
  providerDiagnostic,
} from "@/lib/diagnostics";
import { currentPrompt, saveConversation, type Conversation } from "@/lib/store";
import { isReasoningEffort } from "@/lib/store-types";
import { buildDeps, stubDeps } from "@/lib/turn/deps";
import type { TurnDeps } from "@/lib/turn/pipeline";
import { ReasoningUnsupportedError } from "@/lib/reasoning";
import { reasoningFor } from "@/lib/reasoning-resolve";
import { isTransformationMode, type TransformationMode } from "forge/dist/conversation/intake.js";

export interface TurnRequestBody {
  content?: unknown;
  target?: unknown;
  provider?: unknown;
  model?: unknown;
  regenerate?: unknown;
  /** WS-R31: the explicit generate control. */
  generate?: unknown;
  /** WS-R38: the mode chosen with the generate control. */
  mode?: unknown;
  /** WS-R43: the reasoning effort chosen in the header. */
  reasoningEffort?: unknown;
}

export interface PreparedTurn {
  readonly content: string;
  readonly regenerate: boolean;
  readonly generate: boolean;
  readonly mode?: TransformationMode;
  readonly before: string | null;
  /** This request named a reasoning effort, so an unsupported one is refused (WS-R42). */
  readonly effortNamed: boolean;
}

/**
 * Validate, apply the header selections, and work out which message this turn
 * is about. Returns a response instead when the request cannot become a turn.
 *
 * A retry may arrive with no content: the last thing the user asked for is
 * the thing to re-run, and the server decides that rather than trusting the
 * client to echo it back.
 */
export function prepareTurn(convo: Conversation, body: TurnRequestBody): PreparedTurn | NextResponse {
  const regenerate = body.regenerate === true;
  const generate = body.generate === true;
  if (regenerate && generate) {
    return NextResponse.json({ error: "A turn is either a retry or a generate request, not both." }, { status: 400 });
  }
  if (body.mode !== undefined && body.mode !== null) {
    if (!isTransformationMode(body.mode)) {
      return NextResponse.json({ error: "`mode` must be polish, strengthen or rebuild." }, { status: 400 });
    }
    if (!generate) {
      return NextResponse.json({ error: "A mode applies only to a generate request." }, { status: 400 });
    }
  }
  if (body.reasoningEffort !== undefined && !isReasoningEffort(body.reasoningEffort)) {
    return NextResponse.json({ error: "`reasoningEffort` must be default, low, medium or high." }, { status: 400 });
  }
  let content = typeof body.content === "string" ? body.content.trim() : "";
  // WS-R31: pressing Generate is itself the message. Its wording is FORGE's,
  // shown in the transcript so the transition is visible where it happened.
  if (generate && !content) content = "Generate the prompt from what we have discussed.";

  if (regenerate) {
    const lastUser = [...convo.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return NextResponse.json({ error: "There is no message to regenerate." }, { status: 409 });
    }
    content = lastUser.content;
  }
  if (!content) return NextResponse.json({ error: "Message content must not be empty." }, { status: 400 });
  if (content.length > 200_000) {
    return NextResponse.json({ error: "Message too large (200k character limit)." }, { status: 413 });
  }

  if (typeof body.provider === "string" && !body.provider && !convo.provider && !process.env["FORGE_CHAT_STUB"]) {
    return NextResponse.json(
      { error: "No model is selected yet. Choose a provider and model in the header, then send again." },
      { status: 400 },
    );
  }
  if (typeof body.target === "string" && body.target) convo.target = body.target;
  if (typeof body.provider === "string" && body.provider) convo.provider = body.provider;
  if (typeof body.model === "string") convo.model = body.model;
  if (isReasoningEffort(body.reasoningEffort)) convo.reasoningEffort = body.reasoningEffort;

  if (convo.messages.length === 0 && convo.title === "New conversation") {
    convo.title = content.slice(0, 80);
  }
  return {
    content,
    regenerate,
    generate,
    ...(isTransformationMode(body.mode) ? { mode: body.mode } : {}),
    before: currentPrompt(convo),
    effortNamed: isReasoningEffort(body.reasoningEffort),
  };
}

/**
 * `effortNamed`: whether this request itself named an effort. Only a named
 * effort is refused for a model that cannot take it (WS-R42); a preference
 * stored on the conversation and not applicable to the current model sends
 * nothing, so switching to such a model and back does not erase the choice.
 */
export async function depsFor(convo: Conversation, before: string | null, effortNamed = true): Promise<TurnDeps> {
  if (process.env["FORGE_CHAT_STUB"]) return stubDeps(convo, before);
  return buildDeps(convo, before, await reasoningFor(convo, { strict: effortNamed }));
}

/** A request the conversation's settings make impossible: a 400, not a provider failure. */
export function settingsRefusal(convo: Conversation, error: unknown): NextResponse | null {
  if (!(error instanceof ReasoningUnsupportedError)) return null;
  saveConversation(convo);
  return NextResponse.json({ error: error.message, conversationIntact: true }, { status: 400 });
}

/** The user-facing text and full diagnostic for a provider failure. */
export function failureReport(
  convo: Conversation,
  error: unknown,
  stage = "chat",
): { message: string; diagnostic: string; detail: unknown } {
  const finding = providerDiagnostic(error, {
    provider: convo.provider,
    stage,
    ...(convo.model ? { model: convo.model } : {}),
  });
  logProviderFailure(finding);
  const message = classifyFailure(finding);
  return { message, diagnostic: `${message}\n\n${formatDiagnostic(finding)}`, detail: finding };
}

/**
 * WS-R12: the user's message is kept; no assistant message and no version was
 * written. Nothing is lost except the failed turn itself.
 */
export function failure(convo: Conversation, error: unknown): NextResponse {
  saveConversation(convo);
  const report = failureReport(convo, error);
  return NextResponse.json(
    {
      error: report.message,
      diagnostic: report.diagnostic,
      detail: report.detail,
      conversationIntact: true,
    },
    { status: 502 },
  );
}

/**
 * The error text a non-turn route (compile, package, verify) returns. A
 * provider failure goes through the same classifier as a chat failure; any
 * other error — invalid evidence, an unknown target — is FORGE's own message,
 * returned as written and not logged as a provider failure.
 */
export function routeErrorMessage(convo: Conversation, error: unknown, stage: string): string {
  const e = error as { provider?: unknown; statusCode?: unknown } | null;
  const fromProvider =
    error instanceof ProviderError || (typeof e === "object" && e !== null && typeof e.statusCode === "number");
  if (fromProvider) return failureReport(convo, error, stage).message;
  return error instanceof Error ? error.message : String(error);
}

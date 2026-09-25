/**
 * The `conversation.generate` model boundary (WS-R2, WS-R3, AD-22).
 *
 * AD-22 recorded an open question: governing the cheap classification call
 * while leaving the expensive generation call ungoverned is incoherent, and
 * V2-A had to decide in writing. It is registered. The objection AD-22 raised
 * — that its output is prose — is answered by what the boundary actually
 * governs: not the prose, but the ENVELOPE around it, and the relation
 * between the action that was resolved and whether a prompt came back.
 *
 * That relation is the WS-R3 check, and it is deterministic: a read-only
 * action accompanied by a prompt is a boundary failure. The same rule is
 * applied again by the turn pipeline before any write, because a boundary
 * failure must not be the only thing standing between a question and a
 * spurious version.
 *
 * The workspace composes the prompt (targets, attachments, history), so the
 * input is the rendered pair rather than a template this module owns. That
 * keeps the cassette key content-addressed over exactly what was sent.
 */
import { z } from "zod";

import { CONVERSATION_ACTIONS, writesVersion, type ConversationAction } from "./actions.js";
import { cassetteKey } from "../model/cassette.js";
import type { ModelBoundary } from "../model/boundaries.js";

export const CONVERSATION_GENERATE_ID = "conversation.generate";
export const CONVERSATION_GENERATE_VERSION = "1";

export const ConversationGenerateInputSchema = z.strictObject({
  action: z.enum(CONVERSATION_ACTIONS),
  system: z.string().min(1),
  user: z.string().min(1),
});
export type ConversationGenerateInput = z.infer<typeof ConversationGenerateInputSchema>;

/** `reply` is chat markdown; `prompt` is the full revised prompt or null. */
export const ConversationEnvelopeSchema = z.strictObject({
  reply: z.string().min(1),
  prompt: z.string().nullable(),
});
export type ConversationEnvelope = z.infer<typeof ConversationEnvelopeSchema>;

/**
 * Pull the envelope out of model chatter. Returns null when there is none —
 * the caller degrades to a reply-only turn and records a diagnostic (INV-012).
 * Never a guess at what the model meant to write.
 */
/**
 * Remove commas that directly precede a closing `}` or `]`, outside strings.
 *
 * The one syntactic tolerance FORGE applies to model JSON, and it is lossless:
 * `[a, b,]` can only mean `[a, b]`. Measured live in the hardening pass — a
 * trailing comma turned a complete, correct discovery answer into a W003 and
 * a repair call. Nothing else is repaired, and no value is reinterpreted.
 */
export function stripTrailingCommas(json: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i += 1) {
    const ch = json[i] as string;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j] as string)) j += 1;
      if (json[j] === "}" || json[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/** JSON.parse, then once more with trailing commas removed. Throws if both fail. */
export function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (first) {
    const cleaned = stripTrailingCommas(text);
    if (cleaned === text) throw first;
    return JSON.parse(cleaned);
  }
}

export function parseEnvelope(text: string): ConversationEnvelope | null {
  return readEnvelope(text).envelope;
}

/** The same read, with the reason it failed, for the W003 the caller emits. */
export function readEnvelope(text: string): { envelope: ConversationEnvelope | null; problem: string | null } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return { envelope: null, problem: "no JSON object in the response" };
  let payload: unknown;
  try {
    payload = parseModelJson(text.slice(start, end + 1));
  } catch (error) {
    return { envelope: null, problem: `invalid JSON (${error instanceof Error ? error.message : String(error)})` };
  }
  if (typeof payload !== "object" || payload === null) return { envelope: null, problem: "the JSON is not an object" };
  const raw = payload as { reply?: unknown; prompt?: unknown };
  const reply = typeof raw.reply === "string" && raw.reply.trim().length > 0 ? raw.reply : null;
  if (reply === null) return { envelope: null, problem: "no non-empty `reply` string" };
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim().length > 0 ? raw.prompt : null;
  return { envelope: { reply, prompt }, problem: null };
}

export const generateValidators = {
  /**
   * WS-R3, checked on the effect rather than the label: six of the ten actions
   * are read-only with respect to the artifact, and a response that carries a
   * prompt under one of them is a failure.
   */
  readOnlyActionWritesNoPrompt(
    input: ConversationGenerateInput,
    output: ConversationEnvelope,
  ): readonly string[] {
    if (writesVersion(input.action as ConversationAction)) return [];
    return output.prompt === null
      ? []
      : [`${input.action} is read-only with respect to the prompt, but the response carried a new prompt.`];
  },
} as const;

export const conversationGenerateBoundary: ModelBoundary<ConversationGenerateInput, ConversationEnvelope> = {
  id: CONVERSATION_GENERATE_ID,
  version: CONVERSATION_GENERATE_VERSION,
  inputSchema: ConversationGenerateInputSchema,
  outputSchema: ConversationEnvelopeSchema,
  postValidators: [generateValidators.readOnlyActionWritesNoPrompt],
  cassetteKey: (input) =>
    cassetteKey(
      CONVERSATION_GENERATE_ID,
      CONVERSATION_GENERATE_VERSION,
      `${input.action}\n${input.system}\n${input.user}`,
    ),
  // A response FORGE cannot read as an envelope still has something in it for
  // the user. It degrades to reply-only, and it can never produce a version —
  // which is the property that matters (WS-R2).
  required: false,
  onFailure: "skip",
};

/** One field's worth of newly decoded text. Never anything else (WS-R11). */
export interface EnvelopeDelta {
  readonly field: "reply" | "prompt";
  readonly text: string;
}

export interface EnvelopeStreamReader {
  /** Feed the next chunk; get the text that became readable because of it. */
  push(chunk: string): readonly EnvelopeDelta[];
  /** Everything fed so far, so `parseEnvelope` stays the authority. */
  raw(): string;
  /** The streamed fields whose closing quote has been read: known to be whole. */
  completed(): ReadonlySet<"reply" | "prompt">;
}

type ReaderState = "before" | "object" | "key" | "colon" | "value" | "string" | "scalar" | "nested" | "done";

const STREAMED_FIELDS: readonly string[] = ["reply", "prompt"];
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Read an envelope as it arrives, one chunk at a time (WS-R10).
 *
 * This is a presentation device and nothing more: it lets the UI show text
 * the moment it exists instead of after the last token. What the turn
 * PRODUCED is still decided by `parseEnvelope` over `raw()`, so a stream that
 * ends mid-object changes nothing about the artifact.
 *
 * WS-R11 is enforced by the shape rather than by a filter: a delta can only
 * name `reply` or `prompt`, so any other key the model invents — `reasoning`,
 * `thinking`, a scratchpad — is consumed and dropped with nowhere to surface.
 * Text before the opening brace is likewise never emitted.
 *
 * Partial escapes are the one real subtlety: a chunk may end on `\` or inside
 * a `\uXXXX`, so the reader stops at the incomplete sequence and resumes when
 * the rest arrives. Nothing is emitted twice and nothing is guessed.
 */
export function createEnvelopeStreamReader(): EnvelopeStreamReader {
  let raw = "";
  let buffer = "";
  let at = 0;
  let state: ReaderState = "before";
  let key = "";
  let emitting = false;
  // For a nested value (the `coverage` array an explicit generate may add):
  // skipped, bracket by bracket, so a field after it still streams.
  const done = new Set<"reply" | "prompt">();
  let depth = 0;
  let nestedString = false;
  let nestedEscape = false;

  function readStringBody(deltas: EnvelopeDelta[]): boolean {
    // Returns true when the closing quote was consumed.
    let out = "";
    while (at < buffer.length) {
      const ch = buffer[at] as string;
      if (ch === '"') {
        at += 1;
        if (out && emitting) deltas.push({ field: key as "reply" | "prompt", text: out });
        else if (out && state === "key") key += out;
        return true;
      }
      if (ch !== "\\") {
        out += ch;
        at += 1;
        continue;
      }
      const next = buffer[at + 1];
      if (next === undefined) break; // wait for the rest of the escape
      if (next === "u") {
        const hex = buffer.slice(at + 2, at + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        at += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      at += 2;
    }
    if (out) {
      if (emitting) deltas.push({ field: key as "reply" | "prompt", text: out });
      else if (state === "key") key += out;
    }
    return false;
  }

  function step(deltas: EnvelopeDelta[]): boolean {
    // Returns false when more input is needed.
    switch (state) {
      case "before": {
        const brace = buffer.indexOf("{", at);
        if (brace === -1) {
          at = buffer.length;
          return false;
        }
        at = brace + 1;
        state = "object";
        return true;
      }
      case "object": {
        while (at < buffer.length && /[\s,]/.test(buffer[at] as string)) at += 1;
        if (at >= buffer.length) return false;
        const ch = buffer[at] as string;
        if (ch === "}") {
          state = "done";
          return false;
        }
        if (ch !== '"') {
          // Not a key: an object shape FORGE does not read. Stop streaming and
          // let parseEnvelope have the final word on the whole text.
          state = "done";
          return false;
        }
        at += 1;
        key = "";
        state = "key";
        emitting = false;
        return true;
      }
      case "key": {
        if (!readStringBody(deltas)) return false;
        state = "colon";
        return true;
      }
      case "colon": {
        while (at < buffer.length && /[\s:]/.test(buffer[at] as string)) at += 1;
        if (at >= buffer.length) return false;
        state = "value";
        return true;
      }
      case "value": {
        const ch = buffer[at] as string;
        if (ch === '"') {
          at += 1;
          emitting = STREAMED_FIELDS.includes(key);
          state = "string";
          return true;
        }
        if (ch === "{" || ch === "[") {
          // A nested value is never streamed; it is skipped whole and read
          // after the call from the full text, like everything else.
          emitting = false;
          depth = 0;
          nestedString = false;
          nestedEscape = false;
          state = "nested";
          return true;
        }
        emitting = false;
        state = "scalar";
        return true;
      }
      case "string": {
        if (!readStringBody(deltas)) return false;
        if (emitting) done.add(key as "reply" | "prompt");
        emitting = false;
        state = "object";
        return true;
      }
      case "nested": {
        while (at < buffer.length) {
          const ch = buffer[at] as string;
          at += 1;
          if (nestedString) {
            if (nestedEscape) nestedEscape = false;
            else if (ch === "\\") nestedEscape = true;
            else if (ch === '"') nestedString = false;
            continue;
          }
          if (ch === '"') nestedString = true;
          else if (ch === "{" || ch === "[") depth += 1;
          else if (ch === "}" || ch === "]") {
            depth -= 1;
            if (depth === 0) {
              state = "object";
              return true;
            }
          }
        }
        return false;
      }
      case "scalar": {
        while (at < buffer.length && !/[,}]/.test(buffer[at] as string)) at += 1;
        if (at >= buffer.length) return false;
        state = "object";
        return true;
      }
      case "done":
        return false;
    }
  }

  return {
    push(chunk) {
      raw += chunk;
      if (state === "done") return [];
      buffer += chunk;
      const deltas: EnvelopeDelta[] = [];
      while (step(deltas)) {
        /* advance until the reader needs more input */
      }
      // Reclaim what has been consumed; state carries everything still needed.
      if (at > 0) {
        buffer = buffer.slice(at);
        at = 0;
      }
      return deltas;
    },
    raw: () => raw,
    completed: () => done,
  };
}
